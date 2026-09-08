// Notes assistant (Section 3) — pure intent classification for a note Noa
// writes. v1 does NO business actions: it only records the note, linked to an
// entity, with a first-pass interpretation she can correct. The interpretation
// is deliberately a transparent keyword heuristic (not an opaque LLM call), so
// it is deterministic, testable, and easy to explain — and it is always
// overridable in the UI.
//
// Decisions already settled (do not re-open): no business actions in v1; a note
// is information, never an instruction that overrides permissions; a temporary
// instruction must never be treated as a standing rule (that is exactly why the
// three intents are kept distinct and human-correctable).

export type CommentIntent = 'preference' | 'instruction' | 'fact';

export const INTENT_CLASSIFIER_VERSION = 'v1-keywords';

// A standing rule ("I always chase Crest at month-end"). Checked first: a
// preference outranks a same-sentence time word, because mis-filing a standing
// rule as a one-off loses the more valuable signal.
const PREFERENCE_CUES = [
  'always', 'generally', 'usually', 'every time', 'each time', 'tend to', 'i prefer', 'prefer to', 'as a rule', 'never ',
  'תמיד', 'בדרך כלל', 'כרגיל', 'כלל', 'ככלל', 'מעדיפה', 'מעדיף', 'נוטה', 'כל פעם', 'בכל פעם', 'לעולם לא', 'אף פעם',
];

// A one-off, time-bound instruction ("do this first today").
const INSTRUCTION_CUES = [
  'today', 'tonight', 'right now', 'this week', 'this morning', 'asap', 'by tomorrow', 'first thing',
  'היום', 'עכשיו', 'כרגע', 'השבוע', 'הערב', 'הבוקר', 'דחוף', 'מיד', 'עד מחר', 'קודם כל', 'תעשה עכשיו', 'לפני הכל',
];

const has = (haystack: string, cues: string[]) => cues.some((c) => haystack.includes(c));

/**
 * First-pass intent for a note. Preference (standing rule) wins over a
 * time-bound instruction when both are present; anything else is a plain fact/
 * context. Always a suggestion — the caller lets the human correct it.
 */
export function classifyIntent(text: string): CommentIntent {
  const t = (text ?? '').toLowerCase();
  if (has(t, PREFERENCE_CUES)) return 'preference';
  if (has(t, INSTRUCTION_CUES)) return 'instruction';
  return 'fact';
}

export const INTENTS: CommentIntent[] = ['preference', 'instruction', 'fact'];
export const isIntent = (v: string): v is CommentIntent => (INTENTS as string[]).includes(v);
