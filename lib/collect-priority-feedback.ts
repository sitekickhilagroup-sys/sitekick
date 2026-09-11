// Learning V1 — collection (forward-capture). Server-side, DB-touching wrapper
// around the pure logic in ./priority-feedback. Best-effort by contract: a
// collection failure must NEVER turn a successful business action into an
// error, so every path here is caught by the caller and swallowed.
//
// Gated by the LEARNING_COLLECT flag: with it unset the whole thing is a no-op,
// which is the kill-switch — nothing is written, existing behavior is untouched.
// Nothing in the product READS priority_feedback yet (collection ≠ active use).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildFeedbackFact, interpretFeedback, type PriorityEvent, type ProposedRank,
} from './priority-feedback.ts';

/** Kill-switch. Collection writes nothing unless this is explicitly enabled. */
export function isCollectionEnabled(): boolean {
  return process.env.LEARNING_COLLECT === '1';
}

/** Only these task events carry a prioritization signal worth capturing.
 *  'reordered' (Milestone 1.5): Noa pinning a task to the top is the
 *  strongest, most unambiguous correction signal there is — see
 *  docs/ai/handoffs/LEARNING_MODEL_IMPROVEMENT_DRAFT.md §9.6. */
const CAPTURED_EVENTS: readonly PriorityEvent[] = [
  'completed', 'not_applicable', 'waiting', 'delayed', 'scheduled', 'reordered',
];

export function isCapturedEvent(verb: string): verb is PriorityEvent {
  return (CAPTURED_EVENTS as readonly string[]).includes(verb);
}

/**
 * The recommendation Noa was shown for this task = the newest priority run that
 * actually has ranked rows (mirrors app/(dash)/(standard)/work/page.tsx). If the
 * task carried no row in that run, there was no recommendation for it → null,
 * which the pure layer records as provenance 'missing'. No impression logging
 * exists, so a present rank is 'assumed_latest_run', never 'confirmed_seen'.
 */
async function latestSeenRank(admin: SupabaseClient, taskId: string): Promise<ProposedRank | null> {
  const { data: recentRuns } = await admin
    .from('priority_runs').select('id,created_at')
    .order('created_at', { ascending: false }).limit(10);
  const runs = (recentRuns ?? []) as { id: string; created_at: string }[];
  if (!runs.length) return null;
  const { data: rows } = await admin
    .from('task_priorities').select('run_id,task_id,global_rank,urgency')
    .in('run_id', runs.map((r) => r.id));
  const byRun = new Map<string, { task_id: string; global_rank: number; urgency: string }[]>();
  for (const r of (rows ?? []) as { run_id: string; task_id: string; global_rank: number; urgency: string }[]) {
    const arr = byRun.get(r.run_id) ?? [];
    arr.push(r);
    byRun.set(r.run_id, arr);
  }
  const latestNonEmpty = runs.find((r) => (byRun.get(r.id)?.length ?? 0) > 0);
  if (!latestNonEmpty) return null;
  const mine = (byRun.get(latestNonEmpty.id) ?? []).find((r) => r.task_id === taskId);
  return mine ? { run_id: latestNonEmpty.id, global_rank: mine.global_rank, urgency: mine.urgency } : null;
}

/**
 * Record one forward-capture feedback row for a task event. No-op unless
 * collection is enabled and the event is one we capture. Caller must still wrap
 * this in try/catch — it also guards internally so it never throws.
 */
/**
 * Marks a priority_feedback row voided when the action that produced it is
 * later undone (undoWorkVerb / revertTaskHistoryEntry) — so an undone human
 * decision stops reading as valid signal once learning starts consuming this
 * table. `priority_feedback` is append-only by design (the row for the
 * original action is never deleted or rewritten); `voided`,
 * `retraction_kind` and `reverses_activity_log_id` were added for exactly
 * this in migration 0023 and left unpopulated until now.
 *
 * Best-effort, like recordPriorityFeedback: an undo must never fail or even
 * slow down because this bookkeeping call had trouble. `.eq('voided',
 * false)` makes a second void on the same source a safe no-op rather than
 * overwriting which undo gets credited as the reversal.
 */
export async function voidPriorityFeedback(
  admin: SupabaseClient,
  input: { sourceActivityLogId: string; reversesActivityLogId: string | null; kind: 'cancellation' | 'correction' },
): Promise<void> {
  if (!isCollectionEnabled()) return;
  try {
    await admin.from('priority_feedback')
      .update({
        voided: true,
        retraction_kind: input.kind,
        reverses_activity_log_id: input.reversesActivityLogId,
      })
      .eq('source_activity_log_id', input.sourceActivityLogId)
      .eq('voided', false);
  } catch (e) {
    console.error('[priority-feedback] void failed (non-fatal)', { sourceActivityLogId: input.sourceActivityLogId, error: e });
  }
}

export async function recordPriorityFeedback(
  admin: SupabaseClient,
  input: { taskId: string; verb: string; sourceActivityLogId: string | null; decidedBy: string },
): Promise<void> {
  if (!isCollectionEnabled()) return;
  if (!isCapturedEvent(input.verb)) return;
  try {
    const proposed = await latestSeenRank(admin, input.taskId);
    const fact = buildFeedbackFact({
      taskId: input.taskId, event: input.verb, proposed,
      sourceActivityLogId: input.sourceActivityLogId, decidedBy: input.decidedBy,
    });
    const interp = interpretFeedback(fact);
    await admin.from('priority_feedback').insert({
      task_id: fact.task_id, event: fact.event, run_id: fact.run_id,
      proposed_global_rank: fact.proposed_global_rank, proposed_urgency: fact.proposed_urgency,
      recommendation_provenance: fact.recommendation_provenance,
      source_activity_log_id: fact.source_activity_log_id, decided_by: fact.decided_by,
      inferred_signal: interp.polarity, confidence: interp.confidence,
      interpreter_version: interp.version,
    });
  } catch (e) {
    // Best-effort: never surface a collection error to the caller.
    console.error('[priority-feedback] collect failed (non-fatal)', { taskId: input.taskId, verb: input.verb, error: e });
  }
}
