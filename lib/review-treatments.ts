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

/** Treatments whose apply path UPDATES an existing task (vs create/link/info). */
const UPDATE_BRANCH: ChangeType[] = ['update_existing', 'complete_existing', 'merge_duplicate', 'keep_open'];

export type UpdateField = 'title' | 'owner' | 'due' | 'note' | 'status';

/**
 * Exactly which fields an Apply will change on the target task, given the
 * drawer's current inputs — so the human sees "what will change" before Apply
 * (handoff §2). Mirrors decideProposal's taskPatch precisely: title only on
 * update_existing; owner/due/note whenever set; complete_existing also closes
 * the task. Fields the human didn't fill are not listed and are never
 * overwritten. Pure/testable.
 */
export function updateFieldsPreview(
  treatment: ChangeType,
  edits: { title?: string; owner?: string; due?: string; note?: string },
): { field: UpdateField; value: string }[] {
  if (!UPDATE_BRANCH.includes(treatment)) return [];
  const title = (edits.title ?? '').trim();
  const owner = (edits.owner ?? '').trim();
  const due = (edits.due ?? '').trim();
  const note = (edits.note ?? '').trim();
  const out: { field: UpdateField; value: string }[] = [];
  if (treatment === 'update_existing' && title) out.push({ field: 'title', value: title });
  if (owner) out.push({ field: 'owner', value: owner });
  if (due) out.push({ field: 'due', value: due });
  if (note) out.push({ field: 'note', value: note });
  if (treatment === 'complete_existing') out.push({ field: 'status', value: 'done' });
  return out;
}

/**
 * Which open tasks the review drawer may offer as a manual target — the ones
 * in the project the human chose for this item (General = null). Lets Noa fix
 * an association the agent missed instead of being forced into "Create new
 * task" (which duplicates). Pure so it is unit-testable.
 */
export function selectableTasksFor<T extends { projectId: string | null }>(
  tasks: T[],
  chosenProject: string | null,
): T[] {
  const proj = chosenProject || null;
  return tasks.filter((task) => (task.projectId ?? null) === proj);
}

/**
 * Server-side guard for a MANUALLY chosen target task (the human's pick beats
 * the agent's guess, but only within these bounds): it must exist, be open,
 * and belong to the same project the item is being filed under. Returns the
 * error string, or null when the pick is valid. Pure — the caller does the
 * fetch and passes the row in.
 */
export function targetTaskError(
  task: { status: string; project_id: string | null } | null,
  chosenProject: string | null,
): string | null {
  if (!task) return 'target task not found';
  if (task.status !== 'open') return 'target task is not open';
  if ((task.project_id ?? null) !== (chosenProject || null)) return 'target task belongs to a different project';
  return null;
}
