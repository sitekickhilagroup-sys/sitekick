// Pure selection logic for "which prioritization run does the user see" —
// pulled out of app/(dash)/(standard)/work/page.tsx so the rule that caused a
// live bug (2026-09-10) is unit-testable and can't silently regress.
//
// Bug history (docs/ai/DECISIONS.md D-011, OPEN_QUESTIONS.md Q-007, and the
// live incident this file was extracted to fix): applyPrioritization commits
// the `priority_runs` row before its `task_priorities` rows, so a crash in
// between leaves an EMPTY run behind — picking strictly the newest run by
// created_at can show "no AI ranks at all" even though a good prior run
// exists. D-011 fixed that by finding the newest run that has at least one
// row. But the FIX ITSELF then regressed: it fetched every row for the last
// 10 runs in one `.select('*').in('run_id', ids)` call with no ORDER BY —
// which silently truncates at PostgREST's default 1000-row cap, returned in
// physical/heap order (not recency order). On production this pushed the two
// newest runs entirely past the cutoff and left a third run half-truncated,
// so the page fell back to a stale, partial, day-old run.
//
// The fix: never fetch rows for more than one candidate run at a time. Check
// each candidate's row COUNT (a head:true query has no row body, so it is
// never subject to the row cap) newest-first, and only fetch the full row set
// for the run that turns out to be non-empty.
export interface RunCandidate {
  id: string;
  created_at: string;
}

/**
 * Picks the newest run (from `runs`, already ordered newest-first) whose
 * corresponding count in `counts` (same length, same order, count of
 * task_priorities rows for that run) is > 0. Pure — the caller does the I/O
 * (the count queries) and passes the results in.
 */
export function pickLatestNonEmptyRun(
  runs: RunCandidate[],
  counts: (number | null | undefined)[],
): RunCandidate | undefined {
  return runs.find((_, i) => (counts[i] ?? 0) > 0);
}
