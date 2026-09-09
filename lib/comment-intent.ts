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

// v2 (Noa's report §3): the v1 heuristic classified any note containing a time
// word ("this week"/"השבוע") as an instruction, so a fact ABOUT A THIRD PARTY —
// "גרג אמר שיחזור השבוע" — was mis-read as a directive. A time word alone is not
// a directive. What makes a note an instruction is a REQUEST DIRECTED AT THE
// READER (an imperative / "remind me" / "please …"); and a request that is
// merely quoted inside a report ("Greg said 'send it this week'") is still a
// fact. Time words no longer classify anything.
export const INTENT_CLASSIFIER_VERSION = 'v2-directional';

// A standing rule ("I always chase Crest at month-end"). Checked first: a
// preference outranks a same-sentence directive, because mis-filing a standing
// rule as a one-off loses the more valuable signal.
const PREFERENCE_CUES = [
  'always', 'generally', 'usually', 'every time', 'each time', 'tend to', 'i prefer', 'prefer to', 'as a rule', 'never ',
  'תמיד', 'בדרך כלל', 'כרגיל', 'כלל', 'ככלל', 'מעדיפה', 'מעדיף', 'נוטה', 'כל פעם', 'בכל פעם', 'לעולם לא', 'אף פעם',
];

// A directive aimed at the reader — an explicit request or a (Hebrew) 2nd-person
// imperative. Only these make a note an instruction. Kept to unambiguous markers
// so a third-person statement ("Rowan added a clause") is not swept up; a bare
// English imperative with no marker falls to the safe default (fact), which the
// human can still correct — the error the brief warns against is the reverse,
// a fact mis-read as an instruction.
const REQUEST_CUES = [
  'remind me', 'please', "let's ", 'lets ', 'make sure', "don't forget", 'do not forget',
  'can you', 'could you', 'need you to', 'i need you to', 'do this', 'do that', 'prioriti',
  'תזכיר', 'תדאג', 'תעדיף', 'תפנה', 'תפני', 'תשלח', 'תוסיף', 'תסמן', 'תעביר', 'תעדכן',
  'תקבע', 'תמחק', 'תעשה', 'תעשי', 'תטפל', 'תבדוק', 'תבדקי', 'בבקשה', 'אל תשכח',
];

// A third-party report / quotation ("Greg said …", "לפי רואן"). When one of these
// precedes a request cue, the request is being REPORTED, not issued — so the note
// stays a fact.
const REPORT_CUES = [
  'said', 'says', 'told', 'mentioned', 'confirmed', 'reported', 'noted', 'stated',
  'informed', 'replied', 'responded', 'according to', 'wrote',
  'אמר', 'מסר', 'ציין', 'הודיע', 'אישר', 'כתב', 'דיווח', 'לדברי', 'לפי ', 'ענה', 'השיב', 'סיפר',
];

const has = (haystack: string, cues: string[]) => cues.some((c) => haystack.includes(c));

// Earliest position at which any cue appears, or Infinity when none do.
const firstIndex = (haystack: string, cues: string[]): number =>
  cues.reduce((min, c) => {
    const i = haystack.indexOf(c);
    return i >= 0 && i < min ? i : min;
  }, Infinity);

/**
 * First-pass intent for a note. Preference (standing rule) wins first. An
 * instruction requires a directive aimed at the reader; a directive that a
 * reporting verb precedes is a quoted request and stays a fact. Everything else
 * — third-party reports, status statements, negations/corrections — is fact.
 * Always a suggestion; the caller lets the human correct it.
 */
export function classifyIntent(text: string): CommentIntent {
  const t = (text ?? '').toLowerCase();
  if (has(t, PREFERENCE_CUES)) return 'preference';
  const reqIdx = firstIndex(t, REQUEST_CUES);
  if (reqIdx === Infinity) return 'fact';
  // A request cue exists — but if a report cue comes first, the request is being
  // reported (quoted), not issued to the reader.
  const repIdx = firstIndex(t, REPORT_CUES);
  if (repIdx < reqIdx) return 'fact';
  return 'instruction';
}

export const INTENTS: CommentIntent[] = ['preference', 'instruction', 'fact'];
export const isIntent = (v: string): v is CommentIntent => (INTENTS as string[]).includes(v);
