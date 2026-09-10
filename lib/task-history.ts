// Pure shaping logic for the task History panel (components/work/task-history.tsx),
// extracted out of app/actions/tasks.ts's getTaskHistory so the two rules that
// matter most — "only the newest entry is undoable" and "last_touched never
// counts as a changed field" — are unit-testable without a database.
import { diffChangedKeys } from './invoice-rules';

export interface TaskHistoryRow {
  id: string;
  actor: string;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskHistoryEntryShape {
  id: string;
  actor: string;
  action: string;
  createdAt: string;
  changedKeys: string[];
  canUndo: boolean;
}

/**
 * Rows must already be ordered newest-first (the caller's `order by
 * created_at desc`) — canUndo is positional (index 0 only), not a
 * recomputed max(created_at), so an unordered input would silently make the
 * wrong entry (or none) revertible.
 */
export function buildTaskHistoryEntries(
  rows: TaskHistoryRow[],
  formatDate: (iso: string) => string,
): TaskHistoryEntryShape[] {
  return rows.map((row, i) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    createdAt: formatDate(row.created_at),
    // Every write touches last_touched — listing it as a "changed field" on
    // every single row would be noise, never information.
    changedKeys: diffChangedKeys(row.before_json, row.after_json).filter((k) => k !== 'last_touched'),
    // Only the single newest row with a restorable snapshot may be undone —
    // an older row could only be reverted by discarding whatever happened
    // after it, which is exactly the clobbering the history-undo guard
    // (revertTaskHistoryEntry's getLatestActivityLogId check) exists to
    // prevent, so it's never offered as an option in the first place.
    canUndo: i === 0 && !!row.before_json,
  }));
}
