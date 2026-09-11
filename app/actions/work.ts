'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { buildUndoRestorePatch, verbToPatch, UNDO_RESTORE_KEYS, type WorkVerb } from '@/lib/work-verbs';
import { logActivity, applyCasGuard, getLatestActivityLogId } from '@/lib/state-writer';
import { recordPriorityFeedback, voidPriorityFeedback } from '@/lib/collect-priority-feedback';
import { syncTaskIntoOpenReview } from '@/app/actions/weekly';

const VALID_VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];

/**
 * One update verb → one canonical write, plus the audit row Undo needs.
 * The caller gets `undoId` back so the row can offer "Update recorded · Undo"
 * without a second round trip, exactly like Noa's demo.
 */
export async function applyWorkVerb(taskId: string, verb: WorkVerb, input: string | null) {
  const user = await requireUser();
  if (!VALID_VERBS.includes(verb)) return { error: 'invalid verb' };
  const mapped = verbToPatch(verb, input, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', taskId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: mapped.action, before, after: verb === 'note' ? { note: input } : mapped.patch,
  });
  // Learning V1 forward-capture: record this disposition against the ranking
  // Noa was shown. Gated by LEARNING_COLLECT, best-effort — a collection
  // failure must never break the verb, so it's guarded here and internally.
  try {
    await recordPriorityFeedback(admin, {
      taskId, verb, sourceActivityLogId: undoId, decidedBy: user.email ?? user.id,
    });
  } catch (e) {
    console.error('[priority-feedback] applyWorkVerb collect failed (non-fatal)', { taskId, verb, error: e });
  }
  // I3: this write can land in weekly_review_items via syncTaskIntoOpenReview
  // below, so /weekly needs revalidating too (undoWorkVerb already does).
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  // A7: the verb already landed — a weekly-sync hiccup must never turn a
  // successful task write into an error toast, so it's caught and logged,
  // never returned as `error`.
  // C3: pre-0016, the upsert inside syncTaskIntoOpenReview throws on every
  // single call (next_step doesn't exist yet) — console-only made that
  // 100% dead silently. Console stays (it's still the only trace an admin
  // without browser access has), but the caller now also learns about it via
  // `syncWarning`, so the UI can say so instead of pretending the sync ran.
  let syncWarning = false;
  try {
    await syncTaskIntoOpenReview(admin, taskId);
  } catch (e) {
    console.error('[weekly-sync] applyWorkVerb: failed to sync task into open review', { taskId, verb, error: e });
    syncWarning = true;
  }
  return { ok: true as const, undoId, ...(syncWarning ? { syncWarning: true as const } : {}) };
}

/** Restores the task snapshot taken before the verb was applied. */
export async function undoWorkVerb(logId: string): Promise<{ ok: true } | { error: string; conflict?: true }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as { id: string; entity_type: string; entity_id: string; before_json: Record<string, unknown> | null } | null;
  if (!entry?.before_json || entry.entity_type !== 'task') return { error: 'nothing to undo' };
  const before = entry.before_json;
  // A6: task-details edits (owner/waiting/due already covered above) also
  // touch project/sub-stage/workstream/impact — before_json is a full row
  // snapshot either way, so restoring the extra keys is a no-op for
  // verb-only edits and a real restore for a details edit. stage_key is
  // deliberately NOT in UNDO_RESTORE_KEYS: updateTaskDetails never writes
  // that column (it's the legacy stage tag, not a phase — see
  // lib/task-details.ts), so there is nothing on that column for a
  // details-edit undo to restore, and touching it here would let an
  // unrelated verb's undo overwrite a legacy tag no action in this round
  // ever changed.
  // C1: buildUndoRestorePatch (lib/work-verbs.ts) restores only the keys the
  // snapshot actually captured — see its own doc comment for why a pre-0015
  // before_json sending latest_note/substage_template_id/workstream_id
  // unconditionally used to 400 the whole restore with PGRST204.
  const restore = buildUndoRestorePatch(before);

  // Long-window guard: is this entry still the newest activity for the task?
  const latestId = await getLatestActivityLogId(admin, 'task', entry.entity_id);
  if (latestId !== entry.id) return { error: 'conflict', conflict: true as const };

  // Short-window guard: fold the check into the write itself (same fix as
  // revertTaskHistoryEntry / updateTaskDetails, app/actions/tasks.ts) — a
  // plain check-then-write still leaves a gap where a write landing between
  // the check above and this UPDATE would be silently overwritten. The live
  // row was already read as `before` when applyWorkVerb captured this
  // snapshot originally; re-read it fresh here so the guard compares against
  // what the row holds right now, not a stale value.
  const { data: live } = await admin.from('tasks').select('*').eq('id', entry.entity_id).maybeSingle();
  if (!live) return { error: 'task not found' };
  const { data: written, error } = await applyCasGuard(
    admin.from('tasks').update(restore).eq('id', entry.entity_id),
    live as Record<string, unknown>,
    UNDO_RESTORE_KEYS,
  ).select('id').maybeSingle();
  if (error) return { error: error.message };
  if (!written) return { error: 'conflict', conflict: true as const };

  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo', before: live, after: restore,
  });
  // The action this undo reverses no longer counts as valid human signal —
  // void its priority_feedback row (if any) so learning never reads it as
  // still-current once it starts consuming this table. Best-effort, never
  // blocks the undo itself.
  try {
    await voidPriorityFeedback(admin, {
      sourceActivityLogId: entry.id, reversesActivityLogId: undoId, kind: 'cancellation',
    });
  } catch (e) {
    console.error('[priority-feedback] undoWorkVerb void failed (non-fatal)', { logId, error: e });
  }
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const };
}

/** Noa round 3, critical #1 + request #3: a task closed by mistake was
 *  unrecoverable once the undo toast expired — no "Completed" view, no way
 *  back. This is the way back: open again, full audit row, and the same
 *  undoWorkVerb-compatible snapshot so the reopen itself can be undone. */
export async function reopenTask(taskId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (!before) return { error: 'not found' };
  const prior = before as { status: string };
  // 'merged' rows are duplicates folded into a master — un-merging is
  // undoMerge's job (it restores the pair's relationship too), not reopen's.
  if (prior.status !== 'done' && prior.status !== 'dropped') return { error: 'not closed' };
  const { error } = await admin.from('tasks')
    .update({ status: 'open', last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'reopen', before, after: { status: 'open' },
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const, undoId };
}

export async function snoozeTask(taskId: string, until: string) {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: 'invalid date' };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ snoozed_until: until }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'snooze', after: { until } });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

export async function pinTask(taskId: string, manualPriority: number | null) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('manual_priority').eq('id', taskId).maybeSingle();
  const { error } = await admin.from('tasks').update({ manual_priority: manualPriority }).eq('id', taskId);
  if (error) return { error: error.message };
  const logId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'pin', before, after: { manualPriority },
  });
  // Learning V1 (Milestone 1.5): a pin is Noa saying "this belongs above
  // these others" — the strongest, unambiguous ranking correction there is
  // (see docs/ai/handoffs/LEARNING_MODEL_IMPROVEMENT_DRAFT.md §9.6). Only
  // recorded on an actual pin, not on unpin (manualPriority === null) — an
  // unpin retracts a placement, it doesn't itself assert a new one. Known
  // gap, not yet handled: pinning then immediately undoing (see pinToTop's
  // caller) does not void this row the way undoWorkVerb does for verbs —
  // harmless today since nothing reads priority_feedback yet.
  if (manualPriority != null) {
    try {
      await recordPriorityFeedback(admin, {
        taskId, verb: 'reordered', sourceActivityLogId: logId, decidedBy: user.email ?? user.id,
      });
    } catch (e) {
      console.error('[priority-feedback] pinTask collect failed (non-fatal)', { taskId, error: e });
    }
  }
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

/**
 * "Pin to top" (Milestone 1.5) — the one-click version of pinTask for the
 * common case: put this task above every other pinned task, no number to
 * pick. Computes the next value server-side (deterministic, not the model's
 * opinion) and reuses pinTask for the actual write + audit + learning-signal
 * capture, so there is exactly one place that does any of that.
 */
export async function pinToTop(taskId: string) {
  await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('tasks').select('manual_priority')
    .not('manual_priority', 'is', null)
    .order('manual_priority', { ascending: true })
    .limit(1);
  const current = (data?.[0] as { manual_priority: number } | undefined)?.manual_priority;
  const next = current != null ? current - 1 : 1;
  return pinTask(taskId, next);
}
