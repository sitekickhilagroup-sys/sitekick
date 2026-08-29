import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attributionTokens, classifyProposal, computeClassStats, isNoOpUpdate, isSafeEnrichment,
  matchAttribution, payloadShape, proposalClass, runAutoTriage, type ClassStats, type HistoryRow,
} from './auto-triage';
import type { AgentProposal, Task } from './types';

type P = Pick<AgentProposal, 'type' | 'reasoning' | 'confidence' | 'project_id' | 'target_task_id' | 'payload'>;
type T = Pick<Task, 'due' | 'owner' | 'priority' | 'status' | 'description' | 'waiting_for'>;

const matchedUpdate = (payload: Record<string, unknown> = {}): P => ({
  type: 'task_update',
  reasoning: 'model matched existing task',
  confidence: 0.8,
  project_id: 'blair',
  target_task_id: 't1',
  payload,
});

const openTask = (over: Partial<T> = {}): T => ({
  due: null, owner: null, priority: 'normal', status: 'open', description: null, waiting_for: null, ...over,
});

const noStats = new Map<string, ClassStats>();

describe('isSafeEnrichment', () => {
  it('accepts pure additions — description, waiting_for, filling an empty due', () => {
    expect(isSafeEnrichment({ description: 'x', waiting_for: 'Rowan', due: '2026-09-01' }, openTask())).toBe(true);
  });
  it('rejects closing, moving a real date, flipping owner, escalating to critical', () => {
    expect(isSafeEnrichment({ status: 'done' }, openTask())).toBe(false);
    expect(isSafeEnrichment({ due: '2026-09-02' }, openTask({ due: '2026-09-01' }))).toBe(false);
    expect(isSafeEnrichment({ owner: 'Abhi' }, openTask({ owner: 'Rowan' }))).toBe(false);
    expect(isSafeEnrichment({ priority: 'critical' }, openTask())).toBe(false);
  });
  it('same value re-asserted is not a conflict', () => {
    expect(isSafeEnrichment({ due: '2026-09-01', owner: 'rowan' }, openTask({ due: '2026-09-01', owner: 'Rowan' }))).toBe(true);
  });
});

describe('isNoOpUpdate — the provable echo', () => {
  it('true when every asserted field already matches the register', () => {
    const t = openTask({ due: '2026-09-01', owner: 'Rowan', description: 'Waiting on the city.' });
    expect(isNoOpUpdate({ due: '2026-09-01', owner: 'rowan', description: 'waiting on the city.' }, t)).toBe(true);
    expect(isNoOpUpdate({}, t)).toBe(true);
  });
  it('false the moment anything new appears', () => {
    const t = openTask({ due: '2026-09-01' });
    expect(isNoOpUpdate({ description: 'City confirmed receipt 8/28.' }, t)).toBe(false);
    expect(isNoOpUpdate({ due: '2026-09-05' }, t)).toBe(false);
    expect(isNoOpUpdate({ owner: 'Abhi' }, t)).toBe(false);
    expect(isNoOpUpdate({ status: 'done' }, t)).toBe(false);
  });
});

describe('classifyProposal defaults + provable no-ops', () => {
  it('auto-applies an id-matched enrichment on an open task', () => {
    const v = classifyProposal(matchedUpdate({ description: 'new info' }), openTask(), noStats);
    expect(v.action).toBe('auto_apply');
  });
  it('keeps a conflicting delta for review even at high confidence', () => {
    const v = classifyProposal(matchedUpdate({ due: '2026-09-05' }), openTask({ due: '2026-09-01' }), noStats);
    expect(v.action).toBe('review');
  });
  it('keeps task_done for review — closing needs a human or a learned class', () => {
    const v = classifyProposal({ ...matchedUpdate({ status: 'done' }), type: 'task_done' }, openTask(), noStats);
    expect(v.action).toBe('review');
  });
  it('ignores a provable echo — asserts only what the register already says', () => {
    const t = openTask({ due: '2026-09-01', owner: 'Rowan' });
    const v = classifyProposal(matchedUpdate({ due: '2026-09-01', owner: 'Rowan' }), t, noStats);
    expect(v.action).toBe('auto_ignore');
    expect(v.reason).toContain('no-op');
  });
  it('ignores a completion aimed at a task that is already closed', () => {
    const v = classifyProposal(
      { ...matchedUpdate({ status: 'done' }), type: 'task_done' },
      openTask({ status: 'done' }),
      noStats,
    );
    expect(v.action).toBe('auto_ignore');
    expect(v.reason).toContain('moot');
  });
  it('auto-applies an attributed decision, reviews an unattributed one', () => {
    const base: P = { type: 'decision_create', reasoning: 'decision asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: { title: 'x' } };
    expect(classifyProposal(base, null, noStats).action).toBe('auto_apply');
    expect(classifyProposal({ ...base, project_id: null }, null, noStats).action).toBe('review');
  });
  it('keeps blockers and relationships for review by default', () => {
    const b: P = { type: 'blocker_create', reasoning: 'new blocker asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: {} };
    const r: P = { type: 'relationship_create', reasoning: 'x blocks y', confidence: 0.5, project_id: 'blair', target_task_id: null, payload: {} };
    expect(classifyProposal(b, null, noStats).action).toBe('review');
    expect(classifyProposal(r, null, noStats).action).toBe('review');
  });
});

describe('payload shape — fine-grained learning classes', () => {
  it('names the riskiest asserted field', () => {
    expect(payloadShape('task_update', { status: 'done' })).toBe('closes');
    expect(payloadShape('task_done', {})).toBe('closes');
    expect(payloadShape('task_update', { priority: 'critical', due: '2026-09-01' })).toBe('escalates');
    expect(payloadShape('task_update', { due: '2026-09-01' })).toBe('dates');
    expect(payloadShape('task_update', { owner: 'Rowan' })).toBe('owner');
    expect(payloadShape('task_update', { description: 'x' })).toBe('text');
    expect(payloadShape('blocker_create', { due: 'x' })).toBe('');
  });
  it('due-moves and enrichments learn as separate classes', () => {
    expect(proposalClass({ type: 'task_update', reasoning: 'model matched existing task', payload: { due: '2026-09-05' } }))
      .toBe('task_update|matched_id|dates');
    expect(proposalClass({ type: 'task_update', reasoning: 'model matched existing task', payload: { description: 'x' } }))
      .toBe('task_update|matched_id|text');
  });
});

describe('learned class thresholds', () => {
  const history = (state: string, n: number): HistoryRow[] =>
    Array.from({ length: n }, () => ({
      type: 'blocker_create', reasoning: 'new blocker asserted by communication', state, decided_by: 'noa@x.com',
    }));

  it('≥85% human acceptance over ≥5 decisions auto-applies a default-review class', () => {
    const stats = computeClassStats([...history('accepted', 6), ...history('rejected', 1)]);
    const b: P = { type: 'blocker_create', reasoning: 'new blocker asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: {} };
    expect(classifyProposal(b, null, stats).action).toBe('auto_apply');
  });
  it('accepted due-moves teach due-moves — and only due-moves', () => {
    const dueMoves: HistoryRow[] = Array.from({ length: 6 }, () => ({
      type: 'task_update', reasoning: 'model matched existing task', state: 'accepted',
      decided_by: 'noa@x.com', payload: { due: '2026-09-05' },
    }));
    const stats = computeClassStats(dueMoves);
    // a due-move now auto-applies (learned)…
    expect(classifyProposal(matchedUpdate({ due: '2026-09-09' }), openTask({ due: '2026-09-01' }), stats).action)
      .toBe('auto_apply');
    // …but a completion learned nothing from it
    expect(classifyProposal({ ...matchedUpdate({ status: 'done' }), type: 'task_done' }, openTask(), stats).action)
      .toBe('review');
  });
  it('≥85% rejection auto-ignores, and agent decisions never teach', () => {
    const agentRows: HistoryRow[] = Array.from({ length: 20 }, () => ({
      type: 'blocker_create', reasoning: 'new blocker asserted by communication', state: 'accepted', decided_by: 'agent:auto-triage',
    }));
    const stats = computeClassStats([...history('rejected', 6), ...agentRows]);
    const b: P = { type: 'blocker_create', reasoning: 'new blocker asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: {} };
    expect(classifyProposal(b, null, stats).action).toBe('auto_ignore');
  });
  it('learned rejection beats the enrichment default — those stop auto-applying', () => {
    const rejected: HistoryRow[] = Array.from({ length: 6 }, () => ({
      type: 'task_update', reasoning: 'model matched existing task', state: 'rejected',
      decided_by: 'noa@x.com', payload: { description: 'x' },
    }));
    const stats = computeClassStats(rejected);
    expect(classifyProposal(matchedUpdate({ description: 'y' }), openTask(), stats).action).toBe('auto_ignore');
  });
  it('under 5 decisions nothing is learned yet', () => {
    const stats = computeClassStats(history('accepted', 4));
    const b: P = { type: 'blocker_create', reasoning: 'new blocker asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: {} };
    expect(classifyProposal(b, null, stats).action).toBe('review');
  });
});

describe('attribution rules', () => {
  it('tokens are the distinctive identity, capped', () => {
    const tokens = attributionTokens('Gibbs Giden invoices for the Blair matter');
    expect(tokens.length).toBeLessThanOrEqual(6);
    expect(tokens).toContain('gibbs');
  });
  it('matches when the rule tokens are covered, not on one shared word', () => {
    const rules = [
      { id: 'r1', tokens: ['gibbs', 'giden'], project_id: 'blair' },
      { id: 'r2', tokens: ['avalon'], project_id: 'rinconia' },
    ];
    expect(matchAttribution('New Gibbs Giden invoice received', rules)?.project_id).toBe('blair');
    // single-token rules never fire
    expect(matchAttribution('Avalon estimate', rules)).toBeNull();
    expect(matchAttribution('Unrelated soil report', rules)).toBeNull();
  });
});

describe('runAutoTriage — in-batch duplicate collapse', () => {
  function fakeAdmin(calls: Array<{ table: string; op: string; payload?: unknown }>): SupabaseClient {
    const make = (table: string) => {
      const chain = {
        insert: (payload: unknown) => { calls.push({ table, op: 'insert', payload }); return chain; },
        update: (payload: unknown) => { calls.push({ table, op: 'update', payload }); return chain; },
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        not: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => ({ data: { id: 'row-1' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    };
    return { from: make } as unknown as SupabaseClient;
  }

  const proposal = (over: Partial<AgentProposal> & { id: string }): AgentProposal => ({
    document_id: null, project_id: 'p-blair', type: 'decision_create',
    payload: { title: 'Adopt not-to-exceed clauses' }, target_task_id: null, confidence: 0.7,
    reasoning: 'decision asserted by communication', evidence_excerpt: 'quote',
    state: 'pending', decided_by: null, decided_at: null, created_at: '2026-08-28',
    title: 'Adopt not-to-exceed clauses', change_type: null, result_note: null, match_score: null, match_reason: null,
    ...over,
  } as AgentProposal);

  it('two pending rows asserting the same identity: the older applies, the newer folds as duplicate', async () => {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const out = await runAutoTriage(fakeAdmin(calls), [
      proposal({ id: 'older' }),
      proposal({ id: 'newer' }),
    ], { today: '2026-08-29' });
    expect(out.applied).toBe(1);   // attributed decision — structural default
    expect(out.ignored).toBe(1);   // same proposalKey — provable duplicate
    expect(out.kept).toBe(0);
  });
});
