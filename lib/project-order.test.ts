import { describe, expect, test } from 'vitest';
import { orderProjectsByRtiProgress, rtiProgressScore } from './project-order';
import type { Phase, PhaseKey, ProjectSubstage, SubstageTemplate } from './types';

const phases: Pick<Phase, 'key' | 'position'>[] = [
  { key: 'planning', position: 1 },
  { key: 'plan_check', position: 2 },
  { key: 'bidding', position: 3 },
  { key: 'financing', position: 4 },
  { key: 'construction', position: 5 },
];

const tpl = (id: string, phase_key: PhaseKey, position: number): SubstageTemplate =>
  ({ id, phase_key, position, name: id, kind: 'standard' }) as SubstageTemplate;
const templates = [
  tpl('pl-1', 'planning', 1), tpl('pl-9', 'planning', 9),
  tpl('pc-2', 'plan_check', 2), tpl('pc-8', 'plan_check', 8),
  tpl('fin-2', 'financing', 2),
];

const inst = (project_id: string, substage_template_id: string, status: ProjectSubstage['status']): ProjectSubstage =>
  ({ project_id, substage_template_id, status }) as ProjectSubstage;

const proj = (id: string, name: string, current_phase_key: PhaseKey | null, business_rank: number | null) =>
  ({ id, name, current_phase_key, business_rank });

describe('orderProjectsByRtiProgress', () => {
  test('a later phase always outranks an earlier one, regardless of sub-stage noise', () => {
    const out = orderProjectsByRtiProgress(
      [proj('a', 'A', 'planning', 1), proj('b', 'B', 'plan_check', 4)],
      phases, templates,
      [inst('a', 'pl-9', 'done')], // deep in planning still loses to plan_check
    );
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
  });

  test('same phase: the furthest MOVING sub-stage in that phase decides', () => {
    const out = orderProjectsByRtiProgress(
      [proj('a', 'A', 'plan_check', 1), proj('b', 'B', 'plan_check', 2)],
      phases, templates,
      [inst('a', 'pc-2', 'with_city'), inst('b', 'pc-8', 'active')],
    );
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
  });

  test('an out-of-phase instance does not teleport a project forward (QA residue)', () => {
    // A project in planning carrying a stray financing instance from a test
    // flip must not leap ahead of genuinely-advanced planning work.
    const score = rtiProgressScore(
      { current_phase_key: 'planning' },
      [inst('b', 'fin-2', 'active')],
      new Map(templates.map((t) => [t.id, t])),
      new Map(phases.map((p) => [p.key, p.position])),
    );
    expect(score).toBe(1000); // phase only, the stray instance adds nothing
  });

  test('waiting/upcoming instances are not progress', () => {
    const score = rtiProgressScore(
      { current_phase_key: 'plan_check' },
      [inst('a', 'pc-8', 'waiting'), inst('a', 'pc-2', 'upcoming')],
      new Map(templates.map((t) => [t.id, t])),
      new Map(phases.map((p) => [p.key, p.position])),
    );
    expect(score).toBe(2000);
  });

  test('full tie falls back to business_rank, nulls last, then name', () => {
    const out = orderProjectsByRtiProgress(
      [proj('c', 'C', 'planning', null), proj('a', 'A', 'planning', 2), proj('b', 'B', 'planning', 1)],
      phases, templates, [],
    );
    expect(out.map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('a project with no phase at all sorts to the end', () => {
    const out = orderProjectsByRtiProgress(
      [proj('none', 'Flicker', null, null), proj('a', 'A', 'planning', 4)],
      phases, templates, [],
    );
    expect(out.map((p) => p.id)).toEqual(['a', 'none']);
  });
});
