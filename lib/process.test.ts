import { describe, expect, it } from 'vitest';
import { groupProcess, substageUndoRestore, unactivatedConditionals } from './process.ts';
import type { Phase, ProjectSubstage, SubstageTemplate, Workstream } from './types.ts';

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
    const inst: ProjectSubstage[] = [{
      id: 'i1', project_id: 'p1', substage_template_id: 's2', workstream_id: null,
      status: 'active', note: null, decision: null, activated_at: '2026-08-01', completed_at: null,
    }];
    const out = groupProcess({ phases, templates, instances: inst, workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).toEqual(['s1', 's2']);
  });
  it('attaches workstreams to their phase and orders phases by position', () => {
    const out = groupProcess({ phases: [phases[1], phases[0]], templates, instances: [], workstreams: ws });
    expect(out.map((p) => p.phase.key)).toEqual(['planning', 'plan_check']);
    expect(out[1].workstreams).toEqual(ws);
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
  it('excludes a conditional template once it has an instance past "upcoming"', () => {
    const inst: ProjectSubstage[] = [{
      id: 'i1', project_id: 'p1', substage_template_id: 's2', workstream_id: null,
      status: 'active', note: null, decision: null, activated_at: '2026-08-01', completed_at: null,
    }];
    expect(unactivatedConditionals(templates, inst).has('planning')).toBe(false);
  });
  it('a conditional template with an "upcoming" instance is still unactivated — true complement of groupProcess', () => {
    const inst: ProjectSubstage[] = [{
      id: 'i1', project_id: 'p1', substage_template_id: 's2', workstream_id: null,
      status: 'upcoming', note: null, decision: null, activated_at: null, completed_at: null,
    }];
    const byPhase = unactivatedConditionals(templates, inst);
    expect(byPhase.get('planning')?.map((t) => t.id)).toEqual(['s2']);

    const out = groupProcess({ phases, templates, instances: inst, workstreams: ws });
    expect(out[0].substages.map((s) => s.template.id)).not.toContain('s2');
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
