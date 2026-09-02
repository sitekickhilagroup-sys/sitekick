// What the Import Review drawer may offer for a given proposal, and what it
// opens on. Shared by the drawer (client), the inbox page and decideProposal
// so the select, its default and the server all agree — a treatment the
// server must refuse can no longer be preselected.
import type { ChangeType, ProposalType } from './types.ts';

/** Proposal types that are not task edits at all: applying them writes a
 *  blocker, a relationship, a decision, a due date or a phase (applyProposal
 *  in lib/state-writer.ts). The drawer used to fall through to the task
 *  branches and create a task literally titled "X blocks Y". */
export const STRUCTURAL_TYPES: ProposalType[] = [
  'blocker_create', 'relationship_create', 'deadline_update', 'decision_create', 'phase_set',
];

export const isStructural = (type: ProposalType): boolean => STRUCTURAL_TYPES.includes(type);

/** Treatments that rewrite an existing task. Offering one when nothing
 *  matched preselects an action decideProposal must refuse ("this treatment
 *  needs an existing task") — which read as a dead Apply button. */
export const NEEDS_MATCH: ChangeType[] = [
  'update_existing', 'complete_existing', 'merge_duplicate', 'keep_both_linked', 'keep_open',
];

const TASK_TREATMENTS: ChangeType[] = [
  'new_task', 'update_existing', 'complete_existing', 'merge_duplicate',
  'keep_both_linked', 'keep_open', 'information_only',
];

export function treatmentsFor(type: ProposalType, matched: boolean): ChangeType[] {
  const base = matched ? TASK_TREATMENTS : TASK_TREATMENTS.filter((t) => !NEEDS_MATCH.includes(t));
  // Structural proposals keep the task options — turning a blocker into a
  // task is a real choice Noa makes — but lead with what the item actually is.
  return isStructural(type) ? ['apply_as_stated', ...base] : base;
}

export function defaultTreatment(type: ProposalType, matched: boolean): ChangeType {
  if (isStructural(type)) return 'apply_as_stated';
  if (!matched) return 'new_task';
  return type === 'task_done' ? 'complete_existing' : 'update_existing';
}
