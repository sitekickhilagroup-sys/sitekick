import { describe, expect, it } from 'vitest';
import { buildReviewItems, nextMonday } from './weekly.ts';
import type { Task, WeeklyReviewItem } from './types.ts';

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
    subtopic: 'Planning', status_snapshot: 'open', weekly_note: 'chase CE', sequence: 1, carried_from: null,
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
    expect(out[1]).toMatchObject({ subtopic: 'Plan Check', carried_from: null, sequence: 2 });
  });
});
