import { describe, expect, it } from 'vitest';
import { parseRecordImport, stageLabel, stagePosition } from './requirements.ts';
import { mapState } from './schema.ts';

describe('mapState', () => {
  it('maps done flag to done', () => {
    expect(mapState({ r: 'x', done: true })).toBe('done');
  });
  it('maps done_noev state to done', () => {
    expect(mapState({ r: 'x', state: 'done_noev' })).toBe('done');
  });
  it('maps open to open', () => {
    expect(mapState({ r: 'x', state: 'open' })).toBe('open');
  });
  it('maps unknown to unknown', () => {
    expect(mapState({ r: 'x', state: 'unknown' })).toBe('unknown');
  });
  it('defaults missing state to open', () => {
    expect(mapState({ r: 'x' })).toBe('open');
  });
  it('treats unrecognized state strings as unknown', () => {
    expect(mapState({ r: 'x', state: 'weird' })).toBe('unknown');
  });
});

describe('parseRecordImport', () => {
  const minimal = {
    stage: 'entitlements',
    stages: {
      entitlements: {
        items: [
          { r: 'Site control', done: true, who: 'us', state: 'done_noev', basis: 'standard' },
          { r: 'Hearing scheduled', state: 'unknown', who: 'city' },
        ],
        total: 2,
      },
    },
  };

  it('parses a minimal valid record', () => {
    const result = parseRecordImport(minimal);
    expect(result.currentStage).toBe('entitlements');
    expect(result.stages).toHaveLength(1);
    const stage = result.stages[0];
    expect(stage.stage_key).toBe('entitlements');
    expect(stage.requirements).toHaveLength(2);
    expect(stage.requirements[0].state).toBe('done');
    expect(stage.requirements[1].state).toBe('unknown');
    expect(stage.requirements[1].who).toBe('city');
  });

  it('rejects invalid who values', () => {
    const bad = {
      stage: 'entitlements',
      stages: { entitlements: { items: [{ r: 'x', who: 'them' }] } },
    };
    expect(() => parseRecordImport(bad)).toThrow();
  });

  it('accepts unknown stage keys with generated labels after known ones', () => {
    const result = parseRecordImport({
      stage: 'plan_approval',
      stages: { plan_approval: { items: [{ r: 'File it' }] } },
    });
    expect(result.stages[0].label).toBe('Plan Approval');
    expect(result.stages[0].position).toBeGreaterThan(stagePosition('delivery'));
  });

  it('sorts stages by canonical order', () => {
    const result = parseRecordImport({
      stage: 'feasibility',
      stages: {
        permits: { items: [] },
        feasibility: { items: [] },
        plan_check: { items: [] },
      },
    });
    expect(result.stages.map((s) => s.stage_key)).toEqual([
      'feasibility', 'plan_check', 'permits',
    ]);
  });
});

describe('stageLabel', () => {
  it('uses catalog labels for known keys', () => {
    expect(stageLabel('plan_check')).toBe('Plan Check');
    expect(stageLabel('b_permit')).toBe('B Permit');
  });
  it('title-cases unknown keys', () => {
    expect(stageLabel('plan_approval')).toBe('Plan Approval');
  });
});
