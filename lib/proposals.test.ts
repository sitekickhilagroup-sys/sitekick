import { describe, expect, it } from 'vitest';
import { routeExtractResult, type RouteContext } from './proposals.ts';
import type { Task } from './types.ts';

const openTask = {
  id: 't1', project_id: 'p1', title: 'Retain civil engineer', status: 'open',
} as unknown as Task;

// Two known projects — the Aug 24 meeting summary covered four at once, which
// is the scenario this router exists for.
const NAMES: Record<string, string> = { 'san marco': 'p1', 'rinconia': 'p2' };
const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  resolveProject: (name) => (name ? NAMES[name.toLowerCase()] ?? null : null),
  defaultProjectId: null,
  openTasks: [openTask],
  ...over,
});

const base = { project_name: null, tasks: [], blockers: [], decisions: [], drafts: [], vendor_hours: [], deadline_updates: [], relationships: [] };

describe('routeExtractResult', () => {
  it('new unmatched create goes to autoCreates under its own project', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, project_name: 'San Marco', title: 'Order tree report', priority: 'normal' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(1);
    expect(r.autoCreates[0]).toMatchObject({ project_id: 'p1', op: { title: 'Order tree report' } });
    expect(r.proposals).toHaveLength(0);
  });
  it('update with existing_id becomes task_update proposal at 0.8, project taken from the matched task', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, project_name: null, title: 'Retain civil engineer', priority: 'normal', owner: 'Noa' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.8, project_id: 'p1' });
  });
  it('status done becomes task_done proposal', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, project_name: 'San Marco', title: 'Retain civil engineer', priority: 'normal', status: 'done' }] },
      ctx(),
    );
    expect(r.proposals[0].type).toBe('task_done');
  });
  it('create that fuzzy-matches an open task becomes a 0.6 proposal, not a duplicate', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, project_name: 'San Marco', title: 'retain the civil engineer', priority: 'normal' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('multi-project batch: each item routes to its own project (the Aug 24 failure mode)', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create', stage_key: null, project_name: 'San Marco', title: 'Respond to Hold Letter', priority: 'normal' },
          { op: 'create', stage_key: null, project_name: 'Rinconia', title: 'Pay City intake invoice', priority: 'critical' },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates.map((c) => c.project_id)).toEqual(['p1', 'p2']);
  });
  it('same deliverable title on TWO projects creates both — dedup key is project-scoped', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create', stage_key: null, project_name: 'San Marco', title: 'Retain replacement civil engineer', priority: 'normal' },
          { op: 'create', stage_key: null, project_name: 'Rinconia', title: 'Retain replacement civil engineer', priority: 'normal' },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(2);
  });
  it('create with NO resolvable project becomes a task_create proposal — never silently dropped', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, project_name: null, title: 'Pay all outstanding invoices', priority: 'normal' }] },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: null, confidence: 0.5 });
  });
  it('existing_id living on ANOTHER project is rejected — the Landscape SM↔Rinconia bait', () => {
    // Model attributed the item to Rinconia but handed San Marco's task id.
    // The id must not be trusted; with no same-project match it becomes a
    // task_create proposal for review instead of an update on the wrong board.
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, project_name: 'Rinconia', title: 'Retain landscape consultant', priority: 'normal' }] },
      ctx(),
    );
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: 'p2', target_task_id: null, confidence: 0.4 });
  });
  it('hallucinated existing_id falls back to fuzzy match instead of proposing against nothing', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 'no-such-task', stage_key: null, project_name: 'San Marco', title: 'Retain civil engineer', priority: 'normal' }] },
      ctx(),
    );
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('update claim with no match at all becomes a task_create proposal for review', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', stage_key: null, project_name: 'San Marco', title: 'Completely unknown deliverable', priority: 'normal' }] },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: 'p1', confidence: 0.4 });
  });
  it('document-level default project catches items that name none (single-project email)', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, project_name: null, title: 'Order tree report', priority: 'normal' }] },
      ctx({ defaultProjectId: 'p2', openTasks: [] }),
    );
    expect(r.autoCreates[0]).toMatchObject({ project_id: 'p2' });
  });
  it('blockers, decisions and deadline updates become proposals carrying evidence and their own project', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ project_name: 'San Marco', blocks_phase: null, what: 'CE not retained', blocked_by: 'Noa decision', evidence: 'we cannot proceed until the CE is retained' }],
        decisions: [{ project_name: 'Rinconia', title: 'Go with waiver' }],
        deadline_updates: [{ project_name: 'San Marco', task_match: 'Retain civil engineer', new_due: '2026-09-01', evidence: 'email says so' }],
      },
      ctx(),
    );
    expect(r.proposals.map((p) => p.type).sort()).toEqual(['blocker_create', 'deadline_update', 'decision_create'].sort());
    // Agent bug #3: the quote must reach evidence_excerpt, not be dropped.
    expect(r.proposals.find((p) => p.type === 'blocker_create')).toMatchObject({ evidence: 'we cannot proceed until the CE is retained', project_id: 'p1' });
    expect(r.proposals.find((p) => p.type === 'decision_create')?.project_id).toBe('p2');
    expect(r.proposals.find((p) => p.type === 'deadline_update')?.evidence).toBe('email says so');
  });
  it('relationships become relationship_create proposals at 0.5 confidence, evidence carried', () => {
    const rel = { project_name: 'San Marco', from_match: 'Retain civil engineer', to_match: 'Grading plan', type: 'blocks' as const, reason: 'CE must be retained before grading scope', evidence: 'grading scope depends on the CE contract' };
    const r = routeExtractResult(
      { ...base, relationships: [rel] },
      ctx(),
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ type: 'relationship_create', payload: rel, confidence: 0.5, reasoning: rel.reason, evidence: rel.evidence, project_id: 'p1' });
  });
  it('empty claims never reach the inbox (agent bug #3): whitespace what/evidence/matches are dropped', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ project_name: null, blocks_phase: null, what: '  ', blocked_by: 'Noa', evidence: 'q' }],
        deadline_updates: [{ project_name: null, task_match: 'x', new_due: '2026-09-01', evidence: '  ' }],
        relationships: [{ project_name: null, from_match: ' ', to_match: 'y', type: 'blocks' as const, reason: 'r', evidence: 'q' }],
        decisions: [{ project_name: null, title: '  ' }],
      },
      ctx(),
    );
    expect(r.proposals).toHaveLength(0);
  });
  it('two creates for the same deliverable in ONE batch collapse to one (agent bug #2 — the triple LID)', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create' as const, stage_key: null, project_name: 'San Marco', title: 'Submit LID clearance package', priority: 'normal' as const },
          { op: 'create' as const, stage_key: null, project_name: 'San Marco', title: 'Submit LID  clearance package!', priority: 'normal' as const },
          { op: 'create' as const, stage_key: null, project_name: 'San Marco', title: 'Order tree report', priority: 'normal' as const },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates.map((c) => c.op.title)).toEqual(['Submit LID clearance package', 'Order tree report']);
  });
});
