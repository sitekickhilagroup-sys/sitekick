import { describe, expect, it } from 'vitest';
import { pickLatestNonEmptyRun, type RunCandidate } from './priority-run-select.ts';

const runs: RunCandidate[] = [
  { id: 'today', created_at: '2026-09-10T14:06:28Z' },
  { id: 'yesterday', created_at: '2026-09-09T14:06:22Z' },
  { id: 'stale-partial', created_at: '2026-09-08T21:57:30Z' },
  { id: 'older', created_at: '2026-09-08T14:06:26Z' },
];

describe('pickLatestNonEmptyRun', () => {
  it('picks the newest run when it has rows', () => {
    expect(pickLatestNonEmptyRun(runs, [130, 127, 136, 135])?.id).toBe('today');
  });

  it('skips an empty newest run and falls back to the next non-empty one (D-011)', () => {
    expect(pickLatestNonEmptyRun(runs, [0, 127, 136, 135])?.id).toBe('yesterday');
  });

  // The exact production incident this module was extracted to prevent: the
  // old row-cap bug made the two newest runs look empty (0 rows survived the
  // 1000-row truncation) while an older, partially-truncated run still had
  // SOME rows — so the page fell back to the stale one. With COUNTS (not a
  // truncated row fetch) as the input, this function must never do that: a
  // true zero count is the only reason to skip a run.
  it('never falls back past a run that genuinely has rows, even a small count', () => {
    expect(pickLatestNonEmptyRun(runs, [0, 0, 1, 135])?.id).toBe('stale-partial');
  });

  it('returns undefined when every run is empty', () => {
    expect(pickLatestNonEmptyRun(runs, [0, 0, 0, 0])).toBeUndefined();
  });

  it('treats null/undefined counts as empty, not as a crash', () => {
    expect(pickLatestNonEmptyRun(runs, [null, undefined, 5, 10])?.id).toBe('stale-partial');
  });

  it('returns undefined for an empty runs list', () => {
    expect(pickLatestNonEmptyRun([], [])).toBeUndefined();
  });
});
