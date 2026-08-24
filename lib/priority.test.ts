import { describe, expect, it } from 'vitest';
import { followUpAlerts, scoreBlocker, scoreTask, topActions } from './priority';
import type { Blocker, ProjectStage, Relationship, Task } from './types';

const TODAY = '2026-08-20';

function task(over: Partial<Task>): Task {
  return {
    id: 't1', project_id: 'p1', document_id: null, title: 'Test task',
    description: null, owner: null, waiting_for: null, due: null,
    stage_key: null, priority: 'normal', status: 'open', planned: true,
    follow_up_date: null, check_back_on: null, source: null,
    last_touched: TODAY, created_at: '', manual_priority: null, snoozed_until: null,
    ...over,
  } as Task;
}

function blocker(over: Partial<Blocker>): Blocker {
  return {
    id: 'b1', project_id: 'p1', document_id: null, what: 'Stuck thing',
    blocked_by: 'Someone', days_at_risk: 0, days_stuck: 0, downstream: [],
    // Ranking weight now depends on classification, so the fixture has to
    // state one. 'primary' keeps these cases at the old full weight.
    suggested_action: null, status: 'active', kind: 'primary', created_at: '', ...over,
  } as Blocker;
}

function relationship(over: Partial<Relationship>): Relationship {
  return {
    id: 'r1', project_id: 'p1', from_task_id: 't1', to_task_id: 't2',
    type: 'blocks', reason: null, confidence: 1, evidence_document_id: null,
    verified_by: null, verified_at: null, manual_override: false, created_at: '',
    ...over,
  } as Relationship;
}

describe('scoreTask', () => {
  const ctx = { today: TODAY };
  it('scores critical +40, high +20', () => {
    expect(scoreTask(task({ priority: 'critical' }), ctx)).toBe(40);
    expect(scoreTask(task({ priority: 'high' }), ctx)).toBe(20);
    expect(scoreTask(task({}), ctx)).toBe(0);
  });
  it('scores overdue +35, near due +25, week +12', () => {
    expect(scoreTask(task({ due: '2026-08-19' }), ctx)).toBe(35);
    expect(scoreTask(task({ due: '2026-08-21' }), ctx)).toBe(25);
    expect(scoreTask(task({ due: '2026-08-26' }), ctx)).toBe(12);
    expect(scoreTask(task({ due: '2026-09-20' }), ctx)).toBe(0);
  });
  it('scores follow-up due today inclusive +18', () => {
    expect(scoreTask(task({ follow_up_date: TODAY }), ctx)).toBe(18);
    expect(scoreTask(task({ check_back_on: '2026-08-10' }), ctx)).toBe(18);
    expect(scoreTask(task({ follow_up_date: '2026-08-25' }), ctx)).toBe(0);
  });
  it('scores current-stage alignment +25', () => {
    expect(scoreTask(task({ stage_key: 'entitlements' }), { today: TODAY, currentStageKey: 'entitlements' })).toBe(25);
    expect(scoreTask(task({ stage_key: 'permits' }), { today: TODAY, currentStageKey: 'entitlements' })).toBe(0);
  });
  it('scores waiting_for +6 and stale >14d +8', () => {
    expect(scoreTask(task({ waiting_for: 'Rowan' }), ctx)).toBe(6);
    expect(scoreTask(task({ last_touched: '2026-08-01' }), ctx)).toBe(8);
    expect(scoreTask(task({ last_touched: '2026-08-10' }), ctx)).toBe(0);
  });
  it('manual_priority pins above everything', () => {
    const pinned = task({ manual_priority: 5 });
    expect(scoreTask(pinned, { today: TODAY })).toBe(1005);
  });
});

describe('scoreBlocker weights by classification', () => {
  // An external wait or an unverified claim must not outrank real blocked work
  // — the audit's "an urgent task that does not stop a stage is not a Main
  // Blocker" applies to Today's ranking too.
  it('ranks a primary blocker above every other kind', () => {
    const stuck = { days_stuck: 10 };
    const primary = scoreBlocker(blocker({ ...stuck, kind: 'primary' }));
    expect(primary).toBeGreaterThan(scoreBlocker(blocker({ ...stuck, kind: 'workstream' })));
    expect(primary).toBeGreaterThan(scoreBlocker(blocker({ ...stuck, kind: 'external_gate' })));
    expect(primary).toBeGreaterThan(scoreBlocker(blocker({ ...stuck, kind: 'verify' })));
    expect(primary).toBeGreaterThan(scoreBlocker(blocker({ ...stuck, kind: 'future_gate' })));
  });

  it('scores information_only at zero so it never ranks at all', () => {
    expect(scoreBlocker(blocker({ days_stuck: 30, kind: 'information_only' }))).toBe(0);
  });
});

describe('scoreBlocker', () => {
  it('bases 50 + stuck days capped 30 + downstream bonus', () => {
    expect(scoreBlocker(blocker({}))).toBe(50);
    expect(scoreBlocker(blocker({ days_stuck: 9 }))).toBe(59);
    expect(scoreBlocker(blocker({ days_stuck: 99 }))).toBe(80);
    expect(scoreBlocker(blocker({ days_stuck: 5, downstream: ['a', 'b'] }))).toBe(70);
  });
});

describe('followUpAlerts', () => {
  it('returns open tasks with follow-up due, today inclusive', () => {
    const due = task({ id: 'a', follow_up_date: TODAY });
    const future = task({ id: 'b', follow_up_date: '2026-09-01' });
    const closed = task({ id: 'c', follow_up_date: TODAY, status: 'done' });
    const cb = task({ id: 'd', check_back_on: '2026-08-15' });
    expect(followUpAlerts([due, future, closed, cb], TODAY).map((t) => t.id)).toEqual(['a', 'd']);
  });
});

describe('topActions', () => {
  it('ranks blockers and tasks together, sorted desc, limited', () => {
    const tasks = [
      task({ id: 't-crit', priority: 'critical', due: '2026-08-19' }), // 75
      task({ id: 't-low' }), // 0
    ];
    const blockers = [blocker({ id: 'b-big', days_stuck: 20, downstream: ['x', 'y'] })]; // 85
    const stages = new Map<string, ProjectStage[]>();
    const names = new Map([['p1', 'Blair']]);
    const actions = topActions(tasks, blockers, stages, names, { today: TODAY, limit: 2 });
    expect(actions.map((a) => a.id)).toEqual(['b-big', 't-crit']);
    expect(actions[0].project).toBe('Blair');
  });
  it('snoozed tasks are excluded from topActions', () => {
    const snoozed = task({ snoozed_until: '2099-01-01' });
    const actions = topActions([snoozed], [], new Map(), new Map(), { today: TODAY, limit: 8 });
    expect(actions.find((a) => a.id === snoozed.id)).toBeUndefined();
  });
});

describe('topActions — relationship unlocks bonus', () => {
  it('a verified blocks relationship raises the blocking task score by 18 and sets why.unlocks', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    const rel = relationship({ from_task_id: 't1', to_task_id: 't2', verified_by: 'dor@sitekick.app' });
    const actions = topActions([t1, t2], [], new Map(), new Map(), { today: TODAY, limit: 8 }, [rel]);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(18);
    expect(a1.why.unlocks).toBe(1);
  });

  it('an unverified relationship (no verified_by, no manual_override) changes nothing', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    const rel = relationship({ from_task_id: 't1', to_task_id: 't2' });
    const actions = topActions([t1, t2], [], new Map(), new Map(), { today: TODAY, limit: 8 }, [rel]);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(0);
    expect(a1.why.unlocks).toBeUndefined();
  });

  it('manual_override alone (no verified_by) also counts', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    const rel = relationship({ from_task_id: 't1', to_task_id: 't2', manual_override: true });
    const actions = topActions([t1, t2], [], new Map(), new Map(), { today: TODAY, limit: 8 }, [rel]);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(18);
    expect(a1.why.unlocks).toBe(1);
  });

  it('counts multiple verified blocks relationships from the same task', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    const t3 = task({ id: 't3' });
    const rels = [
      relationship({ id: 'r1', from_task_id: 't1', to_task_id: 't2', verified_by: 'dor@sitekick.app' }),
      relationship({ id: 'r2', from_task_id: 't1', to_task_id: 't3', verified_by: 'dor@sitekick.app' }),
    ];
    const actions = topActions([t1, t2, t3], [], new Map(), new Map(), { today: TODAY, limit: 8 }, rels);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(36);
    expect(a1.why.unlocks).toBe(2);
  });

  it('ignores relationships of a different type or pointing away from this task', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    const rels = [
      relationship({ from_task_id: 't1', to_task_id: 't2', type: 'supports', verified_by: 'dor@sitekick.app' }),
      relationship({ from_task_id: 't2', to_task_id: 't1', type: 'blocks', verified_by: 'dor@sitekick.app' }),
    ];
    const actions = topActions([t1, t2], [], new Map(), new Map(), { today: TODAY, limit: 8 }, rels);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(0);
    expect(a1.why.unlocks).toBeUndefined();
  });

  it('a stale edge to a closed (non-open) task does not bump the score', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2', status: 'done' });
    const rel = relationship({ from_task_id: 't1', to_task_id: 't2', verified_by: 'dor@sitekick.app' });
    const actions = topActions([t1, t2], [], new Map(), new Map(), { today: TODAY, limit: 8 }, [rel]);
    const a1 = actions.find((a) => a.id === 't1')!;
    expect(a1.score).toBe(0);
    expect(a1.why.unlocks).toBeUndefined();
  });
});
