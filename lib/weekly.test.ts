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
  it('carries prior items forward with fresh note and current status', () => {
    const out = buildReviewItems({ openTasks: [], doneSinceTasks: [mk('t1', 'done')], priorItems: prior, stageLabels: new Map() });
    expect(out[0]).toMatchObject({ task_id: 't1', carried_from: 'i1', weekly_note: null, status_snapshot: 'done', subtopic: 'Planning' });
  });
  it('appends new open tasks after carried ones', () => {
    const out = buildReviewItems({ openTasks: [mk('t2', 'open', 'sk')], doneSinceTasks: [], priorItems: prior, stageLabels: new Map([['sk', 'Plan Check']]) });
    expect(out.map((i) => i.task_id)).toEqual(['t1', 't2']);
    expect(out[1]).toMatchObject({ subtopic: 'Plan Check', carried_from: null, sequence: 2 });
  });
});
