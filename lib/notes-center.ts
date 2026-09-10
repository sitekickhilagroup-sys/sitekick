// Pure logic for the Notes Center (Noa's report §2 — a real screen, not a
// Markdown file in docs/). Kept out of the page/server action so the merge,
// dedup, candidate-ranking and state rules are unit-testable without a DB.
import { tokenize, titleSimilarity } from './dedup.ts';

export type NoteSource = 'assistant' | 'historical_attributed';
export type NoteState = 'needs_review' | 'associated' | 'general';

/** One note the center shows — either a real `comments` row, or a virtual
 *  item derived from a task's `latest_note` (never written until Noa acts). */
export interface NoteCard {
  /** Stable id: the comment's real id, or `hist:<taskId>` for a virtual one. */
  id: string;
  source: NoteSource;
  body: string;
  createdAt: string; // ISO
  /** null for a virtual historical item that hasn't been promoted yet. */
  entityType: 'task' | 'project' | 'invoice' | 'blocker' | 'general' | null;
  entityId: string | null;
  /** The task this virtual item was derived from — always set for historical
   *  items (that's where latest_note lives), separate from entityId/Type
   *  (which is what a promoted note may be RE-targeted to). */
  sourceTaskId: string | null;
  suggestedIntent: 'fact' | 'instruction' | 'preference';
  intent: 'fact' | 'instruction' | 'preference';
  state: NoteState;
}

// The one convention this codebase's historical notes actually used tonight
// (Noa's own review draft, docs/ai/handoffs/NOA_NOTES_REVIEW_DRAFT.md) — an
// in-text "(... via Claude)" attribution. It authenticates nothing (the brief
// is explicit about this); it is only how we FIND candidate historical notes
// worth surfacing, never proof a human confirmed them.
const ATTRIBUTION_RE = /\(\s*(?:noa|[a-z֐-׿]+)\s+via\s+claude/i;

export function isAttributedHistoricalNote(text: string | null | undefined): boolean {
  return !!text && ATTRIBUTION_RE.test(text);
}

export const historicalNoteId = (taskId: string): string => `hist:${taskId}`;
export const isHistoricalId = (id: string): boolean => id.startsWith('hist:');
export const taskIdFromHistoricalId = (id: string): string => id.slice('hist:'.length);

/**
 * Merge real `comments` rows with virtual historical items derived from
 * `tasks.latest_note`. A task's historical note is DROPPED once any real
 * comment already exists for that task (entity_type='task', entity_id=task.id)
 * — once Noa has engaged with a task's feedback through the center, the raw
 * historical line is superseded, not shown twice. Prevents duplicate creation
 * on every reload, since a virtual item is never inserted until acted on.
 */
export function mergeNoteSources(
  comments: { id: string; entityType: NoteCard['entityType']; entityId: string | null; body: string; suggestedIntent: NoteCard['suggestedIntent']; intent: NoteCard['intent']; createdBy: string; createdAt: string }[],
  historicalTasks: { taskId: string; latestNote: string; lastTouched: string | null }[],
): NoteCard[] {
  const tasksWithRealComments = new Set(
    comments.filter((c) => c.entityType === 'task' && c.entityId).map((c) => c.entityId as string),
  );
  const fromComments: NoteCard[] = comments.map((c) => ({
    id: c.id,
    source: 'assistant',
    body: c.body,
    createdAt: c.createdAt,
    entityType: c.entityType,
    entityId: c.entityId,
    sourceTaskId: c.entityType === 'task' ? c.entityId : null,
    suggestedIntent: c.suggestedIntent,
    intent: c.intent,
    state: c.entityType && c.entityType !== 'general' ? 'associated' : c.entityType === 'general' ? 'general' : 'needs_review',
  }));
  const fromHistory: NoteCard[] = historicalTasks
    .filter((h) => isAttributedHistoricalNote(h.latestNote) && !tasksWithRealComments.has(h.taskId))
    .map((h) => ({
      id: historicalNoteId(h.taskId),
      source: 'historical_attributed',
      body: h.latestNote,
      createdAt: h.lastTouched ?? '',
      entityType: null,
      entityId: null,
      sourceTaskId: h.taskId,
      suggestedIntent: 'fact', // classified on first real interaction (promotion), not before
      intent: 'fact',
      state: 'needs_review',
    }));
  return [...fromComments, ...fromHistory].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export interface TargetCandidate {
  kind: 'task' | 'project' | 'blocker';
  id: string;
  label: string;
  score: number; // 0..1, for ranking only — never asserted as a probability
  why: string;
}

/**
 * Rank candidate targets for one note's body against open tasks, active
 * projects and active blockers — task-title overlap via the SAME similarity
 * measure the dedup engine and the review drawer already use (titleSimilarity),
 * plus a plain substring check for project/blocker names (their "titles" are
 * short proper nouns, not sentences, so token-overlap scoring fits them
 * poorly). Returns the top N, highest first. Pure/testable.
 */
export function rankTargetCandidates(
  noteBody: string,
  pool: {
    tasks: { id: string; title: string }[];
    projects: { id: string; name: string }[];
    blockers: { id: string; what: string }[];
  },
  limit = 3,
): TargetCandidate[] {
  const out: TargetCandidate[] = [];
  for (const t of pool.tasks) {
    const score = titleSimilarity(noteBody, t.title);
    if (score > 0) out.push({ kind: 'task', id: t.id, label: t.title, score, why: `matches task title` });
  }
  const bodyTokens = tokenize(noteBody);
  for (const p of pool.projects) {
    const nameTokens = tokenize(p.name);
    if (nameTokens.size === 0) continue;
    let shared = 0;
    for (const tok of nameTokens) if (bodyTokens.has(tok)) shared++;
    const score = shared / nameTokens.size;
    if (score > 0) out.push({ kind: 'project', id: p.id, label: p.name, score, why: `mentions the project name` });
  }
  for (const b of pool.blockers) {
    const score = titleSimilarity(noteBody, b.what);
    if (score > 0) out.push({ kind: 'blocker', id: b.id, label: b.what, score, why: `matches an active blocker` });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Whether the top candidates are close enough to genuinely be ambiguous
 * (worth ONE focused question) rather than one clear leader. Pure so the rule
 * (not the wording) is testable: the gap between #1 and #2 must be small AND
 * #1 must not already be a near-certain match.
 */
export function isAmbiguous(candidates: TargetCandidate[]): boolean {
  if (candidates.length < 2) return false;
  const [first, second] = candidates;
  if (first.score >= 0.85) return false; // clear leader — do not ask needlessly
  return first.score - second.score < 0.2;
}

/** A short, templated clarifying question built from the top two candidates —
 *  not free-form NLP, just naming the two leading candidates so Noa's answer
 *  is a single pick, not a re-explanation. */
export function buildClarifyingQuestion(candidates: TargetCandidate[]): string | null {
  if (!isAmbiguous(candidates)) return null;
  const [a, b] = candidates;
  return `${a.label}\n${b.label}`;
}
