// My Work row verbs (client handoff: Completed, Sent email, Waiting, Delayed,
// Scheduled, Not applicable, Add note) → tasks UPDATE patch + audit action.

export type WorkVerb =
  | 'completed' | 'sent_email' | 'waiting' | 'delayed'
  | 'scheduled' | 'not_applicable' | 'note';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function verbToPatch(
  verb: WorkVerb,
  input: string | null,
  today: string,
): { patch: Record<string, unknown>; action: string } | { error: string } {
  const text = (input ?? '').trim();
  const base = { last_touched: today };
  const action = `verb:${verb}`;
  switch (verb) {
    case 'completed':      return { patch: { status: 'done', ...base }, action };
    case 'not_applicable': return { patch: { status: 'dropped', ...base }, action };
    case 'sent_email':     return { patch: { ...base }, action };
    case 'waiting':
      if (!text) return { error: 'input required' };
      return { patch: { waiting_for: text, ...base }, action };
    case 'delayed':
    case 'scheduled':
      if (!DATE_RE.test(text)) return { error: 'invalid date' };
      return { patch: { due: text, ...base }, action };
    case 'note':
      if (!text) return { error: 'input required' };
      return { patch: { latest_note: text, ...base }, action };
  }
}

/** Every column a work-verb or task-details write can touch, and therefore
 *  every column undoWorkVerb (app/actions/work.ts) may need to restore from
 *  a task's before_json snapshot. */
export const UNDO_RESTORE_KEYS = [
  'status', 'waiting_for', 'due', 'last_touched', 'description', 'owner', 'latest_note',
  'project_id', 'substage_template_id', 'workstream_id', 'process_impact',
] as const;

/**
 * C1 (whole-branch review): builds the UPDATE payload undoWorkVerb sends to
 * restore a task from its before_json snapshot — restoring ONLY the keys the
 * snapshot actually captured, via `k in before`. A pre-0015 snapshot never
 * has latest_note/substage_template_id/workstream_id (the row SELECT simply
 * had no such column to return at the time), so sending them anyway 400s the
 * WHOLE restore with PGRST204 — turning Undo into a dead button for every
 * verb, not just the ones that touch those three columns. Correct in general
 * too, not just as a migration workaround: a partial snapshot must never
 * null out a column it did not capture.
 */
export function buildUndoRestorePatch(before: Record<string, unknown>): Record<string, unknown> {
  const restore: Record<string, unknown> = {};
  for (const k of UNDO_RESTORE_KEYS) {
    if (k in before) restore[k] = before[k] ?? null;
  }
  return restore;
}
