import type { Blocker, BlockerKind } from './types';

/**
 * Portfolio card blocker derivation, from the client doc's "Blocker Audit and
 * Required Corrections" tab.
 *
 * The audit's premise: a task can be important, urgent, or waiting on someone
 * without being a true blocker. Before anything is labelled Blocking the system
 * must be able to name the exact stage it prevents, what releases it, and the
 * evidence proving the dependency.
 */

/** Below this, the causal relationship is not sufficiently evidenced, so the
 *  item is reported as Verify rather than as a confirmed blocker. */
export const MIN_CONFIDENCE = 0.5;

/** Every valid classification, for validating what an agent proposes. */
export const BLOCKER_KINDS: BlockerKind[] = [
  'primary', 'workstream', 'future_gate', 'external_gate',
  'urgent_action', 'verify', 'information_only',
];

/** Only these two are real blockers on a project. Everything else gets its own
 *  count so external waits and unverified items never inflate "N blocking". */
const BLOCKING_KINDS: BlockerKind[] = ['primary', 'workstream'];

/** Fallback headline order when no Primary qualifies. The audit expects an
 *  external gate to lead where one exists — Alta Mesa's card is a City
 *  confirmation, with the LID workstream blocker below it — so kind decides
 *  before age does. Sorting both together by days_stuck let whichever had sat
 *  longer take the headline. */
const FALLBACK_ORDER: BlockerKind[] = ['external_gate', 'workstream'];

export interface BlockerCounts {
  /** Confirmed blockers — the card's "N blocking" chip. */
  blocking: number;
  /** External Gate / Waiting — a separate label, never in the blocking count. */
  waiting: number;
  /** Verify — surfaced in Agent Review, not counted as confirmed Blocking. */
  verify: number;
  /** Future Gate — blocks a later milestone, not today. */
  futureGate: number;
  /** Urgent Action — ranks in My Work, never presented as a project blocker. */
  urgent: number;
}

export interface BlockerView {
  /** Primary Blocker — one concise line on the project card. */
  primary: Blocker | null;
  /** Technical / Parallel Blocker — optional second line when an active
   *  parallel workstream is independently blocked. */
  technical: Blocker | null;
  /** What `primary` actually is. The card must label a fallback honestly and
   *  never silently call an external gate a project-wide blocker. */
  primaryKind: BlockerKind | null;
  counts: BlockerCounts;
}

interface StageContext {
  currentPhaseKey?: string | null;
  activeSubstages?: string[];
}

/** Longest-stuck first; days at risk breaks ties. */
function strongest(a: Blocker, b: Blocker): number {
  return b.days_stuck - a.days_stuck || b.days_at_risk - a.days_at_risk;
}

/** The mandatory test's first question: which exact stage cannot advance? A
 *  blocker naming neither a phase nor an active sub-stage cannot answer it. */
function targetsCurrentStage(b: Blocker, ctx: StageContext): boolean {
  if (b.blocks_phase && ctx.currentPhaseKey && b.blocks_phase === ctx.currentPhaseKey) return true;
  return !!b.blocks_substage && (ctx.activeSubstages ?? []).includes(b.blocks_substage);
}

export function selectBlockerView(blockers: Blocker[], ctx: StageContext): BlockerView {
  // Information Only creates no action and no blocker, so it leaves no trace.
  const active = blockers.filter((b) => b.status === 'active' && b.kind !== 'information_only');

  // Low confidence means the relationship is not proven, which is the
  // definition of Verify — regardless of how the row was classified.
  const evidenced = active.filter((b) => b.confidence >= MIN_CONFIDENCE);
  const unproven = active.filter((b) => b.confidence < MIN_CONFIDENCE);

  const counts: BlockerCounts = {
    blocking: evidenced.filter((b) => BLOCKING_KINDS.includes(b.kind)).length,
    waiting: evidenced.filter((b) => b.kind === 'external_gate').length,
    futureGate: evidenced.filter((b) => b.kind === 'future_gate').length,
    urgent: evidenced.filter((b) => b.kind === 'urgent_action').length,
    verify: evidenced.filter((b) => b.kind === 'verify').length + unproven.length,
  };

  // A Primary Blocker must be classified primary *and* aimed at the stage the
  // project is actually sitting on.
  const primary = evidenced
    .filter((b) => b.kind === 'primary' && targetsCurrentStage(b, ctx))
    .sort(strongest)[0] ?? null;

  // "If no Primary Blocker exists, display the strongest External Gate or
  // Workstream Blocker and label it accurately." Kind decides first, then age
  // within that kind — see FALLBACK_ORDER.
  const fallback = FALLBACK_ORDER
    .map((kind) => evidenced.filter((b) => b.kind === kind).sort(strongest)[0])
    .find(Boolean) ?? null;
  const headline = primary ?? fallback;

  // "If two independent workstreams are blocked, show Primary Blocker and
  // Technical Blocker separately." Never the same row twice.
  const technical = evidenced
    .filter((b) => b.kind === 'workstream' && b.id !== headline?.id)
    .sort(strongest)[0] ?? null;

  return { primary: headline, technical, primaryKind: headline?.kind ?? null, counts };
}
