import { describe, expect, it } from 'vitest';
import {
  attributionTokens, classifyProposal, computeClassStats, isSafeEnrichment,
  matchAttribution, proposalClass, type ClassStats, type HistoryRow,
} from './auto-triage';
import type { AgentProposal, Task } from './types';

type P = Pick<AgentProposal, 'type' | 'reasoning' | 'confidence' | 'project_id' | 'target_task_id' | 'payload'>;
type T = Pick<Task, 'due' | 'owner' | 'priority' | 'status'>;

const matchedUpdate = (payload: Record<string, unknown> = {}): P => ({
  type: 'task_update',
  reasoning: 'model matched existing task',
  confidence: 0.8,
  project_id: 'blair',
  target_task_id: 't1',
  payload,
});

const openTask = (over: Partial<T> = {}): T => ({
  due: null, owner: null, priority: 'normal', status: 'open', ...over,
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

describe('classifyProposal defaults', () => {
  it('auto-applies an id-matched enrichment on an open task', () => {
    const v = classifyProposal(matchedUpdate({ description: 'new info' }), openTask(), noStats);
    expect(v.action).toBe('auto_apply');
  });
  it('keeps a conflicting delta for review even at high confidence', () => {
    const v = classifyProposal(matchedUpdate({ due: '2026-09-05' }), openTask({ due: '2026-09-01' }), noStats);
    expect(v.action).toBe('review');
  });
  it('keeps task_done for review — closing needs a human', () => {
    const v = classifyProposal({ ...matchedUpdate({ status: 'done' }), type: 'task_done' }, openTask(), noStats);
    expect(v.action).toBe('review');
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
  it('≥85% rejection auto-ignores, and agent decisions never teach', () => {
    const agentRows: HistoryRow[] = Array.from({ length: 20 }, () => ({
      type: 'blocker_create', reasoning: 'new blocker asserted by communication', state: 'accepted', decided_by: 'agent:auto-triage',
    }));
    const stats = computeClassStats([...history('rejected', 6), ...agentRows]);
    const b: P = { type: 'blocker_create', reasoning: 'new blocker asserted by communication', confidence: 0.7, project_id: 'blair', target_task_id: null, payload: {} };
    expect(classifyProposal(b, null, stats).action).toBe('auto_ignore');
  });
  it('learned rejection beats the enrichment default — reviews stop auto-applying', () => {
    const rejected: HistoryRow[] = Array.from({ length: 6 }, () => ({
      type: 'task_update', reasoning: 'model matched existing task', state: 'rejected', decided_by: 'noa@x.com',
    }));
    const stats = computeClassStats(rejected);
    expect(classifyProposal(matchedUpdate({ description: 'x' }), openTask(), stats).action).toBe('auto_ignore');
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

describe('proposalClass', () => {
  it('folds free-text evidence reasons into a stable family', () => {
    expect(proposalClass({ type: 'deadline_update', reasoning: 'The fee must be paid within 5 days' }))
      .toBe('deadline_update|other');
    expect(proposalClass({ type: 'task_update', reasoning: 'model matched existing task' }))
      .toBe('task_update|matched_id');
  });
});
