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
  it('blockers, decisions and deadline updates become proposals carrying their evidence quote', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ what: 'CE not retained', blocked_by: 'Noa decision', evidence: 'we cannot proceed until the CE is retained' }],
        decisions: [{ title: 'Go with waiver' }],
        deadline_updates: [{ task_match: 'Retain civil engineer', new_due: '2026-09-01', evidence: 'email says so' }],
      },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals.map((p) => p.type).sort()).toEqual(['blocker_create', 'deadline_update', 'decision_create'].sort());
    // Agent bug #3: the quote must reach evidence_excerpt, not be dropped.
    expect(r.proposals.find((p) => p.type === 'blocker_create')?.evidence).toBe('we cannot proceed until the CE is retained');
    expect(r.proposals.find((p) => p.type === 'deadline_update')?.evidence).toBe('email says so');
  });
  it('relationships become relationship_create proposals at 0.5 confidence, evidence carried', () => {
    const rel = { from_match: 'Retain civil engineer', to_match: 'Grading plan', type: 'blocks' as const, reason: 'CE must be retained before grading scope', evidence: 'grading scope depends on the CE contract' };
    const r = routeExtractResult(
      { ...base, relationships: [rel] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ type: 'relationship_create', payload: rel, confidence: 0.5, reasoning: rel.reason, evidence: rel.evidence });
  });
  it('empty claims never reach the inbox (agent bug #3): whitespace what/evidence/matches are dropped', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ what: '  ', blocked_by: 'Noa', evidence: 'q' }],
        deadline_updates: [{ task_match: 'x', new_due: '2026-09-01', evidence: '  ' }],
        relationships: [{ from_match: ' ', to_match: 'y', type: 'blocks' as const, reason: 'r', evidence: 'q' }],
        decisions: [{ title: '  ' }],
      },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals).toHaveLength(0);
  });
  it('two creates for the same deliverable in ONE batch collapse to one (agent bug #2 — the triple LID)', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create' as const, title: 'Submit LID clearance package', priority: 'normal' as const },
          { op: 'create' as const, title: 'Submit LID  clearance package!', priority: 'normal' as const },
          { op: 'create' as const, title: 'Order tree report', priority: 'normal' as const },
        ],
      },
      { projectId: 'p1', openTasks: [] },
    );
    expect(r.autoCreates.map((t) => t.title)).toEqual(['Submit LID clearance package', 'Order tree report']);
  });
});
