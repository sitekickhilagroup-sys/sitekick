import { describe, expect, it } from 'vitest';
import {
  buildFeedbackFact, classifyRetraction, deriveProvenance, interpretFeedback,
  INTERPRETER_VERSION, type ProposedRank,
} from './priority-feedback';

const RANK: ProposedRank = { run_id: 'run-1', global_rank: 3, urgency: 'now' };

describe('deriveProvenance', () => {
  it('is missing when there was no recommendation', () => {
    expect(deriveProvenance(null)).toBe('missing');
  });
  it('is assumed_latest_run when a rank exists but we cannot prove it was seen', () => {
    expect(deriveProvenance(RANK)).toBe('assumed_latest_run');
  });
  it('is confirmed_seen only when an impression matches the run', () => {
    expect(deriveProvenance(RANK, { impressionRunId: 'run-1' })).toBe('confirmed_seen');
    expect(deriveProvenance(RANK, { impressionRunId: 'run-2' })).toBe('assumed_latest_run');
  });
});

describe('buildFeedbackFact', () => {
  it('captures the rank as fact and never assumes provenance it cannot prove', () => {
    const f = buildFeedbackFact({
      taskId: 't1', event: 'completed', proposed: RANK,
      sourceActivityLogId: 'log-1', decidedBy: 'noa@x.com',
    });
    expect(f).toMatchObject({
      task_id: 't1', event: 'completed', run_id: 'run-1',
      proposed_global_rank: 3, proposed_urgency: 'now',
      recommendation_provenance: 'assumed_latest_run', source_activity_log_id: 'log-1',
    });
  });
  it('records missing provenance and null rank when no run was shown', () => {
    const f = buildFeedbackFact({
      taskId: 't1', event: 'completed', proposed: null,
      sourceActivityLogId: null, decidedBy: 'noa@x.com',
    });
    expect(f.run_id).toBeNull();
    expect(f.proposed_global_rank).toBeNull();
    expect(f.recommendation_provenance).toBe('missing');
  });
});

describe('interpretFeedback — fact and interpretation are separate (correction #2)', () => {
  it('gives no verdict when there is no recommendation to compare', () => {
    const f = buildFeedbackFact({ taskId: 't', event: 'not_applicable', proposed: null, sourceActivityLogId: null, decidedBy: 'n' });
    const i = interpretFeedback(f);
    expect(i.polarity).toBe('none');
    expect(i.confidence).toBe(0);
    expect(i.version).toBe(INTERPRETER_VERSION);
  });
  it('treats a completion as a fact with no per-row verdict', () => {
    const f = buildFeedbackFact({ taskId: 't', event: 'completed', proposed: RANK, sourceActivityLogId: null, decidedBy: 'n' });
    expect(interpretFeedback(f).polarity).toBe('none');
  });
  it('reads NA on a high-ranked item as a weak, low-confidence candidate only', () => {
    const f = buildFeedbackFact({ taskId: 't', event: 'not_applicable', proposed: RANK, sourceActivityLogId: null, decidedBy: 'n' });
    const i = interpretFeedback(f);
    expect(i.polarity).toBe('weak_negative');
    expect(i.confidence).toBeLessThanOrEqual(0.3);
  });
  it('does not flag NA on a low-ranked item', () => {
    const low: ProposedRank = { run_id: 'r', global_rank: 40, urgency: 'low' };
    const f = buildFeedbackFact({ taskId: 't', event: 'not_applicable', proposed: low, sourceActivityLogId: null, decidedBy: 'n' });
    expect(interpretFeedback(f).polarity).toBe('none');
  });
});

describe('classifyRetraction — undo/reopen are META, not discarded (correction #3)', () => {
  it('a near-immediate reversal with no new reason is a cancellation', () => {
    expect(classifyRetraction({ gapMs: 5_000, hasNewReason: false })).toBe('cancellation');
  });
  it('a reversal citing a new reason is a circumstance change', () => {
    expect(classifyRetraction({ gapMs: 5_000, hasNewReason: true })).toBe('circumstance');
    expect(classifyRetraction({ gapMs: 10 * 60_000, hasNewReason: true })).toBe('circumstance');
  });
  it('a considered later reversal with no new reason is a correction', () => {
    expect(classifyRetraction({ gapMs: 10 * 60_000, hasNewReason: false })).toBe('correction');
  });
});
