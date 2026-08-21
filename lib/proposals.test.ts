import { describe, expect, it } from 'vitest';
import { routeExtractResult } from './proposals.ts';
import type { Task } from './types.ts';

const openTask = {
  id: 't1', project_id: 'p1', title: 'Retain civil engineer', status: 'open',
} as unknown as Task;

const base = { project_name: 'San Marco', tasks: [], blockers: [], decisions: [], drafts: [], vendor_hours: [], deadline_updates: [], relationships: [] };

describe('routeExtractResult', () => {
  it('new unmatched create goes to autoCreates', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', title: 'Order tree report', priority: 'normal' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(1);
    expect(r.proposals).toHaveLength(0);
  });
  it('update with existing_id becomes task_update proposal at 0.8', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', title: 'Retain civil engineer', priority: 'normal', owner: 'Noa' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.8 });
  });
  it('status done becomes task_done proposal', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', title: 'Retain civil engineer', priority: 'normal', status: 'done' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals[0].type).toBe('task_done');
  });
  it('create that fuzzy-matches an open task becomes a 0.6 proposal, not a duplicate', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', title: 'retain the civil engineer', priority: 'normal' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('blockers, decisions and deadline updates always become proposals', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ what: 'CE not retained', blocked_by: 'Noa decision' }],
        decisions: [{ title: 'Go with waiver' }],
        deadline_updates: [{ task_match: 'Retain civil engineer', new_due: '2026-09-01', evidence: 'email says so' }],
      },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals.map((p) => p.type).sort()).toEqual(['blocker_create', 'deadline_update', 'decision_create'].sort());
  });
  it('relationships always become relationship_create proposals at 0.5 confidence', () => {
    const rel = { from_match: 'Retain civil engineer', to_match: 'Grading plan', type: 'blocks' as const, reason: 'CE must be retained before grading scope' };
    const r = routeExtractResult(
      { ...base, relationships: [rel] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ type: 'relationship_create', payload: rel, confidence: 0.5, reasoning: rel.reason });
  });
});
