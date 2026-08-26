import { describe, expect, it } from 'vitest';
import {
  buildReviewItems, buildStageLabelMap, isProjectEligibleForReview, isReviewEditable, isTaskEligibleForOpenReview,
  nextMonday,
} from './weekly.ts';
import type { Task, WeeklyReviewItem } from './types.ts';

// D1 review-code review: this is the single source of truth every finalize
// lock check in app/actions/weekly.ts now routes through, so it carries the
// coverage that actually protects the lock (the project's convention is
// pure logic tested in lib/, Server Actions left untested — see the other
// describe blocks in this file for the established pattern).
describe('isReviewEditable', () => {
  it('preparing and saved are editable', () => {
    expect(isReviewEditable('preparing')).toBe(true);
    expect(isReviewEditable('saved')).toBe(true);
  });

  it('final is not editable', () => {
    expect(isReviewEditable('final')).toBe(false);
  });

  it('an unrecognized status fails closed (not editable), not open', () => {
    expect(isReviewEditable('archived')).toBe(false);
    expect(isReviewEditable('')).toBe(false);
    expect(isReviewEditable('Final')).toBe(false); // case-sensitive, not a loose match
  });
});

describe('nextMonday', () => {
  it('thursday → next monday', () => expect(nextMonday('2026-08-20')).toBe('2026-08-24'));
  it('monday stays', () => expect(nextMonday('2026-08-24')).toBe('2026-08-24'));
  it('sunday → next day', () => expect(nextMonday('2026-08-23')).toBe('2026-08-24'));
});

const mk = (id: string, status: string, stage: string | null = null) =>
  ({ id, project_id: 'p1', title: id, status, stage_key: stage, created_at: '2026-08-01' }) as unknown as Task;

describe('buildReviewItems', () => {
  const prior: WeeklyReviewItem[] = [{
    id: 'i1', weekly_review_id: 'r1', task_id: 't1', project_id: 'p1',
    subtopic: 'Planning', status_snapshot: 'open', weekly_note: 'chase CE', next_step: 'confirm signature',
    sequence: 1, carried_from: null,
  }];
  // A task completed since the last review belongs in *this* review, shown as
  // completed — and it keeps last week's note. The note used to be discarded
  // on every carry, which lost the history the meeting depends on.
  it('carries a task completed this week, keeping the previous note', () => {
    const out = buildReviewItems({ openTasks: [], doneSinceTasks: [mk('t1', 'done')], priorItems: prior, stageLabels: new Map() });
    expect(out[0]).toMatchObject({
      task_id: 't1', carried_from: 'i1', weekly_note: 'chase CE',
      status_snapshot: 'done', subtopic: 'Planning',
    });
  });

  // D2: next_step gets the exact same carry-forward treatment as
  // weekly_note, for the same reason — last week's planned next step is the
  // context this week's meeting runs on, not something a carry should drop.
  it('carries next_step forward the same way it carries weekly_note', () => {
    const out = buildReviewItems({ openTasks: [mk('t1', 'open')], doneSinceTasks: [], priorItems: prior, stageLabels: new Map() });
    expect(out[0]).toMatchObject({ task_id: 't1', next_step: 'confirm signature' });
  });

  // Spec §6: completed work stays in the review where it was completed. Prior
  // items used to be copied regardless of status, so a finished task followed
  // the team forward every week indefinitely.
  it('does not carry a task that was already completed in an earlier review', () => {
    const done: WeeklyReviewItem[] = [{
      ...prior[0], id: 'i9', task_id: 't9', status_snapshot: 'done', weekly_note: 'signed',
    }];
    const out = buildReviewItems({ openTasks: [], doneSinceTasks: [], priorItems: done, stageLabels: new Map() });
    expect(out).toEqual([]);
  });

  // D6 (review follow-up): 'dropped' hits the exact same carry condition as
  // 'done' above today (`status !== 'open' && !closedThisWeek`) — but a
  // test's job is to survive the refactor that stops making that true. A
  // future edit that special-cases terminal statuses explicitly (say
  // `if (status === 'done' || status === 'no_update') continue`) and forgets
  // 'dropped' would make dropped items silently resume carrying forever,
  // with nothing in the suite to catch it. Asserted directly instead of
  // just documented.
  it('a dropped item does not carry forward', () => {
    const out = buildReviewItems({
      openTasks: [], doneSinceTasks: [],
      priorItems: [{ ...prior[0], status_snapshot: 'dropped' }], stageLabels: new Map(),
    });
    expect(out).toEqual([]);
  });

  // D6: "open / waiting / blocked / carried DO carry" is about the ITEM
  // surviving into next week, not its snapshot label surviving verbatim.
  // status_snapshot is only a fallback for when the task itself is not found
  // in openTasks/doneSinceTasks (see `task?.status ?? prior.status_snapshot`
  // above) — a still-open task always carries, and always comes back reset
  // to 'open' for fresh assessment, regardless of what last week's meeting
  // called it. Locking this protects the precedence itself: if task.status
  // ever stopped winning over prior.status_snapshot, a 'waiting' or
  // 'blocked' item would silently stop carrying (they are not the literal
  // string 'open', and closedThisWeek does not apply to them either).
  it('waiting, blocked, carried and no_update items carry forward when their task is still open — reset to open, note intact', () => {
    for (const snapshot of ['waiting', 'blocked', 'carried', 'no_update']) {
      const out = buildReviewItems({
        openTasks: [mk('t1', 'open')], doneSinceTasks: [],
        priorItems: [{ ...prior[0], status_snapshot: snapshot }], stageLabels: new Map(),
      });
      expect(out).toMatchObject([{ task_id: 't1', status_snapshot: 'open', weekly_note: 'chase CE', carried_from: 'i1' }]);
    }
  });

  // The other half of §6: the new-item loop iterated openTasks only, so a task
  // completed this week that was never on last week's review simply vanished.
  it('includes work completed this week even when it was not on the prior review', () => {
    const out = buildReviewItems({
      openTasks: [], doneSinceTasks: [mk('t5', 'done')], priorItems: [],
      stageLabels: new Map(),
    });
    expect(out.map((i) => i.task_id)).toEqual(['t5']);
    expect(out[0]).toMatchObject({ status_snapshot: 'done', carried_from: null });
  });
  it('appends new open tasks after carried ones', () => {
    const out = buildReviewItems({ openTasks: [mk('t2', 'open', 'sk')], doneSinceTasks: [], priorItems: prior, stageLabels: new Map([['sk', 'Plan Check']]) });
    expect(out.map((i) => i.task_id)).toEqual(['t1', 't2']);
    // A brand-new item (no prior row) gets a null next_step, never the
    // sibling carried item's — buildReviewItems must not cross-contaminate.
    expect(out[1]).toMatchObject({ subtopic: 'Plan Check', carried_from: null, sequence: 2, next_step: null });
  });

  // A7: syncTaskIntoOpenReview (app/actions/weekly.ts) calls buildReviewItems
  // with exactly one open task and no doneSince/prior items, to reuse the
  // identical "brand-new item" branch prepare itself takes for that task —
  // that's what makes a synced item indistinguishable from a prepared one.
  // This locks down the shape that call depends on.
  it('shapes a lone new open task the same way syncTaskIntoOpenReview relies on', () => {
    const out = buildReviewItems({
      openTasks: [mk('t7', 'open', 'sk')], doneSinceTasks: [], priorItems: [],
      stageLabels: new Map([['sk', 'Plan Check']]),
    });
    expect(out).toEqual([{
      task_id: 't7', project_id: 'p1', subtopic: 'Plan Check', status_snapshot: 'open',
      weekly_note: null, next_step: null, sequence: 1, carried_from: null,
    }]);
  });

  it('a lone new open task with no matching stage label gets a null subtopic, not undefined', () => {
    const out = buildReviewItems({
      openTasks: [mk('t8', 'open', 'no_such_stage')], doneSinceTasks: [], priorItems: [],
      stageLabels: new Map(),
    });
    expect(out[0]).toMatchObject({ subtopic: null });
  });
});

describe('buildStageLabelMap', () => {
  it('builds one entry per distinct stage_key', () => {
    const map = buildStageLabelMap([{ stage_key: 'a', label: 'A' }, { stage_key: 'b', label: 'B' }]);
    expect([...map.entries()]).toEqual([['a', 'A'], ['b', 'B']]);
  });

  it('first occurrence of a duplicated stage_key wins', () => {
    const map = buildStageLabelMap([{ stage_key: 'sk', label: 'First' }, { stage_key: 'sk', label: 'Second' }]);
    expect(map.get('sk')).toBe('First');
  });

  it('an empty input produces an empty map', () => {
    expect(buildStageLabelMap([]).size).toBe(0);
  });
});

// A7 code review: syncTaskIntoOpenReview shipped without this gate, so a
// task under an inactive project (e.g. Flicker, 0007) could resurrect onto
// a live review — exactly the bug prepareCurrentReview's onActiveProject
// was written to fix. isProjectEligibleForReview is now the one definition
// both call sites share.
describe('isProjectEligibleForReview', () => {
  it('a task with no project is always eligible, whatever "active" is passed', () => {
    expect(isProjectEligibleForReview(null, false)).toBe(true);
    expect(isProjectEligibleForReview(null, true)).toBe(true);
    expect(isProjectEligibleForReview(null, null)).toBe(true);
  });

  it('a task under an active project is eligible', () => {
    expect(isProjectEligibleForReview('p1', true)).toBe(true);
  });

  it('a task under a project explicitly marked inactive is not eligible', () => {
    expect(isProjectEligibleForReview('p1', false)).toBe(false);
  });

  it('a task under a project whose active-ness is unknown (null) defaults to eligible', () => {
    expect(isProjectEligibleForReview('p1', null)).toBe(true);
  });
});

describe('isTaskEligibleForOpenReview', () => {
  const base = { status: 'open' as const, projectId: 'p1', projectActive: true, alreadyOnReview: false };

  it('an open task on an active project is eligible', () => {
    expect(isTaskEligibleForOpenReview(base)).toBe(true);
  });

  it('a non-open task is never eligible, regardless of its project', () => {
    expect(isTaskEligibleForOpenReview({ ...base, status: 'done' })).toBe(false);
    expect(isTaskEligibleForOpenReview({ ...base, status: 'dropped' })).toBe(false);
    expect(isTaskEligibleForOpenReview({ ...base, status: 'merged' })).toBe(false);
  });

  it('an open task under an inactive project is not eligible', () => {
    expect(isTaskEligibleForOpenReview({ ...base, projectActive: false })).toBe(false);
  });

  it('an open task already on the review is not eligible again', () => {
    expect(isTaskEligibleForOpenReview({ ...base, alreadyOnReview: true })).toBe(false);
  });

  it('an open task with no project at all (General) is eligible even when projectActive reads false or null', () => {
    expect(isTaskEligibleForOpenReview({ ...base, projectId: null, projectActive: false })).toBe(true);
    expect(isTaskEligibleForOpenReview({ ...base, projectId: null, projectActive: null })).toBe(true);
  });
});
