'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday, laDateTime } from '@/lib/date';
import { logActivity, getLatestActivityLogId, applyCasGuard } from '@/lib/state-writer';
import { planMerge } from '@/lib/merge';
import { buildDetailsPatch, validateDetailsIntegrity, type TaskDetailsPatch } from '@/lib/task-details';
import { buildUndoRestorePatch, UNDO_RESTORE_KEYS } from '@/lib/work-verbs';
import { voidPriorityFeedback } from '@/lib/collect-priority-feedback';
import { buildTaskHistoryEntries, type TaskHistoryRow, type TaskHistoryEntryShape } from '@/lib/task-history';
import { syncTaskIntoOpenReview } from '@/app/actions/weekly';
import { ensureSubstageActivated } from '@/app/actions/process';
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
export async function mergeTasks(masterId: string, duplicateId: string): Promise<{ error: string } | { ok: true }> {
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
 * "Putting its status back" means what it actually was, not a guess: mergeTasks
 * writes the loser's full pre-merge row as before_json on its own 'merge' audit
 * entry, so a `done` (or `dropped`) task that got merged away comes back the
 * same way it went in, instead of undo silently resurrecting it as `open`.
 *
 * What this does not do is unpick the values the master absorbed: those were
 * gap-fills, and removing them could delete a value a human has since edited.
 * The activity log holds the master's before-state for anyone who needs it.
 */
export async function undoMerge(duplicateId: string): Promise<{ error: string } | { ok: true }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data: row, error: loadError } = await admin
    .from('tasks').select('*').eq('id', duplicateId).single();
  if (loadError) return { error: loadError.message };
  const duplicate = row as Task;
  if (!duplicate.merged_into) return { error: 'not merged' };

  // The most recent 'merge' entry for this task is the one that produced the
  // current merged state — its before_json is that merge's own pre-merge
  // snapshot (mergeTasks above), which is the only record of what status this
  // row actually had. A re-merge after an earlier undo would write a second
  // 'merge' entry, so this is ordered to the latest rather than assuming there
  // is only ever one.
  const { data: logRow, error: logError } = await admin
    .from('activity_log')
    .select('before_json')
    .eq('entity_type', 'task')
    .eq('entity_id', duplicateId)
    .eq('action', 'merge')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (logError) return { error: logError.message };
  const loggedStatus = (logRow?.before_json as { status?: Task['status'] } | null)?.status;
  // mergeTasks always writes this entry before flipping merged_into, so it
  // should always be found — but if it's somehow missing, 'open' is still the
  // safest fallback: never guess 'done' or 'dropped' with no evidence for it.
  const restoredStatus: Task['status'] = loggedStatus ?? 'open';

  const restored = { status: restoredStatus, merged_into: null, merged_at: null, merged_by: null };
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
  // A7: the task already exists — a weekly-sync hiccup must never turn a
  // successful create into an error toast, so it's caught and logged, never
  // returned as `error`.
  // C3: pre-0016 this throws on every call (next_step doesn't exist yet) —
  // console-only made the sync 100% dead with no trace anywhere a user could
  // see. `syncWarning` carries the same signal a caller could act on; today
  // AddAction's own dialog closes immediately on success with no persistent
  // surface to show it on (see components/work/add-action.tsx), so this is
  // the one call site of the three where the warning still lands console-only
  // — VerbMenu and TaskEditor's shared SavedChip both surface it (see C3 in
  // the final fix report for the full reasoning).
  let syncWarning = false;
  try {
    await syncTaskIntoOpenReview(admin, data.id);
  } catch (e) {
    console.error('[weekly-sync] createTaskChecked: failed to sync task into open review', { taskId: data.id, error: e });
    syncWarning = true;
  }
  return { ok: true, id: data.id, ...(syncWarning ? { syncWarning: true as const } : {}) };
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
export async function updateTaskDetails(
  taskId: string, patch: TaskDetailsPatch, baseVersion: string | null,
): Promise<
  | { ok: true; undoId: string | null; syncWarning?: true }
  | { error: string; conflict?: true }
> {
  const user = await requireUser();
  const built = buildDetailsPatch(patch);
  if ('error' in built) return built;
  const { clean } = built;

  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (!before) return { error: 'task not found' };
  const beforeRow = before as Task;

  // Optimistic-concurrency guard: baseVersion is the newest activity_log id
  // for this task as of when the editor opened (getTaskVersion, fetched by
  // TaskEditor on mount). If something else has written to the task since —
  // another tab's Save, a verb click, a persistent Undo — the current
  // newest id has moved on, and writing this patch over it would silently
  // discard that other change. Fail with a conflict instead, the same
  // guard revertTaskHistoryEntry already uses for history-based Undo.
  const currentVersion = await getLatestActivityLogId(admin, 'task', taskId);
  if (currentVersion !== baseVersion) return { error: 'conflict', conflict: true as const };

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

  // Short-window guard: the currentVersion check above only tells us nothing
  // had happened as of that read — closes the gap between that check and
  // this statement itself, which a plain "check, then write" could still
  // miss (a write landing in between would previously have been silently
  // overwritten by this UPDATE). Folding the guard into the UPDATE's own
  // WHERE clause makes the check and the write one atomic operation.
  const { data: written, error } = await applyCasGuard(
    admin.from('tasks').update({ ...clean, last_touched: laToday() }).eq('id', taskId),
    beforeRow as unknown as Record<string, unknown>,
    UNDO_RESTORE_KEYS,
  ).select('id').maybeSingle();
  if (error) return { error: error.message };
  if (!written) return { error: 'conflict', conflict: true as const };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'edit:details', before, after: clean,
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  // A7: the details edit already landed — a weekly-sync hiccup must never
  // turn it into an error toast, so it's caught and logged, never returned
  // as `error`.
  // C3: pre-0016 this throws on every call (next_step doesn't exist yet) —
  // console-only made the sync 100% dead silently. `syncWarning` lets
  // TaskEditor say so on the same SavedChip it already shows for the
  // (successful) primary write, without turning the edit itself into a
  // failure.
  let syncWarning = false;
  try {
    await syncTaskIntoOpenReview(admin, taskId);
  } catch (e) {
    console.error('[weekly-sync] updateTaskDetails: failed to sync task into open review', { taskId, error: e });
    syncWarning = true;
  }
  // F-7: picking a sub-stage here must not leave it reading "Not activated"
  // on the project's own process page. Best-effort — see ensureSubstageActivated's
  // own doc comment for why this never resets an already-advanced instance.
  if (effectiveSubstageId && effectiveProjectId) {
    try {
      await ensureSubstageActivated({
        projectId: effectiveProjectId, substageTemplateId: effectiveSubstageId,
        workstreamId: effectiveWorkstreamId,
      });
    } catch (e) {
      console.error('[process] updateTaskDetails: ensureSubstageActivated failed (non-fatal)', { taskId, error: e });
    }
  }
  return { ok: true as const, undoId, ...(syncWarning ? { syncWarning: true as const } : {}) };
}

/**
 * The optimistic-concurrency token TaskEditor captures when Edit details
 * opens (see updateTaskDetails's baseVersion param above) — the newest
 * activity_log id for the task at that moment. Its own tiny round trip so
 * opening the editor never blocks on it; TaskEditor fires this on mount and
 * awaits the result only when Save is actually clicked.
 */
export async function getTaskVersion(taskId: string): Promise<{ version: string | null }> {
  await requireUser();
  const admin = supabaseAdmin();
  const version = await getLatestActivityLogId(admin, 'task', taskId);
  return { version };
}

export type { TaskHistoryEntryShape as TaskHistoryEntry } from '@/lib/task-history';

/**
 * The task equivalent of getInvoiceHistory (app/actions/invoices.ts) — reads
 * back a slice of what logActivity already wrote, adds nothing to the audit
 * trail. Powers the persistent "History" panel in TaskEditor, so Undo is
 * still reachable after the SavedChip's short-lived toast is gone. Shaping
 * (changedKeys, canUndo) is buildTaskHistoryEntries (lib/task-history.ts) —
 * pure and unit-tested; this function is only the I/O around it.
 */
export async function getTaskHistory(
  taskId: string,
): Promise<{ entries: TaskHistoryEntryShape[] } | { error: string }> {
  await requireUser();
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('activity_log')
    .select('id, actor, action, before_json, after_json, created_at')
    .eq('entity_type', 'task').eq('entity_id', taskId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return { error: error.message };
  const entries = buildTaskHistoryEntries((data ?? []) as TaskHistoryRow[], laDateTime);
  return { entries };
}

/**
 * Restores the task to its state just before one past activity_log entry —
 * the "persistent Undo" a Noa can reach from the History panel even after
 * the SavedChip that originally offered it has long since closed or expired.
 *
 * Guarded the same way undoWorkVerb (app/actions/work.ts) now is too: this
 * can be clicked minutes or days after the action it reverts, so a real
 * write could easily have landed on the task in between. getLatestActivityLogId
 * re-checks that `logId` is still the newest row for this task, and the
 * write itself is a compare-and-swap (applyCasGuard) against a live re-read
 * — closing both the long window (has anything happened since History was
 * opened) and the short window (between that check and this statement) —
 * if anything else touched the task, this returns a conflict instead of
 * silently discarding that later change.
 */
export async function revertTaskHistoryEntry(logId: string): Promise<
  { ok: true } | { error: string; conflict?: true }
> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as {
    id: string; entity_type: string; entity_id: string;
    before_json: Record<string, unknown> | null;
  } | null;
  if (!entry || entry.entity_type !== 'task' || !entry.before_json) return { error: 'nothing to undo' };

  // Long-window guard: is this entry still the newest activity for the task?
  // (Catches "someone acted on this task since you last looked at History.")
  const latestId = await getLatestActivityLogId(admin, 'task', entry.entity_id);
  if (latestId !== entry.id) return { error: 'conflict', conflict: true as const };

  // Snapshot the live row right before writing (same shape as every other
  // write in this file), not entry.before_json — that would only be correct
  // by coincidence, and would make an undo-of-the-undo replay the wrong
  // state. A real live snapshot also means this new row is itself a fully
  // valid, independently revertible history entry.
  const { data: liveBefore } = await admin.from('tasks').select('*').eq('id', entry.entity_id).maybeSingle();
  if (!liveBefore) return { error: 'task not found' };
  const restore = buildUndoRestorePatch(entry.before_json);

  // Short-window guard: the write above only tells us nothing had happened
  // as of that read — closes the gap between that check and this statement
  // itself, which a plain "check, then write" could still miss (a write
  // landing in between would previously have been silently overwritten by
  // this UPDATE). Folding the guard into the UPDATE's own WHERE clause makes
  // the check and the write one atomic operation.
  const { data: written, error } = await applyCasGuard(
    admin.from('tasks').update(restore).eq('id', entry.entity_id),
    liveBefore as Record<string, unknown>,
    UNDO_RESTORE_KEYS,
  ).select('id').maybeSingle();
  if (error) return { error: error.message };
  if (!written) return { error: 'conflict', conflict: true as const };

  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo:history', before: liveBefore, after: restore,
  });
  // The action this reverts no longer counts as valid human signal — void
  // its priority_feedback row (if any; a no-op when there isn't one, e.g.
  // reverting an edit:details action that never recorded feedback) so
  // learning never reads it as still-current. Best-effort, never blocks
  // the revert itself.
  try {
    await voidPriorityFeedback(admin, {
      sourceActivityLogId: entry.id, reversesActivityLogId: undoId, kind: 'cancellation',
    });
  } catch (e) {
    console.error('[priority-feedback] revertTaskHistoryEntry void failed (non-fatal)', { logId, error: e });
  }
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const };
}
