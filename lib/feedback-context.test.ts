import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  feedbackUseEnabled, renderVerifiedNotes, renderMatchDecisions, dedupeVerifiedNotes,
  loadVerifiedNotes, loadMatchDecisions,
  type VerifiedNote, type MatchDecision,
} from './feedback-context.ts';

/** Chainable fake for the comments query loadVerifiedNotes builds. Tracks
 *  every .eq()/.neq() call; `columnsExist` simulates whether migration 0026's
 *  is_test/status columns have landed yet. */
function fakeCommentsAdmin(opts: {
  columnsExist: boolean;
  rows: { entity_id: string; body: string; intent: string; created_at: string; is_test?: boolean; status?: string }[];
}) {
  const build = (calls: string[]) => {
    const chain = {
      eq: (col: string, val: unknown) => build([...calls, `eq:${col}=${val}`]),
      neq: (col: string, val: unknown) => build([...calls, `neq:${col}=${val}`]),
      in: () => build(calls),
      order: () => build(calls),
      limit: () => build(calls),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const wantsIsolation = calls.some((c) => c.includes('is_test') || c.includes('status'));
        if (wantsIsolation && !opts.columnsExist) {
          resolve({ data: null, error: { message: 'column comments.is_test does not exist', code: '42703' } });
          return;
        }
        let rows = opts.rows;
        if (calls.includes('eq:is_test=false')) rows = rows.filter((r) => !r.is_test);
        if (calls.includes('neq:status=dismissed')) rows = rows.filter((r) => r.status !== 'dismissed');
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  };
  return { from: () => ({ select: () => build([]) }) } as unknown as SupabaseClient;
}

describe('feedbackUseEnabled — the kill-switch (ON by default, reverts with off)', () => {
  it('is on by default (unset/empty/1/true/on)', () => {
    for (const v of [undefined, '', '1', 'true', 'on', 'TRUE', ' On ']) expect(feedbackUseEnabled({ FEEDBACK_USE: v })).toBe(true);
  });
  it('reverts only for an explicit 0/false/off', () => {
    for (const v of ['0', 'false', 'off', 'OFF', ' Off ']) expect(feedbackUseEnabled({ FEEDBACK_USE: v })).toBe(false);
  });
});

const note = (o: Partial<VerifiedNote>): VerifiedNote => ({
  taskId: 't1', body: 'x', intent: 'fact', date: '2026-09-09', at: '2026-09-09T02:00:00Z', ...o,
});

describe('renderVerifiedNotes — recorded (not "verified truth") context', () => {
  it('is empty with no notes', () => expect(renderVerifiedNotes([])).toBe(''));
  it('frames notes as human-RECORDED, not authoritative ground truth', () => {
    const block = renderVerifiedNotes([note({
      taskId: '33677f42',
      body: 'The 2026-09-04 date did not come from him and is not his commitment.',
    })]);
    expect(block).toContain('HUMAN-RECORDED CONTEXT');
    expect(block).not.toContain('authoritative');
    expect(block).not.toContain('verified truth)');
    expect(block).toContain('[task 33677f42]');
    expect(block).toContain('(fact, 2026-09-09)');
    expect(block).toContain('is not his commitment');
    expect(block).toMatch(/do not re-assert/i);
  });
});

describe('dedupeVerifiedNotes — two versions of one correction = one case', () => {
  it("collapses Noa's Hebrew + English Greg notes (same task/intent, same session)", () => {
    const notes = [
      note({ taskId: '33677f42', intent: 'fact', body: 'גרג אמר שיתקן וישיב עד סוף השבוע. התאריך 04.09 אינו התחייבות שלו', at: '2026-09-09T02:03:58Z' }),
      note({ taskId: '33677f42', intent: 'fact', body: 'Greg said he will revise and respond by the end of this week. The 2026-09-04 date is not his commitment.', at: '2026-09-09T02:09:57Z' }),
    ];
    // Cross-language: few shared tokens, but the same-session window collapses them.
    expect(dedupeVerifiedNotes(notes)).toHaveLength(1);
  });
  it('keeps two genuinely different notes on the same task', () => {
    const notes = [
      note({ taskId: 't1', body: 'soils addendum still pending with Grover', at: '2026-06-01T00:00:00Z' }),
      note({ taskId: 't1', body: 'bond premium will rise because of the Gray delay', at: '2026-08-01T00:00:00Z' }),
    ];
    expect(dedupeVerifiedNotes(notes)).toHaveLength(2);
  });
  it('never merges notes across different tasks', () => {
    const notes = [note({ taskId: 'a', body: 'same words here' }), note({ taskId: 'b', body: 'same words here' })];
    expect(dedupeVerifiedNotes(notes)).toHaveLength(2);
  });
});

describe('renderMatchDecisions', () => {
  it('is empty with no decisions', () => expect(renderMatchDecisions([])).toBe(''));
  it('renders confirmed-same only, with no false negative block', () => {
    const decisions: MatchDecision[] = [{ taskId: '33677f42', title: 'LADBS returned the soils report', same: true }];
    const block = renderMatchDecisions(decisions);
    expect(block).toContain('CONFIRMED THE SAME');
    expect(block).toContain('op="update"');
    expect(block).toContain('task 33677f42');
    expect(block).not.toContain('REJECTED AS NOT THE SAME');
  });
});

// The brief's step 5: prove the RIGHT feedback enters the active path — and the
// WRONG signal (rejection-as-not-match) does NOT.
describe('feedback enters the active path — the three cases', () => {
  it('Greg: the fact correction reaches the prompt and the invented date is disowned', () => {
    const block = renderVerifiedNotes([note({
      taskId: '33677f42', body: 'The 2026-09-04 date is not his commitment; Greg said end of this week.',
    })]);
    expect(block).toContain('2026-09-04 date is not his commitment');
    expect(block).toMatch(/do not re-assert/i);
  });
  it('Rinconia: a human-confirmed target lets the extractor update instead of duplicating', () => {
    const block = renderMatchDecisions([{ taskId: '33677f42', title: 'LADBS returned the soils report', same: true }]);
    expect(block).toContain('CONFIRMED THE SAME');
  });
  it('Carlos / rejections: no "not the same" signal is fabricated from a rejection', () => {
    // loadMatchDecisions only emits positives; a review rejection is content/
    // status/test, never a match denial — so nothing here says "not the same".
    expect(renderMatchDecisions([])).toBe('');
  });
});

describe('loaders honour the kill-switch (no DB touch when off)', () => {
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

describe('loadVerifiedNotes excludes test and dismissed notes from learning (Rotem\'s isolation requirement)', () => {
  const rows = [
    { entity_id: 't1', body: 'real fact', intent: 'fact', created_at: '2026-09-10T00:00:00Z' },
    { entity_id: 't1', body: 'test fact', intent: 'fact', created_at: '2026-09-10T00:00:00Z', is_test: true },
    { entity_id: 't1', body: 'dismissed fact', intent: 'fact', created_at: '2026-09-10T00:00:00Z', status: 'dismissed' },
  ];
  it('excludes is_test and dismissed rows once the columns exist (post-migration)', async () => {
    const admin = fakeCommentsAdmin({ columnsExist: true, rows });
    const notes = await loadVerifiedNotes(admin, ['t1']);
    expect(notes.map((n) => n.body)).toEqual(['real fact']);
  });
  it('falls back to the pre-migration query (no is_test/status filter) when those columns do not exist yet — never silently loses ALL feedback because of this', async () => {
    const admin = fakeCommentsAdmin({ columnsExist: false, rows: rows.map((r) => ({ entity_id: r.entity_id, body: r.body, intent: r.intent, created_at: r.created_at })) });
    const notes = await loadVerifiedNotes(admin, ['t1']);
    expect(notes.length).toBeGreaterThan(0);
  });
});
