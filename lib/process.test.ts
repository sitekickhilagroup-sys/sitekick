import { describe, expect, it } from 'vitest';
import { bucketTasksByPhase, computeSubstageMove, groupProcess, selectConnectedTasks, substageSortKey, substageUndoRestore, unactivatedConditionals } from './process.ts';
import type { Phase, PhaseKey, ProjectSubstage, SubstageTemplate, Task, Workstream } from './types.ts';

// 0019 fixture helper — position/depends_on default null (library order).
function substage(over: Partial<ProjectSubstage> & { id: string; substage_template_id: string }): ProjectSubstage {
  return {
    project_id: 'p1', workstream_id: null, status: 'active', note: null,
    decision: null, activated_at: '2026-08-01', completed_at: null,
    position: null, depends_on: null,
    ...over,
  };
}

function task(over: Partial<Task> & { id: string }): Task {
  return {
    project_id: 'p1', document_id: null, title: 'Test task', description: null,
    owner: null, waiting_for: null, due: null, stage_key: null, priority: 'normal',
    status: 'open', planned: true, follow_up_date: null, check_back_on: null,
    source: null, last_touched: '2026-08-20', created_at: '2026-08-20T00:00:00Z',
    manual_priority: null, snoozed_until: null, process_impact: null,
    merged_into: null, merged_at: null, merged_by: null, latest_note: null,
    substage_template_id: null, workstream_id: null,
    ...over,
  };
}

const phases: Phase[] = [
  { key: 'planning', label: 'Planning', position: 1 },
  { key: 'plan_check', label: 'Plan Check', position: 2 },
];
const templates: SubstageTemplate[] = [
  { id: 's1', phase_key: 'planning', name: 'Application filed', kind: 'standard', position: 1 },
  { id: 's2', phase_key: 'planning', name: 'Hold Letter response', kind: 'conditional', position: 2 },
  { id: 's3', phase_key: 'plan_check', name: 'Intake accepted', kind: 'standard', position: 1 },
];
const ws: Workstream[] = [
  { id: 'w1', project_id: 'p1', name: 'Design / Engineering', phase_key: 'plan_check', status: 'active' },
];

describe('groupProcess', () => {
  it('always shows standard substages, instance or not', () => {
    const out = groupProcess({ phases, templates, instances: [], workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).toEqual(['s1']); // conditional s2 hidden
    expect(out[0].substages[0].instance).toBeNull();
  });
  it('shows a conditional substage only once activated', () => {
    const inst = [substage({ id: 'i1', substage_template_id: 's2' })];
    const out = groupProcess({ phases, templates, instances: inst, workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).toEqual(['s1', 's2']);
  });
  it('attaches workstreams to their phase and orders phases by position', () => {
    const out = groupProcess({ phases: [phases[1], phases[0]], templates, instances: [], workstreams: ws });
    expect(out.map((p) => p.phase.key)).toEqual(['planning', 'plan_check']);
    expect(out[1].workstreams).toEqual(ws);
  });
  it('a manual position override (0019) reorders within the phase; entries without one keep library order', () => {
    // s1 library key = 1*10 = 10; s2 activated with position 5 jumps ahead.
    const inst = [substage({ id: 'i1', substage_template_id: 's2', position: 5 })];
    const out = groupProcess({ phases, templates, instances: inst, workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).toEqual(['s2', 's1']);
  });
});

describe('substageSortKey / computeSubstageMove', () => {
  const tpl = (id: string, position: number, kind: SubstageTemplate['kind'] = 'standard'): SubstageTemplate =>
    ({ id, phase_key: 'planning', name: id, kind, position });

  it('sortKey: manual position wins, otherwise library position ×10', () => {
    expect(substageSortKey({ template: tpl('a', 3), instance: null })).toBe(30);
    expect(substageSortKey({ template: tpl('a', 3), instance: substage({ id: 'i', substage_template_id: 'a', position: 7 }) })).toBe(7);
  });

  it('moving up lands just before the displayed neighbor, skipping hidden conditionals', () => {
    // Visible order: a(10), c(30) — b is an unactivated conditional (hidden).
    const entries = [
      { template: tpl('a', 1), instance: null },
      { template: tpl('b', 2, 'conditional'), instance: null },
      { template: tpl('c', 3), instance: substage({ id: 'ic', substage_template_id: 'c' }) },
    ];
    // c up: neighbor is a (key 10) -> 10 - 5 = 5, so c now sorts first.
    expect(computeSubstageMove(entries, 'ic', 'up')).toEqual({ newPosition: 5 });
  });

  it('moving past the edge returns null, and unknown ids return null', () => {
    const entries = [
      { template: tpl('a', 1), instance: substage({ id: 'ia', substage_template_id: 'a' }) },
    ];
    expect(computeSubstageMove(entries, 'ia', 'up')).toBeNull();
    expect(computeSubstageMove(entries, 'ia', 'down')).toBeNull();
    expect(computeSubstageMove(entries, 'nope', 'up')).toBeNull();
  });

  it('moving down lands just past the next visible neighbor', () => {
    const entries = [
      { template: tpl('a', 1), instance: substage({ id: 'ia', substage_template_id: 'a' }) },
      { template: tpl('b', 2), instance: null },
    ];
    // a down: neighbor b (key 20) -> 25.
    expect(computeSubstageMove(entries, 'ia', 'down')).toEqual({ newPosition: 25 });
  });
});

// Amendment (controller, Task 2): getProjectProcess also returns
// unactivatedByPhase: Map<PhaseKey, SubstageTemplate[]> — the true complement
// of groupProcess's substages visibility test (!instance || instance.status
// === 'upcoming'), grouped by phase, for Task 4's "Activate sub-stage"
// disclosure. getProjectProcess itself can't be unit-tested (live supabase
// calls), so the grouping logic lives in this pure, exported, tested helper
// — getProjectProcess just assigns its result.
describe('unactivatedConditionals', () => {
  it('groups conditional templates with no instance row by phase, and groupProcess excludes them from substages', () => {
    const byPhase = unactivatedConditionals(templates, []);
    expect(byPhase.get('planning')?.map((t) => t.id)).toEqual(['s2']);
    expect(byPhase.has('plan_check')).toBe(false); // s3 is standard, not conditional

    const out = groupProcess({ phases, templates, instances: [], workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).not.toContain('s2');
  });
  it('excludes a conditional template once it has any instance', () => {
    const inst = [substage({ id: 'i1', substage_template_id: 's2' })];
    expect(unactivatedConditionals(templates, inst).has('planning')).toBe(false);
  });
  it('an "upcoming" instance keeps the sub-stage VISIBLE with its note — it does not bounce back to the bank (Noa round 3, bug #3)', () => {
    const inst = [substage({
      id: 'i1', substage_template_id: 's2', status: 'upcoming',
      activated_at: null, note: 'city wants the arborist letter first',
    })];
    // Not in the bank…
    expect(unactivatedConditionals(templates, inst).has('planning')).toBe(false);
    // …but in the visible list, note intact, as planned/upcoming.
    const out = groupProcess({ phases, templates, instances: inst, workstreams: ws });
    const shown = out[0].substages.find((s) => s.template.id === 's2');
    expect(shown?.instance?.status).toBe('upcoming');
    expect(shown?.instance?.note).toBe('city wants the arborist letter first');
  });
});

// C3: undoSubstageChange's restore set, extracted so it's testable without a
// database. before_json is always a full project_substages row snapshot.
describe('substageUndoRestore', () => {
  it('restores status, completed_at and note from a full-row snapshot', () => {
    const before = {
      id: 'i1', project_id: 'p1', substage_template_id: 's1', workstream_id: null,
      status: 'blocked', note: 'waiting on city sign-off', decision: null,
      activated_at: '2026-08-01', completed_at: null,
    };
    expect(substageUndoRestore(before)).toEqual({ status: 'blocked', completed_at: null, note: 'waiting on city sign-off' });
  });
  it('restores a done snapshot\'s completed_at alongside status, so the two never disagree after undo', () => {
    const before = { status: 'done', completed_at: '2026-08-01', note: null };
    expect(substageUndoRestore(before)).toEqual({ status: 'done', completed_at: '2026-08-01', note: null });
  });
  it('defaults a missing/undefined status to upcoming and nulls for completed_at/note', () => {
    expect(substageUndoRestore({})).toEqual({ status: 'upcoming', completed_at: null, note: null });
  });
});

// Review round 2 (C2 ruling): tasks used to be bucketed by stage_key /
// current_phase_key alone — a task whose only phase signal was its linked
// sub-stage template could land under the wrong phase, or (once C2 scoped
// each sub-stage's panel to substage_template_id matches) vanish from every
// phase's panel entirely. bucketTasksByPhase reuses resolveTaskPhaseKey's
// precedence so this can't drift from My Work's phaseLabelFor.
describe('bucketTasksByPhase', () => {
  const stageMap: { stage_key: string; phase_key: PhaseKey }[] = [
    { stage_key: 'grading', phase_key: 'bidding' },
  ];

  it('a task whose only phase signal is its sub-stage template lands in that template\'s phase, not the project\'s current phase', () => {
    const t = task({ id: 't1', substage_template_id: 's3' }); // s3 -> plan_check
    const { tasksByPhase, unmappedTasks } = bucketTasksByPhase([t], templates, stageMap, 'planning');
    expect(tasksByPhase.get('plan_check')?.map((x) => x.id)).toEqual(['t1']);
    expect(tasksByPhase.has('planning')).toBe(false);
    expect(unmappedTasks).toEqual([]);
  });

  it('a legacy stage_key task still lands where the stage_phase_map bridge says, same as before', () => {
    const t = task({ id: 't2', stage_key: 'grading' }); // -> bidding
    const { tasksByPhase } = bucketTasksByPhase([t], templates, stageMap, 'planning');
    expect(tasksByPhase.get('bidding')?.map((x) => x.id)).toEqual(['t2']);
  });

  it('a task with neither signal falls back to the project\'s current phase', () => {
    const t = task({ id: 't3' });
    const { tasksByPhase } = bucketTasksByPhase([t], templates, stageMap, 'planning');
    expect(tasksByPhase.get('planning')?.map((x) => x.id)).toEqual(['t3']);
  });

  it('the sub-stage template wins over a conflicting legacy stage_key — same precedence resolveTaskPhaseKey settled for My Work', () => {
    const t = task({ id: 't4', substage_template_id: 's3', stage_key: 'grading' }); // s3 -> plan_check, grading -> bidding
    const { tasksByPhase } = bucketTasksByPhase([t], templates, stageMap, 'planning');
    expect(tasksByPhase.get('plan_check')?.map((x) => x.id)).toEqual(['t4']);
    expect(tasksByPhase.has('bidding')).toBe(false);
  });

  it('a task with no resolvable phase at all goes to unmappedTasks, never dropped silently', () => {
    const t = task({ id: 't5' });
    const { tasksByPhase, unmappedTasks } = bucketTasksByPhase([t], templates, stageMap, null);
    expect(unmappedTasks.map((x) => x.id)).toEqual(['t5']);
    expect(tasksByPhase.size).toBe(0);
  });
});

// C2: SubstageDetail's mine/phaseOnly/shown selection, pulled out of the
// component so the branch the reviewer flagged as untested (capped list vs.
// phase-level fallback) has real assertions.
describe('selectConnectedTasks', () => {
  it('mine only includes tasks linked to this exact sub-stage template', () => {
    const tasks = [{ id: 'a', substage_template_id: 's1' }, { id: 'b', substage_template_id: 's2' }];
    expect(selectConnectedTasks(tasks, 's1').mine.map((t) => t.id)).toEqual(['a']);
  });

  it('phaseOnly is every task with no substage_template_id, the same regardless of which sub-stage is selected', () => {
    const tasks = [
      { id: 'a', substage_template_id: 's1' },
      { id: 'b', substage_template_id: null },
      { id: 'c', substage_template_id: null },
    ];
    expect(selectConnectedTasks(tasks, 's1').phaseOnly.map((t) => t.id)).toEqual(['b', 'c']);
    expect(selectConnectedTasks(tasks, 's2').phaseOnly.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('shown caps mine at 4, preserving order', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, substage_template_id: 's1' }));
    const { mine, shown } = selectConnectedTasks(tasks, 's1');
    expect(mine).toHaveLength(6);
    expect(shown.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3']);
  });

  it('a task belonging to a sibling sub-stage in the same phase lands in neither mine nor phaseOnly', () => {
    const tasks = [{ id: 'a', substage_template_id: 's2' }];
    const result = selectConnectedTasks(tasks, 's1');
    expect(result.mine).toEqual([]);
    expect(result.phaseOnly).toEqual([]);
  });
});
