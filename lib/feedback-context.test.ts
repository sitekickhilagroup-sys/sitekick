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
  /** When set, the isolation-filtered query fails with this code instead of
   *  the default 42703 (undefined_column) — simulates a REAL error (network,
   *  permissions) distinct from "the column doesn't exist yet". */
  errorCode?: string;
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
        if (wantsIsolation && (opts.errorCode || !opts.columnsExist)) {
          resolve({ data: null, error: { message: 'query failed', code: opts.errorCode ?? '42703' } });
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

/** Chainable fake for loadMatchDecisions: projects.select().eq('is_test',...),
 *  tasks.select().eq/or/in(...), and agent_proposals.select()...limit(). */
function fakeMatchDecisionsAdmin(opts: {
  columnsExist: boolean;
  errorCode?: string;
  testProjectIds?: string[];
  testTaskIds?: string[];
  proposals: { title: string | null; target_task_id: string; change_type: string | null; decided_by: string | null }[];
}) {
  const isolationError = () => ({ data: null, error: { message: 'query failed', code: opts.errorCode ?? '42703' } });
  const from = (table: string) => {
    if (table === 'projects') {
      return { select: () => ({ eq: () => (opts.errorCode || !opts.columnsExist
        ? Promise.resolve(isolationError())
        : Promise.resolve({ data: (opts.testProjectIds ?? []).map((id) => ({ id })), error: null })) }) };
    }
    if (table === 'tasks') {
      const resolveTasks = () => Promise.resolve({
        data: (opts.testTaskIds ?? []).map((id) => ({ id })), error: null,
      });
      return {
        select: () => ({
          eq: () => (opts.errorCode || !opts.columnsExist ? Promise.resolve(isolationError()) : resolveTasks()),
          or: () => (opts.errorCode || !opts.columnsExist ? Promise.resolve(isolationError()) : resolveTasks()),
        }),
      };
    }
    // agent_proposals
    return {
      select: () => ({
        not: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: opts.proposals, error: null }),
              }),
            }),
          }),
        }),
      }),
    };
  };
  return { from } as unknown as SupabaseClient;
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

describe('dedupeVerifiedNotes — content overlap ONLY, never proximity in time', () => {
  it("does NOT merge Noa's Hebrew + English Greg notes — proximity in time is not proof of duplication (Rotem's correction)", () => {
    const notes = [
      note({ taskId: '33677f42', intent: 'fact', body: 'גרג אמר שיתקן וישיב עד סוף השבוע. התאריך 04.09 אינו התחייבות שלו', at: '2026-09-09T02:03:58Z' }),
      note({ taskId: '33677f42', intent: 'fact', body: 'Greg said he will revise and respond by the end of this week. The 2026-09-04 date is not his commitment.', at: '2026-09-09T02:09:57Z' }),
    ];
    // Cross-language: near-zero shared tokens, written minutes apart. A prior
    // version merged these on the time gap alone — removed: two minutes apart
    // is not evidence they're the same correction, only content overlap is.
    expect(dedupeVerifiedNotes(notes)).toHaveLength(2);
  });
  it('DOES merge a genuine same-language restatement on the same task (real content overlap)', () => {
    const notes = [
      note({ taskId: '33677f42', intent: 'fact', body: 'Greg said he will revise and respond by the end of this week, not the 9/4 date', at: '2026-09-09T02:03:00Z' }),
      note({ taskId: '33677f42', intent: 'fact', body: 'Greg said he will revise and respond by the end of this week; the 9/4 date is not his commitment', at: '2026-09-10T18:00:00Z' }),
    ];
    // Hours apart, but the SAME words restated — this is what should collapse.
    expect(dedupeVerifiedNotes(notes)).toHaveLength(1);
  });
  it('keeps two genuinely different notes on the same task written minutes apart', () => {
    const notes = [
      note({ taskId: 't1', body: 'soils addendum still pending with Grover', at: '2026-06-01T00:00:00Z' }),
      note({ taskId: 't1', body: 'bond premium will rise because of the Gray delay', at: '2026-06-01T00:05:00Z' }),
    ];
    expect(dedupeVerifiedNotes(notes)).toHaveLength(2);
  });
  it('never merges notes across different tasks even with identical text', () => {
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
  it('FAILS CLOSED (returns []) on a real error — never falls back to unfiltered data on an arbitrary failure', async () => {
    // A permissions/network error (NOT 42703 undefined_column) must not be
    // treated the same as "migration not applied yet" — that would let a
    // real failure silently bypass isolation.
    const admin = fakeCommentsAdmin({ columnsExist: true, rows, errorCode: '42501' /* insufficient_privilege */ });
    await expect(loadVerifiedNotes(admin, ['t1'])).resolves.toEqual([]);
  });
});

describe('loadMatchDecisions excludes test-project/test-task targets (Rotem\'s isolation requirement)', () => {
  const proposals = [
    { title: 'Real match', target_task_id: 'real-task', change_type: 'update_existing', decided_by: 'noa.m@hillagroup.com' },
    { title: 'Direct test task', target_task_id: 'flagged-test-task', change_type: 'update_existing', decided_by: 'noa.m@hillagroup.com' },
    { title: 'Under test project', target_task_id: 'task-under-test-project', change_type: 'update_existing', decided_by: 'noa.m@hillagroup.com' },
  ];
  it('excludes a directly-flagged test task and one under a test project, once columns exist', async () => {
    const admin = fakeMatchDecisionsAdmin({
      columnsExist: true,
      testProjectIds: ['test-project-1'],
      testTaskIds: ['flagged-test-task', 'task-under-test-project'],
      proposals,
    });
    const decisions = await loadMatchDecisions(admin);
    expect(decisions.map((d) => d.taskId)).toEqual(['real-task']);
  });
  it('falls back to no exclusion when the columns do not exist yet (pre-migration) — still returns the real decisions', async () => {
    const admin = fakeMatchDecisionsAdmin({ columnsExist: false, proposals: [proposals[0]] });
    const decisions = await loadMatchDecisions(admin);
    expect(decisions.map((d) => d.taskId)).toEqual(['real-task']);
  });
  it('FAILS CLOSED (returns []) on a real error while determining test-task membership', async () => {
    const admin = fakeMatchDecisionsAdmin({ columnsExist: true, errorCode: '42501', proposals });
    await expect(loadMatchDecisions(admin)).resolves.toEqual([]);
  });
});
