import type { Relationship, RelationshipType, Task } from './types.ts';

// Deterministic task matcher: does a candidate describe the same work as an
// existing open task? Used to update instead of duplicate (client item 1).

const STOP = new Set(['the', 'a', 'an', 'for', 'of', 'to', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'is', 'be']);

export function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function containment(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let inter = 0;
  for (const w of small) if (big.has(w)) inter++;
  return inter / small.size;
}

export interface TaskCandidate {
  title: string;
  project_id: string | null;
  stage_key?: string | null;
}

export function matchExistingTask(candidate: TaskCandidate, open: Task[]): Task | null {
  const cTokens = tokenize(candidate.title);
  let best: Task | null = null;
  let bestScore = 0;
  for (const t of open) {
    // Two *known* projects are still never conflated. But an unassigned row —
    // the one that renders as "General" — has to be comparable to the same work
    // filed against a project: every duplicate group in the audit was exactly
    // that pair, and skipping it meant they could never be found.
    const sameProject = t.project_id === candidate.project_id;
    const oneUnassigned = t.project_id === null || candidate.project_id === null;
    if (!sameProject && !oneUnassigned) continue;

    const tTokens = tokenize(t.title);
    let score = Math.max(jaccard(cTokens, tTokens), containment(cTokens, tTokens) - 0.2);
    if (candidate.stage_key && t.stage_key && candidate.stage_key !== t.stage_key) {
      score -= 0.15;
    }
    // When a General twin and a properly filed row score alike, prefer the one
    // already attached to the project.
    if (!sameProject) score -= 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

/** True when `a` and `b` already carry an 'unrelated' relationship between
 *  them, in either direction — the persisted record of Noa's "Not a
 *  duplicate" decision (app/actions/relationships.ts's saveRelationship).
 *  A pair she has already told apart must not resurface as a suggestion on
 *  the next page load, or the review list becomes noise she learns to
 *  ignore. Takes a minimal pick rather than a full Relationship so callers
 *  (and tests) don't have to build a complete row just to check this. */
function isMarkedUnrelated(
  aId: string,
  bId: string,
  relationships: Pick<Relationship, 'from_task_id' | 'to_task_id' | 'type'>[],
): boolean {
  return relationships.some((r) => r.type === 'unrelated'
    && ((r.from_task_id === aId && r.to_task_id === bId) || (r.from_task_id === bId && r.to_task_id === aId)));
}

/**
 * Pairs of open tasks that look like the same work (General twin ↔ project
 * row). Two exclusions apply before a match becomes a pair:
 *
 *  - a task with `merged_into` set is history, not a live candidate, on
 *    either side of a pair. Every caller today already queries
 *    `status = 'open'` (a merge always sets status to 'merged' in the same
 *    write — see lib/merge.ts's planMerge), which excludes it too, but that
 *    is the caller's discipline, not something this function can assume —
 *    enforced here directly instead.
 *  - a pair already marked 'unrelated' (isMarkedUnrelated above) is skipped.
 *    `relationships` defaults to empty, so a caller with no relationships
 *    handy (or the existing tests below) gets the old behavior unchanged.
 */
export function findDuplicatePairs(
  open: Task[],
  relationships: Pick<Relationship, 'from_task_id' | 'to_task_id' | 'type'>[] = [],
): Array<[Task, Task]> {
  const candidates = open.filter((t) => !t.merged_into);
  const pairs: Array<[Task, Task]> = [];
  for (let i = 0; i < candidates.length; i++) {
    const match = matchExistingTask(
      { title: candidates[i].title, project_id: candidates[i].project_id, stage_key: candidates[i].stage_key },
      candidates.slice(i + 1),
    );
    if (match && !isMarkedUnrelated(candidates[i].id, match.id, relationships)) {
      pairs.push([candidates[i], match]);
    }
  }
  return pairs;
}

export type NotDuplicateOutcome =
  // A meaningful edge already exists between these two — refuse rather than
  // let it happen.
  | { kind: 'blocked'; conflictType: RelationshipType }
  // Already marked 'unrelated' (either direction) — nothing to write.
  | { kind: 'noop' }
  | { kind: 'write' };

/**
 * Decides what "Not a duplicate" is allowed to do, given every existing
 * relationship row between the two tasks (both directions — the caller
 * fetches with `.in(from,[a,b]).in(to,[a,b])`, so `existing` already covers
 * a->b and b->a alike).
 *
 * saveRelationship upserts on `(from_task_id, to_task_id)` alone, not on
 * type — calling it blind here would silently overwrite a real, verified
 * edge (e.g. a 'blocks' relationship) with 'unrelated' the moment two tasks
 * that are ALSO linked happen to look like title duplicates. And because
 * that key is direction-sensitive, an edge recorded in the reverse
 * direction wouldn't even conflict at the database level — writing a->b
 * would leave a second, contradictory row sitting next to an untouched b->a.
 *
 * Pure and separated from app/actions/relationships.ts's markPairNotDuplicate
 * (the fetch-then-decide-then-write action) so the decision itself — the
 * part that actually matters for safety — is unit-testable without mocking
 * Supabase.
 */
export function decideNotDuplicateOutcome(
  existing: Pick<Relationship, 'type'>[],
): NotDuplicateOutcome {
  const conflicting = existing.find((r) => r.type !== 'unrelated');
  if (conflicting) return { kind: 'blocked', conflictType: conflicting.type };
  if (existing.some((r) => r.type === 'unrelated')) return { kind: 'noop' };
  return { kind: 'write' };
}
