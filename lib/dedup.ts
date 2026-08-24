import type { Task } from './types.ts';

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
