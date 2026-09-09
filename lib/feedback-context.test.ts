import { describe, expect, it } from 'vitest';
import {
  feedbackUseEnabled, renderVerifiedNotes, renderMatchDecisions,
  loadVerifiedNotes, loadMatchDecisions,
  type VerifiedNote, type MatchDecision,
} from './feedback-context.ts';

describe('feedbackUseEnabled — the kill-switch (ON by default, reverts with off)', () => {
  it('is on by default (unset/empty/1/true/on)', () => {
    for (const v of [undefined, '', '1', 'true', 'on', 'TRUE', ' On ']) expect(feedbackUseEnabled({ FEEDBACK_USE: v })).toBe(true);
  });
  it('reverts only for an explicit 0/false/off', () => {
    for (const v of ['0', 'false', 'off', 'OFF', ' Off ']) expect(feedbackUseEnabled({ FEEDBACK_USE: v })).toBe(false);
  });
});

describe('renderVerifiedNotes — human-confirmed facts reach the prompt', () => {
  it('is empty with no notes (block absent)', () => {
    expect(renderVerifiedNotes([])).toBe('');
  });
  it('renders the note as authoritative context, tagged by task and intent', () => {
    const notes: VerifiedNote[] = [{
      taskId: '33677f42', intent: 'fact', date: '2026-09-09',
      body: 'Greg said he will revise and respond by the end of this week. The 2026-09-04 date did not come from him and is not his commitment.',
    }];
    const block = renderVerifiedNotes(notes);
    expect(block).toContain('HUMAN-VERIFIED CONTEXT');
    expect(block).toContain('authoritative');
    expect(block).toContain('[task 33677f42]');
    expect(block).toContain('(fact, 2026-09-09)');
    expect(block).toContain('is not his commitment');
  });
});

describe('renderMatchDecisions — reviewers\' match judgments reach the prompt', () => {
  it('is empty with no decisions', () => {
    expect(renderMatchDecisions([])).toBe('');
  });
  it('separates confirmed-same (prefer update) from rejected-not-same (never match)', () => {
    const decisions: MatchDecision[] = [
      { taskId: 't-soils', title: 'soils addendum resubmittal', same: true },
      { taskId: 't-loan', title: 'loan draw schedule', same: false },
    ];
    const block = renderMatchDecisions(decisions);
    expect(block).toContain('CONFIRMED THE SAME');
    expect(block).toContain('op="update"');
    expect(block).toContain('task t-soils');
    expect(block).toContain('REJECTED AS NOT THE SAME');
    expect(block).toContain('task t-loan');
  });
});

// The brief's step 5: prove the feedback ENTERS the active path. These assert
// the exact context blocks that get concatenated into the extractor/ranker
// prompt (agents/extract-comms.ts + agents/prioritize-tasks.ts) carry the right
// content for the three cases — without asserting a non-deterministic LLM output.
describe('feedback enters the active path — the three cases', () => {
  it('Greg: the fact correction is present and the invented date is disowned', () => {
    const block = renderVerifiedNotes([{
      taskId: '33677f42', intent: 'fact', date: '2026-09-09',
      body: 'The 2026-09-04 date is not his commitment; Greg said end of this week.',
    }]);
    expect(block).toContain('2026-09-04 date is not his commitment');
    expect(block).toMatch(/do NOT re-assert/i);
  });
  it('Rinconia: a relevant target is confirmed so the extractor updates instead of duplicating', () => {
    const block = renderMatchDecisions([{ taskId: '33677f42', title: 'LADBS returned the soils report', same: true }]);
    expect(block).toContain('CONFIRMED THE SAME');
    expect(block).toContain('task 33677f42');
  });
  it('Carlos: a not-same decision stops a wrong merge of separate decisions', () => {
    const block = renderMatchDecisions([{ taskId: 't-carlos-sign', title: 'retainer payment', same: false }]);
    expect(block).toContain('REJECTED AS NOT THE SAME');
    expect(block).toMatch(/do NOT match/i);
  });
});

describe('loaders honour the kill-switch (no DB touch when off)', () => {
  // An admin whose .from() throws — proves the loaders short-circuit before any query.
  const explodingAdmin = { from() { throw new Error('DB must not be touched when FEEDBACK_USE is off'); } } as never;
  it('loadVerifiedNotes returns [] without querying when reverted (off)', async () => {
    await expect(loadVerifiedNotes(explodingAdmin, ['t1'], { FEEDBACK_USE: 'off' })).resolves.toEqual([]);
  });
  it('loadMatchDecisions returns [] without querying when reverted (off)', async () => {
    await expect(loadMatchDecisions(explodingAdmin, { FEEDBACK_USE: 'off' })).resolves.toEqual([]);
  });
  it('loadVerifiedNotes returns [] for an empty task list even when on', async () => {
    await expect(loadVerifiedNotes(explodingAdmin, [], { FEEDBACK_USE: '1' })).resolves.toEqual([]);
  });
});
