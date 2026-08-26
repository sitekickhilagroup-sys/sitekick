import { describe, expect, it } from 'vitest';
import { buildDetailsPatch, resolveTaskPhaseKey, resolveTaskSubstageLabel, validateDetailsIntegrity, type TaskDetailsPatch } from './task-details.ts';

describe('buildDetailsPatch', () => {
  it('whitelists a present key and null-coalesces it', () => {
    expect(buildDetailsPatch({ owner: 'Rowan' })).toEqual({ clean: { owner: 'Rowan' } });
    expect(buildDetailsPatch({ owner: null })).toEqual({ clean: { owner: null } });
  });

  it('omits keys the patch never mentions, distinct from explicitly-null keys', () => {
    const result = buildDetailsPatch({ owner: 'Rowan' });
    const clean = (result as { clean: Record<string, unknown> }).clean;
    expect('waiting_for' in clean).toBe(false);
    expect('owner' in clean).toBe(true);
  });

  it('never writes stage_key even if a caller tries to smuggle it in — 0015 gave tasks substage_template_id instead', () => {
    const smuggled = { owner: 'Rowan', stage_key: 'planning' } as unknown as TaskDetailsPatch;
    const result = buildDetailsPatch(smuggled);
    const clean = (result as { clean: Record<string, unknown> }).clean;
    expect('stage_key' in clean).toBe(false);
    expect(clean).toEqual({ owner: 'Rowan' });
  });

  it('accepts a YYYY-MM-DD due date, rejects a malformed one, allows clearing to null', () => {
    expect(buildDetailsPatch({ due: '2026-09-01' })).toEqual({ clean: { due: '2026-09-01' } });
    expect(buildDetailsPatch({ due: 'not-a-date' })).toEqual({ error: 'invalid date' });
    expect(buildDetailsPatch({ due: null })).toEqual({ clean: { due: null } });
  });

  it('accepts any of the six impact values, rejects anything else, allows clearing to null', () => {
    expect(buildDetailsPatch({ process_impact: 'primary_blocker' })).toEqual({ clean: { process_impact: 'primary_blocker' } });
    expect(buildDetailsPatch({ process_impact: 'verify' })).toEqual({ clean: { process_impact: 'verify' } });
    const bogus = { process_impact: 'made_up' } as unknown as TaskDetailsPatch;
    expect(buildDetailsPatch(bogus)).toEqual({ error: 'invalid impact' });
    expect(buildDetailsPatch({ process_impact: null })).toEqual({ clean: { process_impact: null } });
  });

  it('rejects a patch that resolves to no keys at all', () => {
    expect(buildDetailsPatch({})).toEqual({ error: 'empty patch' });
  });

  it('a fully-populated patch keeps every one of the seven DETAIL_KEYS', () => {
    const full: TaskDetailsPatch = {
      owner: 'Rowan', waiting_for: 'City', due: '2026-09-01', project_id: 'p1',
      substage_template_id: 's1', workstream_id: 'w1', process_impact: 'verify',
    };
    expect(buildDetailsPatch(full)).toEqual({
      clean: {
        owner: 'Rowan', waiting_for: 'City', due: '2026-09-01', project_id: 'p1',
        substage_template_id: 's1', workstream_id: 'w1', process_impact: 'verify',
      },
    });
  });
});

describe('validateDetailsIntegrity', () => {
  it('passes when nothing is set', () => {
    expect(validateDetailsIntegrity({}, { effectiveProjectId: null, workstream: null, substageTemplate: null })).toBeNull();
  });

  it('rejects a workstream that belongs to a different project', () => {
    const err = validateDetailsIntegrity({ workstream_id: 'w1' }, {
      effectiveProjectId: 'project-a',
      workstream: { project_id: 'project-b', phase_key: 'planning' },
      substageTemplate: null,
    });
    expect(err).toEqual({ error: 'workstream does not belong to this project' });
  });

  it('accepts a workstream that matches the effective project', () => {
    const err = validateDetailsIntegrity({ workstream_id: 'w1' }, {
      effectiveProjectId: 'project-a',
      workstream: { project_id: 'project-a', phase_key: 'planning' },
      substageTemplate: null,
    });
    expect(err).toBeNull();
  });

  it('catches the race scenario: project_id changes in this patch, workstream_id is untouched but stale', () => {
    // The caller resolves "effective" values before calling this — this test
    // documents why that matters: workstream_id is not in `clean` at all
    // (omitted, unchanged from before_json), but effectiveProjectId already
    // reflects the new project_id from the same patch.
    const err = validateDetailsIntegrity({ project_id: 'project-b' }, {
      effectiveProjectId: 'project-b',
      workstream: { project_id: 'project-a', phase_key: 'planning' }, // the task's old, now-stale workstream
      substageTemplate: null,
    });
    expect(err).toEqual({ error: 'workstream does not belong to this project' });
  });

  it('rejects a workstream and sub-stage template in different phases', () => {
    const err = validateDetailsIntegrity({ workstream_id: 'w1', substage_template_id: 's1' }, {
      effectiveProjectId: 'project-a',
      workstream: { project_id: 'project-a', phase_key: 'planning' },
      substageTemplate: { phase_key: 'bidding' },
    });
    expect(err).toEqual({ error: 'workstream and sub-stage are in different phases' });
  });

  it('accepts a workstream and sub-stage template in the same phase', () => {
    const err = validateDetailsIntegrity({ workstream_id: 'w1', substage_template_id: 's1' }, {
      effectiveProjectId: 'project-a',
      workstream: { project_id: 'project-a', phase_key: 'planning' },
      substageTemplate: { phase_key: 'planning' },
    });
    expect(err).toBeNull();
  });

  it('skips the phase-agreement check when only a sub-stage is set (no workstream to disagree with)', () => {
    const err = validateDetailsIntegrity({ substage_template_id: 's1' }, {
      effectiveProjectId: 'project-a',
      workstream: null,
      substageTemplate: { phase_key: 'planning' },
    });
    expect(err).toBeNull();
  });
});

describe('resolveTaskPhaseKey', () => {
  it('prefers the sub-stage template phase over the legacy bridge and the project phase', () => {
    expect(resolveTaskPhaseKey({ substagePhaseKey: 'bidding', legacyPhaseKey: 'planning', projectPhaseKey: 'financing' })).toBe('bidding');
  });

  it('falls back to the legacy stage_key -> stage_phase_map bridge when no sub-stage is set', () => {
    expect(resolveTaskPhaseKey({ substagePhaseKey: null, legacyPhaseKey: 'plan_check', projectPhaseKey: 'financing' })).toBe('plan_check');
  });

  it('falls back to the project current phase when neither a sub-stage nor a legacy tag resolve', () => {
    expect(resolveTaskPhaseKey({ substagePhaseKey: null, legacyPhaseKey: null, projectPhaseKey: 'construction' })).toBe('construction');
  });

  it('returns null when nothing resolves', () => {
    expect(resolveTaskPhaseKey({})).toBeNull();
  });

  it('the editor\'s own initial guess (no legacyPhaseKey supplied at all) still falls through to the project phase', () => {
    expect(resolveTaskPhaseKey({ substagePhaseKey: null, projectPhaseKey: 'financing' })).toBe('financing');
  });
});

describe('resolveTaskSubstageLabel', () => {
  it('prefers the linked sub-stage template name over the legacy tag', () => {
    expect(resolveTaskSubstageLabel({ substageName: 'Plan check submittal', legacyLabel: 'B Permit' })).toBe('Plan check submittal');
  });

  it('falls back to the legacy stage_key label when no sub-stage is linked', () => {
    expect(resolveTaskSubstageLabel({ substageName: null, legacyLabel: 'B Permit' })).toBe('B Permit');
  });

  it('returns null when neither resolves — most tasks, pre-backfill', () => {
    expect(resolveTaskSubstageLabel({})).toBeNull();
    expect(resolveTaskSubstageLabel({ substageName: null, legacyLabel: null })).toBeNull();
  });
});
