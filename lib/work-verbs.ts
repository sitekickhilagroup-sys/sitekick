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
