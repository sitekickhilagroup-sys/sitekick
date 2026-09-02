'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { applyProposal, logActivity } from '@/lib/state-writer';
import { attributionTokens, runFullTriage } from '@/lib/auto-triage';
import { defaultTreatment } from '@/lib/review-treatments';
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

  const patch: Record<string, unknown> = {
    decided_by: decision === 'pending' ? null : actor,
    decided_at: decision === 'pending' ? null : new Date().toISOString(),
  };
  if (edits.title !== undefined) patch.title = clean(edits.title);
  if (edits.resultNote !== undefined) patch.result_note = clean(edits.resultNote);
  if (edits.changeType) patch.change_type = edits.changeType;
  if (edits.projectId !== undefined && chosenProject !== p.project_id) patch.project_id = chosenProject;

  if (decision !== 'approved') {
    patch.state = decision === 'pending' ? 'pending' : decision;
    const { error } = await admin.from('agent_proposals').update(patch).eq('id', id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'proposal', entity_id: id, actor, action: `review:${decision}` });
    revalidateReview();
    return { ok: true, undoId: null, message: decision };
  }

  const changeType: ChangeType = edits.changeType ?? p.change_type ?? defaultTreatment(p.type, !!p.target_task_id);
  const note = clean(edits.resultNote) ?? p.result_note ?? p.evidence_excerpt;
  const title = clean(edits.title) ?? p.title ?? (typeof p.payload.title === 'string' ? p.payload.title : null);
  const due = edits.due && DATE_RE.test(edits.due.trim()) ? edits.due.trim() : null;
  const owner = clean(edits.owner);
  let undoId: string | null = null;

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
      stage_key: typeof p.payload.stage_key === 'string' ? p.payload.stage_key : null,
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
    if (!p.target_task_id) return { error: 'linking needs an existing task' };
    const { data: created, error } = await admin.from('tasks').insert({
      project_id: chosenProject,
      document_id: p.document_id,
      title,
      description: note,
      owner,
      due,
      stage_key: typeof p.payload.stage_key === 'string' ? p.payload.stage_key : null,
      category: p.payload.category === 'admin' ? 'admin' : 'project',
      status: 'open',
      source: 'agent review',
      last_touched: today,
    }).select('id').single();
    if (error) return { error: error.message };

    const { error: relError } = await admin.from('relationships').insert({
      project_id: chosenProject,
      from_task_id: p.target_task_id,
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
      after: { proposal_id: id, created: true, linked_to: p.target_task_id },
    });
  } else if (changeType === 'information_only') {
    undoId = await logActivity(admin, {
      entity_type: 'proposal', entity_id: id, actor,
      action: 'review:information_only', after: { proposal_id: id, note },
    });
  } else {
    if (!p.target_task_id) return { error: 'this treatment needs an existing task' };
    const { data: beforeRow } = await admin.from('tasks').select('*').eq('id', p.target_task_id).maybeSingle();
    const before = (beforeRow ?? null) as Task | null;
    if (!before) return { error: 'the matched task no longer exists' };
    const taskPatch: Record<string, unknown> = { last_touched: today, document_id: p.document_id ?? before.document_id };
    if (title && changeType === 'update_existing') taskPatch.title = title;
    if (owner) taskPatch.owner = owner;
    if (due) taskPatch.due = due;
    if (note) taskPatch.description = note;
    if (changeType === 'complete_existing') taskPatch.status = 'done';
    const { error } = await admin.from('tasks').update(taskPatch).eq('id', p.target_task_id);
    if (error) return { error: error.message };
    undoId = await logActivity(admin, {
      entity_type: 'task', entity_id: p.target_task_id, actor,
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
    for (const k of ['title', 'description', 'owner', 'due', 'status', 'waiting_for', 'stage_key', 'last_touched', 'document_id'] as const) {
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
