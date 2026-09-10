import { describe, expect, it } from 'vitest';
import {
  isAttributedHistoricalNote, mergeNoteSources, rankTargetCandidates, ensureSourceTaskCandidate,
  isAmbiguous, buildClarifyingQuestion, historicalNoteId,
} from './notes-center.ts';

describe('isAttributedHistoricalNote', () => {
  it('recognizes the "(Noa via Claude)" convention, EN and HE-adjacent forms', () => {
    expect(isAttributedHistoricalNote('2026-09-04 (Noa via Claude): Status refresh...')).toBe(true);
    expect(isAttributedHistoricalNote('(Noa via Claude, from mailbox): Correction...')).toBe(true);
  });
  it('is false for a plain status note with no attribution', () => {
    expect(isAttributedHistoricalNote('Rowan to Bob 08/18')).toBe(false);
    expect(isAttributedHistoricalNote(null)).toBe(false);
    expect(isAttributedHistoricalNote('')).toBe(false);
  });
});

describe('mergeNoteSources', () => {
  const comments = [
    { id: 'c1', entityType: 'task' as const, entityId: 't1', body: 'Greg fact', suggestedIntent: 'instruction' as const, intent: 'fact' as const, createdBy: 'noa', createdAt: '2026-09-09T02:09:00Z' },
  ];
  const historical = [
    { taskId: 't1', latestNote: '(Noa via Claude): note on t1', lastTouched: '2026-09-04' },
    { taskId: 't2', latestNote: '(Noa via Claude): note on t2', lastTouched: '2026-09-05' },
    { taskId: 't3', latestNote: 'plain status note, no attribution', lastTouched: '2026-09-06' },
  ];

  it("drops a task's historical note once a real comment exists for that task (no duplicate)", () => {
    const merged = mergeNoteSources(comments, historical);
    expect(merged.find((n) => n.id === historicalNoteId('t1'))).toBeUndefined();
    expect(merged.find((n) => n.id === 'c1')).toBeDefined();
  });
  it('keeps a historical note for a task with no real comment yet', () => {
    const merged = mergeNoteSources(comments, historical);
    expect(merged.find((n) => n.id === historicalNoteId('t2'))).toBeDefined();
  });
  it('excludes a note with no attribution convention (not treated as feedback)', () => {
    const merged = mergeNoteSources(comments, historical);
    expect(merged.find((n) => n.id === historicalNoteId('t3'))).toBeUndefined();
  });
  it('sorts newest first', () => {
    const merged = mergeNoteSources(comments, historical);
    const dates = merged.map((n) => n.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });
  it('never fabricates a fixed total — the count is just the merged list length', () => {
    // Regression guard for "11 is a stale snapshot, not a cap": this must scale
    // with input, not clamp.
    const manyHistorical = Array.from({ length: 20 }, (_, i) => ({
      taskId: `t${i + 10}`, latestNote: `(Noa via Claude): note ${i}`, lastTouched: '2026-09-01',
    }));
    expect(mergeNoteSources([], manyHistorical)).toHaveLength(20);
  });
});

describe('rankTargetCandidates', () => {
  const pool = {
    tasks: [
      { id: 'ta', title: 'LADBS returned the soils report — Bob to review and resubmit an addendum' },
      { id: 'tb', title: 'Obtain the soil approval letter from LADBS' },
      { id: 'tc', title: 'Unrelated task about invoices' },
    ],
    projects: [{ id: 'p1', name: '2650 Rinconia' }, { id: 'p2', name: '3375 Blair Dr' }],
    blockers: [{ id: 'b1', what: 'Plan check intake stalled awaiting City review' }],
  };
  it('ranks the closer task title higher for the Rinconia/Greg case', () => {
    const ranked = rankTargetCandidates('Greg confirmed the soils report addendum response timing', pool);
    expect(ranked[0].kind).toBe('task');
    expect(ranked[0].id).toBe('ta');
  });
  it('surfaces a project by name mention', () => {
    const ranked = rankTargetCandidates('Update on Rinconia grading', pool);
    expect(ranked.some((c) => c.kind === 'project' && c.id === 'p1')).toBe(true);
  });
  it('caps at the given limit', () => {
    expect(rankTargetCandidates('soils report addendum LADBS', pool, 2)).toHaveLength(2);
  });
});

describe('ensureSourceTaskCandidate — the note\'s own task is always a visible option', () => {
  // Live-observed gap: for "Obtain the soil approval letter from LADBS",
  // short generic titles ("Noa's agreement", "Noa's CAR") outscored the
  // note's own originating task by pure token-overlap math.
  const weakCandidates = [
    { kind: 'task' as const, id: 'na', label: "Noa's agreement", score: 0.30, why: '' },
    { kind: 'task' as const, id: 'nc', label: "Noa's CAR", score: 0.30, why: '' },
    { kind: 'task' as const, id: 'em03', label: 'LADBS returned the soils report — Bob to review and resubmit an addendum', score: 0.18, why: '' },
  ];
  it('adds the source task when it is missing, at a defensible mid score', () => {
    const out = ensureSourceTaskCandidate(weakCandidates, 'src1', 'Obtain the soil approval letter from LADBS', 4);
    expect(out.some((c) => c.id === 'src1')).toBe(true);
  });
  it('does not duplicate the source task when it is already ranked', () => {
    const withSource = [...weakCandidates, { kind: 'task' as const, id: 'src1', label: 'Obtain the soil approval letter from LADBS', score: 0.5, why: '' }];
    const out = ensureSourceTaskCandidate(withSource, 'src1', 'Obtain the soil approval letter from LADBS');
    expect(out.filter((c) => c.id === 'src1')).toHaveLength(1);
  });
  it('is a no-op for a note with no source task (a real, already-targeted comment)', () => {
    expect(ensureSourceTaskCandidate(weakCandidates, null, null)).toBe(weakCandidates);
  });
  it('respects the limit', () => {
    expect(ensureSourceTaskCandidate(weakCandidates, 'src1', 'Source task title', 3)).toHaveLength(3);
  });
});

describe('isAmbiguous / buildClarifyingQuestion', () => {
  it('is ambiguous when the top two are close and neither is a clear leader', () => {
    const cands = [
      { kind: 'task' as const, id: 'a', label: 'Soils report correction', score: 0.5, why: '' },
      { kind: 'blocker' as const, id: 'b', label: 'Soils approval blocker for city submission', score: 0.45, why: '' },
    ];
    expect(isAmbiguous(cands)).toBe(true);
    expect(buildClarifyingQuestion(cands)).toContain('Soils report correction');
    expect(buildClarifyingQuestion(cands)).toContain('Soils approval blocker for city submission');
  });
  it('is NOT ambiguous when the leader is clear — no needless question', () => {
    const cands = [
      { kind: 'task' as const, id: 'a', label: 'Exact match', score: 0.95, why: '' },
      { kind: 'task' as const, id: 'b', label: 'Weak match', score: 0.2, why: '' },
    ];
    expect(isAmbiguous(cands)).toBe(false);
    expect(buildClarifyingQuestion(cands)).toBeNull();
  });
  it('is not ambiguous with fewer than 2 candidates', () => {
    expect(isAmbiguous([{ kind: 'task', id: 'a', label: 'x', score: 0.5, why: '' }])).toBe(false);
    expect(isAmbiguous([])).toBe(false);
  });
});
