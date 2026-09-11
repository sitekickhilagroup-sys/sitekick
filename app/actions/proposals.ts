'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { applyProposal, logActivity, resolveDueSourceDate } from '@/lib/state-writer';
import { attributionTokens, runFullTriage } from '@/lib/auto-triage';
import { defaultTreatment, targetTaskError } from '@/lib/review-treatments';
import type { AgentProposal, ChangeType, Task } from '@/lib/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Import Review outcomes. "not_sure" and "ignored" exist so a suggestion can
// leave the queue without the human having to claim the agent was wrong.
export type ReviewDecision = 'approved' | 'rejected' | 'not_sure' | 'ignored' | 'pending';

export interface ReviewEdits {
  title?: string;
  owner?: string;
  due?: string;
  changeType?: ChangeType;
  resultNote?: string;
  /** Drawer project select — the human attribution for an item the agent
   *  couldn't place (or a correction of a wrong placement). '' = General. */
  projectId?: string;
  /** Drawer "attach to existing task" select — the human's target-task pick
   *  when the agent matched nothing (or matched the wrong one). '' = none
   *  (create new); undefined = untouched, keep the agent's target_task_id. */
  targetTaskId?: string | null;
  /** Drawer Sub-stage select — the sub-stage to set on the task this decision
   *  writes (Phase is a filter of it, not stored). '' = clear; undefined =
   *  untouched. A task's phase is owned through substage_template_id. */
  substageTemplateId?: string | null;
}

export interface ReviewResult {
  ok: true;
  /** activity_log row to hand back to undoProposalDecision, when reversible. */
  undoId: string | null;
  message: string;
}

const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** 0027: this drawer's three task-writing treatments (new_task,
 *  keep_both_linked, update_existing/complete_existing/…) build their own
 *  taskPatch/insert directly rather than routing through applyProposal — see
 *  the note on resolveDueSourceDate. When they write a due date, it needs
 *  the same classification applyProposal already gives every other path: if
 *  the human's edited value in the drawer differs from what the agent
 *  proposed, a human just typed it (as confirmed as Edit details' own due
 *  field); otherwise the agent's own tag carries through, defaulting to the
 *  conservative 'unresolved' rather than assuming 'explicit'. */
async function dueProvenanceFields(
  admin: ReturnType<typeof supabaseAdmin>,
  p: AgentProposal,
  due: string | null,
): Promise<Record<string, unknown>> {
  if (!due) return {};
  const payloadDue = typeof p.payload.due === 'string' ? p.payload.due : null;
  if (due !== payloadDue) {
    return { due_provenance: 'explicit', due_source_document_id: null, due_source_date: null };
  }
  const payloadProvenance = typeof p.payload.due_provenance === 'string' ? p.payload.due_provenance : null;
  return {
    due_provenance: payloadProvenance ?? 'unresolved',
    due_source_document_id: p.document_id ?? null,
    due_source_date: await resolveDueSourceDate(admin, p.document_id),
  };
}

function revalidateReview() {
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/inbox'); revalidatePath('/upload');
  revalidatePath('/projects/[id]', 'page');
}

async function decide(id: string, accept: boolean): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;
  const { data } = await admin.from('agent_proposals').select('*').eq('id', id).eq('state', 'pending').maybeSingle();
  if (!data) return { error: 'proposal not found or already decided' };
  const proposal = data as AgentProposal;
  if (accept) {
    const applied = await applyProposal(admin, proposal, actor, laToday());
    if ('error' in applied) return applied;
  }
  const { error } = await admin.from('agent_proposals')
    .update({ state: accept ? 'accepted' : 'rejected', decided_by: actor, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'proposal', entity_id: id, actor, action: accept ? 'accept_proposal' : 'reject_proposal' });
  revalidateReview();
  return { ok: true };
}

export async function acceptProposal(id: string) { return decide(id, true); }
export async function rejectProposal(id: string) { return decide(id, false); }

/**
 * The Import Review decision. Everything Noa edited in the drawer travels with
 * the decision, so what she approves is what gets written — never the agent's
 * original guess silently.
 */
export async function decideProposal(
  id: string,
  decision: ReviewDecision,
  edits: ReviewEdits = {},
): Promise<ReviewResult | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;
  const today = laToday();

  const { data } = await admin.from('agent_proposals').select('*').eq('id', id).maybeSingle();
  if (!data) return { error: 'proposal not found' };
  const p = data as AgentProposal;

  // Human attribution from the drawer beats the agent's guess everywhere
  // below ('' means General/no project, undefined means untouched).
  const chosenProject = edits.projectId !== undefined ? (edits.projectId || null) : p.project_id;

  // The human's target-task pick beats the agent's match — but only within
  // bounds: a manually chosen task must exist, be open, and sit in the project
  // this item is being filed under (Section 2 — let Noa fix an association the
  // agent missed, without letting the client attach to anything it likes).
  let effectiveTargetTaskId = p.target_task_id;
  if (edits.targetTaskId !== undefined) {
    effectiveTargetTaskId = edits.targetTaskId || null;
  }
  // Live-caught bug: this validation ran for EVERY decision, including
  // 'pending' (the drawer's own "Restore to review" button) — so restoring
  // a proposal back to pending silently failed the instant its target task
  // was no longer open (e.g. right after Applying it, exactly when a human
  // is most likely to want to undo). Restoring a proposal's own review
  // state never touches the task at all; only an actual approve/apply
  // needs the target to still be a valid, open task to write to.
  if (decision === 'approved' && effectiveTargetTaskId) {
    const { data: tt } = await admin.from('tasks')
      .select('status,project_id').eq('id', effectiveTargetTaskId).maybeSingle();
    const err = targetTaskError(tt as { status: string; project_id: string | null } | null, chosenProject);
    if (err) return { error: err };
  }

  const patch: Record<string, unknown> = {
    decided_by: decision === 'pending' ? null : actor,
    decided_at: decision === 'pending' ? null : new Date().toISOString(),
  };
  if (edits.title !== undefined) patch.title = clean(edits.title);
  if (edits.resultNote !== undefined) patch.result_note = clean(edits.resultNote);
  if (edits.changeType) patch.change_type = edits.changeType;
  if (edits.projectId !== undefined && chosenProject !== p.project_id) patch.project_id = chosenProject;
  // Record the human's target pick on the proposal so a retry/undo is
  // consistent and the choice is auditable (matching feedback).
  if (edits.targetTaskId !== undefined && effectiveTargetTaskId !== p.target_task_id) {
    patch.target_task_id = effectiveTargetTaskId;
  }

  if (decision !== 'approved') {
    patch.state = decision === 'pending' ? 'pending' : decision;
    const { error } = await admin.from('agent_proposals').update(patch).eq('id', id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'proposal', entity_id: id, actor, action: `review:${decision}` });
    revalidateReview();
    return { ok: true, undoId: null, message: decision };
  }

  const changeType: ChangeType = edits.changeType ?? p.change_type ?? defaultTreatment(p.type, !!effectiveTargetTaskId);
  const note = clean(edits.resultNote) ?? p.result_note ?? p.evidence_excerpt;
  const title = clean(edits.title) ?? p.title ?? (typeof p.payload.title === 'string' ? p.payload.title : null);
  const due = edits.due && DATE_RE.test(edits.due.trim()) ? edits.due.trim() : null;
  const owner = clean(edits.owner);
  let undoId: string | null = null;

  const dueProvenanceFieldsFor = (due: string | null) => dueProvenanceFields(admin, p, due);

  if (changeType === 'apply_as_stated') {
    // Not a task edit. A blocker, a relationship, a decision, a due date or
    // a phase — applyProposal is the one writer that knows which. The drawer
    // used to fall through to the task branches below, so approving
    // "Mailer fee payment blocks Schedule ZAD hearing" created a task by
    // that name instead of the link it describes.
    // No undo id: undoProposalDecision restores task snapshots only, and an
    // Undo that quietly left the blocker standing would be a lie.
    const applied = await applyProposal(admin, p, actor, today);
    if ('error' in applied) return applied;
  } else if (changeType === 'new_task') {
    if (!title) return { error: 'a new task needs a title' };
    const { data: created, error } = await admin.from('tasks').insert({
      project_id: chosenProject,
      document_id: p.document_id,
      title,
      description: note,
      owner,
      due,
      ...(await dueProvenanceFieldsFor(due)),
      stage_key: typeof p.payload.stage_key === 'string' ? p.payload.stage_key : null,
      substage_template_id: edits.substageTemplateId || null,
      category: p.payload.category === 'admin' ? 'admin' : 'project',
      status: 'open',
      source: 'agent review',
      last_touched: today,
    }).select('id').single();
    if (error) return { error: error.message };
    undoId = await logActivity(admin, {
      entity_type: 'task', entity_id: created.id, actor,
      action: 'review:new_task', after: { proposal_id: id, created: true },
    });
  } else if (changeType === 'keep_both_linked') {
    // Not a duplicate: two steps of one chain, like Soils Addendum → LADBS
    // Review → Soil Approval Letter. The corrections doc is explicit that
    // these must not be merged into a single task — both records survive and
    // the dependency is recorded instead.
    if (!title) return { error: 'a new task needs a title' };
    if (!effectiveTargetTaskId) return { error: 'linking needs an existing task' };
    const { data: created, error } = await admin.from('tasks').insert({
      project_id: chosenProject,
      document_id: p.document_id,
      title,
      description: note,
      owner,
      due,
      ...(await dueProvenanceFieldsFor(due)),
      stage_key: typeof p.payload.stage_key === 'string' ? p.payload.stage_key : null,
      substage_template_id: edits.substageTemplateId || null,
      category: p.payload.category === 'admin' ? 'admin' : 'project',
      status: 'open',
      source: 'agent review',
      last_touched: today,
    }).select('id').single();
    if (error) return { error: error.message };

    const { error: relError } = await admin.from('relationships').insert({
      project_id: chosenProject,
      from_task_id: effectiveTargetTaskId,
      to_task_id: created.id,
      type: 'blocks',
      reason: note,
      evidence_document_id: p.document_id,
      // A human chose this in the review drawer, so the link is verified —
      // it is not an agent inference.
      verified_by: actor,
      verified_at: new Date().toISOString(),
    });
    if (relError) return { error: relError.message };

    undoId = await logActivity(admin, {
      entity_type: 'task', entity_id: created.id, actor,
      action: 'review:keep_both_linked',
      after: { proposal_id: id, created: true, linked_to: effectiveTargetTaskId },
    });
  } else if (changeType === 'information_only') {
    undoId = await logActivity(admin, {
      entity_type: 'proposal', entity_id: id, actor,
      action: 'review:information_only', after: { proposal_id: id, note },
    });
  } else {
    if (!effectiveTargetTaskId) return { error: 'this treatment needs an existing task' };
    const { data: beforeRow } = await admin.from('tasks').select('*').eq('id', effectiveTargetTaskId).maybeSingle();
    const before = (beforeRow ?? null) as Task | null;
    if (!before) return { error: 'the matched task no longer exists' };
    const taskPatch: Record<string, unknown> = { last_touched: today, document_id: p.document_id ?? before.document_id };
    // Rename only when the human's title actually differs from the task's
    // current title — an email-extracted title left unchanged must never
    // silently overwrite Noa's work name (brief §1). This mirrors
    // updateFieldsPreview exactly, so what the drawer showed is what is written.
    if (title && changeType === 'update_existing' && title !== (before.title ?? '')) taskPatch.title = title;
    if (owner) taskPatch.owner = owner;
    if (due) {
      taskPatch.due = due;
      Object.assign(taskPatch, await dueProvenanceFieldsFor(due));
    }
    if (note) taskPatch.description = note;
    // Sub-stage (and the Phase derived from it) only when it actually changed —
    // the drawer always sends the current value, and writing an unchanged one
    // would both clear a sub-stage on a blank pick and hide the move from the
    // preview.
    if (edits.substageTemplateId !== undefined
        && (edits.substageTemplateId || null) !== (before.substage_template_id ?? null)) {
      taskPatch.substage_template_id = edits.substageTemplateId || null;
    }
    if (changeType === 'complete_existing') taskPatch.status = 'done';
    const { error } = await admin.from('tasks').update(taskPatch).eq('id', effectiveTargetTaskId);
    if (error) return { error: error.message };
    undoId = await logActivity(admin, {
      entity_type: 'task', entity_id: effectiveTargetTaskId, actor,
      action: `review:${changeType}`, before, after: { ...taskPatch, proposal_id: id },
    });
  }

  patch.state = 'accepted';
  patch.change_type = changeType;
  const { error: pErr } = await admin.from('agent_proposals').update(patch).eq('id', id);
  if (pErr) return { error: pErr.message };

  // LEARNING (attribution): the agent couldn't place this item; the human
  // just did. The item's distinctive tokens become a durable rule, and the
  // next communication from the same vendor/subject arrives pre-attributed
  // (agents/extract-comms.ts applies rules at ingest).
  if (!p.project_id && chosenProject && title) {
    const tokens = attributionTokens(title);
    if (tokens.length >= 2) {
      await admin.from('review_rules').insert({
        kind: 'attribute_project',
        match: { tokens },
        outcome: { project_id: chosenProject },
        learned_from: p.id,
      });
      await logActivity(admin, {
        entity_type: 'review_rule', entity_id: p.id, actor,
        action: 'learn:attribute_project', after: { tokens, project_id: chosenProject },
      });
    }
  }

  revalidateReview();
  return { ok: true, undoId, message: changeType };
}

/** Inbox "Auto-triage now" — one sweep of the whole pending backlog through
 *  the deterministic + learned rules. Returns what moved so the UI can say
 *  "applied 58, ignored 12, 20 left". */
export async function autoTriagePending(): Promise<
  { ok: true; applied: number; ignored: number; kept: number; errors: number } | { error: string }
> {
  await requireUser();
  const admin = supabaseAdmin();
  const full = await runFullTriage(admin, { today: laToday() });
  revalidateReview();
  return {
    ok: true,
    applied: full.applied,
    ignored: full.ignored,
    kept: full.pendingAfter,
    errors: full.errors,
  };
}

export interface FeedItem {
  id: string;
  projectName: string | null;
  title: string;
  matchedTitle: string | null;
  matchedStatus: string | null;
  matchScore: number;
}

/**
 * What the header bell shows: the few suggestions still waiting, with the
 * duplicate they may collide with. Read-only, polled from the client.
 * The list itself stays capped at 8; `pendingProposalCount` (below) gives
 * the bell its true badge number so 13 never reads as 8.
 */
export async function pendingProposalCount(): Promise<number> {
  await requireUser();
  const admin = supabaseAdmin();
  const { count } = await admin.from('agent_proposals')
    .select('id', { count: 'exact', head: true }).eq('state', 'pending');
  return count ?? 0;
}

export async function pendingProposalFeed(): Promise<FeedItem[]> {
  await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('agent_proposals')
    .select('*').eq('state', 'pending').order('created_at', { ascending: false }).limit(8);
  const rows = (data ?? []) as AgentProposal[];
  if (!rows.length) return [];

  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x))];
  const taskIds = [...new Set(rows.map((r) => r.target_task_id).filter((x): x is string => !!x))];
  const [projectsQ, tasksQ] = await Promise.all([
    projectIds.length ? admin.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [] }),
    taskIds.length ? admin.from('tasks').select('id,title,status').in('id', taskIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((projectsQ.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const tasks = new Map(((tasksQ.data ?? []) as { id: string; title: string; status: string }[]).map((x) => [x.id, x]));

  return rows.map((r) => {
    const task = r.target_task_id ? tasks.get(r.target_task_id) ?? null : null;
    return {
      id: r.id,
      projectName: r.project_id ? names.get(r.project_id) ?? null : null,
      title: r.title ?? (typeof r.payload.title === 'string' ? r.payload.title : '') ?? '',
      matchedTitle: task?.title ?? null,
      matchedStatus: task?.status ?? null,
      matchScore: r.match_score ?? (task ? Math.round(r.confidence * 100) : 0),
    };
  });
}

/**
 * One click back. The activity row holds the task exactly as it was, so undo
 * restores the record rather than guessing an inverse update.
 */
export async function undoProposalDecision(logId: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  if (!data) return { error: 'nothing to undo' };
  const entry = data as {
    entity_type: string; entity_id: string; action: string;
    before_json: Record<string, unknown> | null; after_json: Record<string, unknown> | null;
  };
  const proposalId = typeof entry.after_json?.proposal_id === 'string' ? entry.after_json.proposal_id : null;

  if (entry.entity_type === 'task' && entry.action === 'review:new_task') {
    const { error } = await admin.from('tasks').delete().eq('id', entry.entity_id);
    if (error) return { error: error.message };
  } else if (entry.entity_type === 'task' && entry.before_json) {
    const before = entry.before_json;
    const restore: Record<string, unknown> = {};
    // 0027: due's classification travels with it — restoring `due` from the
    // snapshot without also restoring due_provenance/due_source_* would
    // leave the row showing the NEW date's metadata against the OLD value,
    // the same mismatch lib/work-verbs.ts's UNDO_RESTORE_KEYS guards against
    // for the other undo path.
    for (const k of ['title', 'description', 'owner', 'due', 'status', 'waiting_for', 'stage_key', 'substage_template_id', 'last_touched', 'document_id', 'due_provenance', 'due_source_document_id', 'due_source_date'] as const) {
      restore[k] = before[k] ?? null;
    }
    const { error } = await admin.from('tasks').update(restore).eq('id', entry.entity_id);
    if (error) return { error: error.message };
  }

  if (proposalId) {
    await admin.from('agent_proposals')
      .update({ state: 'pending', decided_by: null, decided_at: null })
      .eq('id', proposalId);
  }
  await logActivity(admin, {
    entity_type: entry.entity_type, entity_id: entry.entity_id, actor,
    action: 'undo', before: entry.after_json, after: entry.before_json,
  });
  revalidateReview();
  return { ok: true };
}
