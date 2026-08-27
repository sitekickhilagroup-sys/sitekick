import { describe, expect, it } from 'vitest';
import { pickDefaultMaster, planMerge } from './merge';
import type { Task } from './types';

const AT = { actor: 'reviewer@example.com', now: '2026-08-24T10:00:00Z' };

function task(over: Partial<Task> & { id: string }): Task {
  return {
    project_id: null,
    document_id: null,
    title: 'Retain Certified Arborist',
    description: null,
    owner: null,
    waiting_for: null,
    due: null,
    stage_key: null,
    priority: 'normal',
    status: 'open',
    planned: true,
    follow_up_date: null,
    check_back_on: null,
    source: null,
    admin: false,
    last_touched: '2026-08-01',
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  } as Task;
}

describe('planMerge — the losing row', () => {
  it('is marked merged and pointed at the master, never deleted', () => {
    const { loser } = planMerge(task({ id: 'master' }), task({ id: 'dupe' }), AT);
    expect(loser).toEqual({
      status: 'merged',
      merged_into: 'master',
      merged_at: AT.now,
      merged_by: AT.actor,
    });
  });
});

describe('planMerge — transferring to the master', () => {
  it('fills the project from the duplicate when the master has none', () => {
    // The General twin case: the master is the unassigned row, the duplicate
    // carries the real project. Merging must not leave the work in limbo.
    const patch = planMerge(
      task({ id: 'master', project_id: null }),
      task({ id: 'dupe', project_id: 'san-marco' }),
      AT,
    ).master;
    expect(patch.project_id).toBe('san-marco');
  });

  it('never overwrites a project the master already has', () => {
    const patch = planMerge(
      task({ id: 'master', project_id: 'san-marco' }),
      task({ id: 'dupe', project_id: 'rinconia' }),
      AT,
    ).master;
    expect(patch.project_id).toBeUndefined();
  });

  it('carries evidence, sub-stage, owner and waiting-on into the gaps', () => {
    const patch = planMerge(
      task({ id: 'master' }),
      task({
        id: 'dupe', document_id: 'doc-1', stage_key: 'plan_check',
        owner: 'Abhi', waiting_for: 'City of LA', source: 'tracker.xlsx',
      }),
      AT,
    ).master;
    expect(patch).toMatchObject({
      document_id: 'doc-1', stage_key: 'plan_check',
      owner: 'Abhi', waiting_for: 'City of LA', source: 'tracker.xlsx',
    });
  });

  it('keeps the earlier due date from either record', () => {
    expect(planMerge(
      task({ id: 'master', due: '2026-09-30' }),
      task({ id: 'dupe', due: '2026-08-25' }),
      AT,
    ).master.due).toBe('2026-08-25');

    // Already the earlier one, so nothing to write.
    expect(planMerge(
      task({ id: 'master', due: '2026-08-25' }),
      task({ id: 'dupe', due: '2026-09-30' }),
      AT,
    ).master.due).toBeUndefined();
  });

  it('takes the more urgent priority, and never de-escalates', () => {
    expect(planMerge(
      task({ id: 'master', priority: 'normal' }),
      task({ id: 'dupe', priority: 'critical' }),
      AT,
    ).master.priority).toBe('critical');

    expect(planMerge(
      task({ id: 'master', priority: 'critical' }),
      task({ id: 'dupe', priority: 'normal' }),
      AT,
    ).master.priority).toBeUndefined();
  });

  it('appends both notes rather than overwriting either', () => {
    const patch = planMerge(
      task({ id: 'master', description: 'Waiting on the arborist quote.' }),
      task({ id: 'dupe', description: 'Two documents still to sign.' }),
      AT,
    ).master;
    expect(patch.description).toBe('Waiting on the arborist quote.\n\nTwo documents still to sign.');
  });

  it('does not duplicate an identical note', () => {
    const patch = planMerge(
      task({ id: 'master', description: 'Same note' }),
      task({ id: 'dupe', description: 'Same note' }),
      AT,
    ).master;
    expect(patch.description).toBeUndefined();
  });

  it('writes nothing to a master that already holds everything', () => {
    const full = {
      project_id: 'p1', document_id: 'd1', stage_key: 's1', owner: 'Abhi',
      waiting_for: 'City', due: '2026-08-01', source: 'email', description: 'note',
    };
    const patch = planMerge(
      task({ id: 'master', ...full }),
      task({ id: 'dupe' }),
      AT,
    ).master;
    expect(patch).toEqual({});
  });
});

describe('pickDefaultMaster — the review list\'s starting selection', () => {
  it('defaults to the side that carries a real project', () => {
    const general = task({ id: 'general', project_id: null, last_touched: '2026-08-01' });
    const scoped = task({ id: 'scoped', project_id: 'san-marco', last_touched: '2026-08-01' });
    expect(pickDefaultMaster(general, scoped)).toBe('scoped');
    // Order-independent — the same pair either way round.
    expect(pickDefaultMaster(scoped, general)).toBe('scoped');
  });

  it('falls back to the more recently touched row when both carry a project', () => {
    const older = task({ id: 'older', project_id: 'san-marco', last_touched: '2026-08-01' });
    const newer = task({ id: 'newer', project_id: 'san-marco', last_touched: '2026-08-20' });
    expect(pickDefaultMaster(older, newer)).toBe('newer');
    expect(pickDefaultMaster(newer, older)).toBe('newer');
  });

  it('falls back to the more recently touched row when neither carries a project', () => {
    const older = task({ id: 'older', project_id: null, last_touched: '2026-08-01' });
    const newer = task({ id: 'newer', project_id: null, last_touched: '2026-08-20' });
    expect(pickDefaultMaster(older, newer)).toBe('newer');
  });

  it('breaks an exact tie by keeping the first argument', () => {
    const a = task({ id: 'a', project_id: null, last_touched: '2026-08-01' });
    const b = task({ id: 'b', project_id: null, last_touched: '2026-08-01' });
    expect(pickDefaultMaster(a, b)).toBe('a');
  });
});
