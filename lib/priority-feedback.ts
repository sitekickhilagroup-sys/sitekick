// Learning V1 — pure logic for turning Noa's business events into
// forward-captured feedback FACTS, with the interpretation kept strictly
// separate (a business event is not proof the rank was right/wrong), and
// provenance recording whether we can prove she saw the recommendation.
//
// This module is deliberately connection-free and side-effect-free so it can be
// unit-tested without a database. The collection wiring (reading the live run
// and inserting a row) lives in the server actions and calls into here.
//
// Decisions already settled (do not re-open): inaction is NEVER interpreted as
// a rejection; interpretation is a CANDIDATE only and is never applied to
// ranking without the Phase-2 quality evaluation against the current ranker.

export type PriorityEvent =
  | 'completed'
  | 'not_applicable'
  | 'waiting'
  | 'delayed'
  | 'scheduled'
  | 'reordered'
  | 'unblocked'
  | 'reopened';

export type Provenance = 'confirmed_seen' | 'assumed_latest_run' | 'missing';

/** The AI recommendation for a task, as captured at action time. */
export interface ProposedRank {
  run_id: string;
  global_rank: number;
  urgency: 'now' | 'high' | 'medium' | 'low' | string;
}

export const INTERPRETER_VERSION = 'v1-candidate';

/**
 * Whether the link from an action to a recommendation is proven, assumed, or
 * absent. Without impression logging we cannot prove Noa saw a given run, so a
 * present rank is at best `assumed_latest_run`; only an impression whose run_id
 * matches upgrades to `confirmed_seen`.
 */
export function deriveProvenance(
  proposed: ProposedRank | null,
  opts?: { impressionRunId?: string | null },
): Provenance {
  if (!proposed) return 'missing';
  if (opts?.impressionRunId && opts.impressionRunId === proposed.run_id) return 'confirmed_seen';
  return 'assumed_latest_run';
}

/** The immutable fact — never conflated with its interpretation. */
export interface FeedbackFact {
  task_id: string;
  event: PriorityEvent;
  run_id: string | null;
  proposed_global_rank: number | null;
  proposed_urgency: string | null;
  recommendation_provenance: Provenance;
  source_activity_log_id: string | null;
  decided_by: string;
}

export function buildFeedbackFact(input: {
  taskId: string;
  event: PriorityEvent;
  proposed: ProposedRank | null;
  sourceActivityLogId: string | null;
  decidedBy: string;
  impressionRunId?: string | null;
}): FeedbackFact {
  const p = input.proposed;
  return {
    task_id: input.taskId,
    event: input.event,
    run_id: p?.run_id ?? null,
    proposed_global_rank: p?.global_rank ?? null,
    proposed_urgency: p?.urgency ?? null,
    recommendation_provenance: deriveProvenance(p, { impressionRunId: input.impressionRunId }),
    source_activity_log_id: input.sourceActivityLogId,
    decided_by: input.decidedBy,
  };
}

export type Polarity = 'none' | 'weak_positive' | 'weak_negative';

export interface Interpretation {
  polarity: Polarity;
  confidence: number; // 0..1, deliberately capped low for single-event signals
  version: string;
  note: string;
}

/**
 * A CANDIDATE, per-row reading of a fact — separate from and re-computable over
 * the stored fact. It never decides anything: order-based ranking signal is a
 * later AGGREGATE computation, and any influence on ranking is gated behind the
 * Phase-2 quality evaluation. Single events yield at most a weak, low-confidence
 * candidate, and only where a recommendation existed to compare against.
 */
export function interpretFeedback(fact: FeedbackFact): Interpretation {
  const version = INTERPRETER_VERSION;
  if (fact.recommendation_provenance === 'missing' || fact.proposed_global_rank == null) {
    return { polarity: 'none', confidence: 0, version, note: 'no recommendation to compare' };
  }
  const highTier = fact.proposed_urgency === 'now' || fact.proposed_urgency === 'high';
  if (fact.event === 'not_applicable' && highTier) {
    return { polarity: 'weak_negative', confidence: 0.25, version, note: 'high-ranked item dropped — candidate over-surface' };
  }
  if (fact.event === 'waiting' && highTier) {
    return { polarity: 'weak_negative', confidence: 0.2, version, note: 'high-ranked item blocked — candidate over-rank' };
  }
  // completed / delayed / scheduled / anything else: a recorded business fact
  // with no per-row ranking verdict (order signal is computed in aggregate).
  return { polarity: 'none', confidence: 0, version, note: 'business event recorded; no per-row verdict' };
}

export type RetractionKind = 'correction' | 'cancellation' | 'circumstance';

/**
 * Classify an undo/reopen against the event it reverses (correction #3): a
 * near-immediate reversal with no new reason is a mis-click cancellation; a
 * reversal that cites a new reason / scope change is a circumstance change (a
 * new fact, not a retraction of judgement); otherwise it is a considered
 * correction whose prior interpretation must be voided.
 */
export function classifyRetraction(input: {
  gapMs: number;
  hasNewReason: boolean;
}): RetractionKind {
  if (input.gapMs <= 60_000 && !input.hasNewReason) return 'cancellation';
  if (input.hasNewReason) return 'circumstance';
  return 'correction';
}
