import type { Task, TaskPriority } from './types.ts';

/**
 * Field transfer for merging a duplicate task into a Master Action.
 *
 * The governing rule is that a merge must never lose information. The master
 * keeps every value it already has; the loser only fills the master's gaps.
 * Where both hold a real value and one has to win — dates, priority — the more
 * urgent one wins, because a merge should not quietly relax a commitment.
 *
 * The loser row is not deleted. It is marked merged and keeps its own fields,
 * which is what makes undo a matter of clearing three columns.
 */

const RANK: Record<TaskPriority, number> = { normal: 0, high: 1, critical: 2 };

/** Earlier of two dates, ignoring nulls. An earlier commitment is the real one. */
function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** Master's value unless it is empty, in which case the loser's fills the gap. */
function fill<T>(masterValue: T | null | undefined, loserValue: T | null | undefined): T | null {
  return (masterValue ?? null) || (loserValue ?? null) || null;
}

export interface MergePatch {
  /** Fields to write onto the Master Action. Empty when it already had it all. */
  master: Partial<Task>;
  /** Fields to write onto the losing row. */
  loser: {
    status: 'merged';
    merged_into: string;
    merged_at: string;
    merged_by: string;
  };
}

export function planMerge(
  master: Task,
  loser: Task,
  opts: { actor: string; now: string },
): MergePatch {
  const patch: Partial<Task> = {};

  // Project, phase and sub-stage links. This is also the fix for a duplicate
  // that sat under General: merging into the properly filed record, or filling
  // the master's missing project from the loser, ends with one correctly
  // attributed task rather than one in limbo.
  const project = fill(master.project_id, loser.project_id);
  if (project !== master.project_id) patch.project_id = project;

  const stage = fill(master.stage_key, loser.stage_key);
  if (stage !== master.stage_key) patch.stage_key = stage;

  // Source evidence.
  const evidence = fill(master.document_id, loser.document_id);
  if (evidence !== master.document_id) patch.document_id = evidence;

  const source = fill(master.source, loser.source);
  if (source !== master.source) patch.source = source;

  // Who we are waiting on, and who owns it.
  const waiting = fill(master.waiting_for, loser.waiting_for);
  if (waiting !== master.waiting_for) patch.waiting_for = waiting;

  const owner = fill(master.owner, loser.owner);
  if (owner !== master.owner) patch.owner = owner;

  // Dates: keep the nearest commitment from either record.
  const due = earlier(master.due ?? null, loser.due ?? null);
  if (due !== (master.due ?? null)) patch.due = due;

  const followUp = earlier(master.follow_up_date ?? null, loser.follow_up_date ?? null);
  if (followUp !== (master.follow_up_date ?? null)) patch.follow_up_date = followUp;

  const checkBack = earlier(master.check_back_on ?? null, loser.check_back_on ?? null);
  if (checkBack !== (master.check_back_on ?? null)) patch.check_back_on = checkBack;

  // Priority: the more urgent of the two. Merging must not de-escalate work.
  if (RANK[loser.priority] > RANK[master.priority]) patch.priority = loser.priority;

  // Notes. Both are kept — appended, never overwritten — because the note text
  // is often the only record of why the task exists.
  const masterNote = (master.description ?? '').trim();
  const loserNote = (loser.description ?? '').trim();
  if (loserNote && loserNote !== masterNote) {
    patch.description = masterNote ? `${masterNote}\n\n${loserNote}` : loserNote;
  }

  return {
    master: patch,
    loser: {
      status: 'merged',
      merged_into: master.id,
      merged_at: opts.now,
      merged_by: opts.actor,
    },
  };
}
