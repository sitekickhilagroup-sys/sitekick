'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import { planMerge } from '@/lib/merge';
import { buildDetailsPatch, validateDetailsIntegrity, type TaskDetailsPatch } from '@/lib/task-details';
import type { ProcessImpact, Task } from '@/lib/types';

export type { TaskDetailsPatch };

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const projectId = String(formData.get('project_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!projectId || !title) return { error: 'missing fields' };
  const description = String(formData.get('description') ?? '').trim() || null;
  const owner = String(formData.get('owner') ?? '').trim() || null;
  const due = String(formData.get('due') ?? '') || null;
  const { data, error } = await admin.from('tasks').insert({
    project_id: projectId,
    title,
    description,
    owner,
    due,
    source: 'manual',
    planned: true,
  }).select('id').single();
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: data.id, actor: user.email ?? user.id, action: 'create', after: { title, description, owner, due } });
  revalidatePath('/');
  return { ok: true };
}

// Spec §י + her Reconciliation Agent contract: before creating, check for an
// existing open task with the same goal in the same project. Similar matches
// come back as candidates for a human decision — nothing is created until
// the person confirms "new" (force) or picks "same task".
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a));
  const tb = new Set(normalize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  owner: string | null;
  due: string | null;
  waiting_for: string | null;
}

const PROCESS_IMPACTS: ProcessImpact[] = [
  'primary_blocker', 'workstream_blocker', 'future_gate',
  'external_gate', 'not_blocking', 'verify',
];

/**
 * Set a task's effect on the process.
 *
 * The field the reviewed work map asks for: separate from status, because "a
 * task can be Waiting without being Blocking". Until a task carries one, My
 * Work falls back to the old priority heuristic — which is exactly why every
 * urgent item currently reads as a blocker.
 *
 * A human setting this outranks the agent. Recorded with before and after so
 * it stays auditable and reversible.
 */
export async function setProcessImpact(taskId: string, impact: ProcessImpact | null) {
  const user = await requireUser();
  if (impact !== null && !PROCESS_IMPACTS.includes(impact)) return { error: 'invalid impact' };
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data: prior, error: loadError } = await admin
    .from('tasks').select('process_impact').eq('id', taskId).single();
  if (loadError) return { error: loadError.message };

  const { error } = await admin
    .from('tasks').update({ process_impact: impact, last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };

  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor, action: 'process_impact',
    before: { process_impact: (prior as { process_impact: ProcessImpact | null }).process_impact },
    after: { process_impact: impact },
  });

  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/projects'); revalidatePath('/weekly');
  return { ok: true };
}

/** Guards the one place a client-supplied id is interpolated into a filter. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fold a duplicate task into a Master Action.
 *
 * The losing row is never deleted — it is marked merged and keeps its own
 * fields, so the history survives and undo only has to clear three columns.
 * Both sides are written to the activity log with before and after, which is
 * what makes the change auditable and reversible.
 */
export async function mergeTasks(masterId: string, duplicateId: string) {
  const user = await requireUser();
  if (masterId === duplicateId) return { error: 'cannot merge a task into itself' };
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data: rows, error: loadError } = await admin
    .from('tasks').select('*').in('id', [masterId, duplicateId]);
  if (loadError) return { error: loadError.message };

  const master = (rows ?? []).find((r) => r.id === masterId) as Task | undefined;
  const duplicate = (rows ?? []).find((r) => r.id === duplicateId) as Task | undefined;
  if (!master || !duplicate) return { error: 'task not found' };
  if (duplicate.merged_into) return { error: 'already merged' };
  // Merging a master into something else would orphan everything pointing at
  // it, so the chain is kept one level deep.
  if (master.merged_into) return { error: 'master is itself merged' };

  const patch = planMerge(master, duplicate, { actor, now: new Date().toISOString() });

  if (Object.keys(patch.master).length > 0) {
    const { error } = await admin.from('tasks').update(patch.master).eq('id', masterId);
    if (error) return { error: error.message };
  }
  const { error: loserError } = await admin.from('tasks').update(patch.loser).eq('id', duplicateId);
  if (loserError) return { error: loserError.message };

  await logActivity(admin, {
    entity_type: 'task', entity_id: duplicateId, actor, action: 'merge',
    before: duplicate, after: { ...duplicate, ...patch.loser },
  });
  await logActivity(admin, {
    entity_type: 'task', entity_id: masterId, actor, action: 'merge:absorb',
    before: master, after: { ...master, ...patch.master },
  });

  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath('/inbox');
  return { ok: true };
}

/**
 * Reverse a merge. The duplicate kept every field it had, so restoring it is a
 * matter of clearing the merge columns and putting its status back.
 *
 * What this does not do is unpick the values the master absorbed: those were
 * gap-fills, and removing them could delete a value a human has since edited.
 * The activity log holds the master's before-state for anyone who needs it.
 */
export async function undoMerge(duplicateId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data: row, error: loadError } = await admin
    .from('tasks').select('*').eq('id', duplicateId).single();
  if (loadError) return { error: loadError.message };
  const duplicate = row as Task;
  if (!duplicate.merged_into) return { error: 'not merged' };

  const restored = { status: 'open' as const, merged_into: null, merged_at: null, merged_by: null };
  const { error } = await admin.from('tasks').update(restored).eq('id', duplicateId);
  if (error) return { error: error.message };

  await logActivity(admin, {
    entity_type: 'task', entity_id: duplicateId, actor, action: 'merge:undo',
    before: duplicate, after: { ...duplicate, ...restored },
  });

  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath('/inbox');
  return { ok: true };
}

export async function createTaskChecked(input: {
  projectId: string | null;
  title: string;
  owner?: string | null;
  due?: string | null;
  waitingFor?: string | null;
  force?: boolean;
}) {
  const user = await requireUser();
  const title = input.title.trim();
  if (!title) return { error: 'missing title' };
  const admin = supabaseAdmin();

  if (!input.force) {
    // Same fix as lib/dedup.ts: the search used to be locked to the candidate's
    // own project, so adding a task that already existed under General (or the
    // reverse) reported no duplicate and created the twin. Two known projects
    // stay apart; an unassigned row is compared against both.
    //
    // projectId reaches here from the client, and .or() takes a filter
    // expression, so it is only interpolated once it is known to be a UUID.
    const scoped = input.projectId && UUID.test(input.projectId) ? input.projectId : null;
    const base = admin
      .from('tasks')
      .select('id,title,owner,due,waiting_for,project_id')
      .eq('status', 'open');
    const { data: open } = scoped
      ? await base.or(`project_id.eq.${scoped},project_id.is.null`)
      : await base;
    const duplicates: DuplicateCandidate[] = ((open ?? []) as DuplicateCandidate[])
      .map((t) => ({ t, score: similarity(title, t.title) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.t);
    if (duplicates.length > 0) return { duplicates };
  }

  const { data, error } = await admin.from('tasks').insert({
    project_id: input.projectId,
    title,
    owner: input.owner?.trim() || null,
    due: input.due || null,
    waiting_for: input.waitingFor?.trim() || null,
    source: 'manual',
    planned: true,
  }).select('id').single();
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: data.id, actor: user.email ?? user.id,
    action: input.force ? 'create_despite_similar' : 'create',
    after: { title, owner: input.owner ?? null, due: input.due ?? null },
  });
  revalidatePath('/work');
  revalidatePath('/');
  return { ok: true, id: data.id };
}

// "Same task" resolution for the duplicate dialog: no new record — the
// existing one is touched and the confirmation lands in the audit trail.
export async function confirmExistingTask(taskId: string, attemptedTitle: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'dedup_confirmed', after: { attempted_title: attemptedTitle },
  });
  revalidatePath('/work');
  return { ok: true };
}

export async function setTaskStatus(taskId: string, status: 'open' | 'done' | 'dropped') {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    status,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'set_status', after: { status } });
  revalidatePath('/');
  return { ok: true };
}

export async function updateTaskWaiting(taskId: string, waitingFor: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    waiting_for: waitingFor.trim() || null,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'set_waiting', after: { waiting_for: waitingFor.trim() || null } });
  revalidatePath('/');
  return { ok: true };
}

/**
 * Full "Edit details" write: Owner, Waiting-on, Due, Project, Sub-stage,
 * Workstream and Impact on process, in one audited patch. (Phase is not in
 * this list — see task-editor.tsx and lib/task-details.ts's
 * resolveTaskPhaseKey: a task's phase is derived from substage_template_id,
 * never stored on tasks.stage_key, which is a separate legacy column.)
 *
 * The seven My Work verbs never covered these fields (Dor #51/#52) and Impact
 * on process had no editor anywhere (Rotem's process-page gap) — this is the
 * one place all of them now go through, mirroring applyWorkVerb's audit shape
 * (snapshot before, write, log after) so Undo works exactly the same way.
 *
 * A thin caller around lib/task-details.ts's pure functions: buildDetailsPatch
 * does the whitelist/coercion/shape validation, validateDetailsIntegrity does
 * the cross-field checks below against freshly-fetched rows — this action's
 * own job is only the I/O (fetch before + FK rows, write, log, revalidate)
 * and resolving "effective" values so a field this patch doesn't touch can't
 * end up inconsistent with one it does (see the test for the race this closes).
 */
export async function updateTaskDetails(taskId: string, patch: TaskDetailsPatch) {
  const user = await requireUser();
  const built = buildDetailsPatch(patch);
  if ('error' in built) return built;
  const { clean } = built;

  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (!before) return { error: 'task not found' };
  const beforeRow = before as Task;

  // "Effective" = this patch's value if it touches the key, else the row's
  // current value — a patch that only changes project_id must still be
  // checked against whatever workstream_id the row already has.
  const effectiveProjectId = 'project_id' in clean ? (clean.project_id as string | null) : beforeRow.project_id;
  const effectiveWorkstreamId = 'workstream_id' in clean ? (clean.workstream_id as string | null) : beforeRow.workstream_id;
  const effectiveSubstageId = 'substage_template_id' in clean ? (clean.substage_template_id as string | null) : beforeRow.substage_template_id;

  const [workstreamRes, substageRes] = await Promise.all([
    effectiveWorkstreamId
      ? admin.from('workstreams').select('project_id,phase_key').eq('id', effectiveWorkstreamId).maybeSingle()
      : Promise.resolve({ data: null }),
    effectiveSubstageId
      ? admin.from('substage_templates').select('phase_key').eq('id', effectiveSubstageId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (effectiveWorkstreamId && !workstreamRes.data) return { error: 'workstream not found' };
  if (effectiveSubstageId && !substageRes.data) return { error: 'sub-stage not found' };

  const integrityError = validateDetailsIntegrity(clean, {
    effectiveProjectId,
    workstream: workstreamRes.data as { project_id: string; phase_key: string } | null,
    substageTemplate: substageRes.data as { phase_key: string } | null,
  });
  if (integrityError) return integrityError;

  const { error } = await admin.from('tasks').update({ ...clean, last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'edit:details', before, after: clean,
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const, undoId };
}
