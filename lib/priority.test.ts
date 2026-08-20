import { describe, expect, it } from 'vitest';
import { followUpAlerts, scoreBlocker, scoreTask, topActions } from './priority';
import type { Blocker, ProjectStage, Task } from './types';

const TODAY = '2026-08-20';

function task(over: Partial<Task>): Task {
  return {
    id: 't1', project_id: 'p1', document_id: null, title: 'Test task',
    description: null, owner: null, waiting_for: null, due: null,
    stage_key: null, priority: 'normal', status: 'open', planned: true,
    follow_up_date: null, check_back_on: null, source: null,
    last_touched: TODAY, created_at: '', ...over,
  } as Task;
}

function blocker(over: Partial<Blocker>): Blocker {
  return {
    id: 'b1', project_id: 'p1', document_id: null, what: 'Stuck thing',
    blocked_by: 'Someone', days_at_risk: 0, days_stuck: 0, downstream: [],
    suggested_action: null, status: 'active', created_at: '', ...over,
  } as Blocker;
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
});
