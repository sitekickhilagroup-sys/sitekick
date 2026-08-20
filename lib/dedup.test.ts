import { describe, expect, it } from 'vitest';
import { matchExistingTask } from './dedup';
import type { Task } from './types';

function t(id: string, title: string, project_id = 'p1', stage_key: string | null = null): Task {
  return { id, title, project_id, stage_key, status: 'open' } as Task;
}

describe('matchExistingTask', () => {
  it('matches rephrased same work', () => {
    const open = [t('x', 'Retain Surveyor (Updated Survey / Topo)')];
    const match = matchExistingTask(
      { title: 'Retain surveyor — updated survey/topo', project_id: 'p1' },
      open,
    );
    expect(match?.id).toBe('x');
  });

  it('does not match different work', () => {
    const open = [t('x', 'Retain Surveyor for boundary work')];
    const match = matchExistingTask(
      { title: 'Retain Civil Engineer for grading plan', project_id: 'p1' },
      open,
    );
    expect(match).toBeNull();
  });

  it('never matches across projects', () => {
    const open = [t('x', 'Retain Surveyor (Updated Survey / Topo)', 'p2')];
    const match = matchExistingTask(
      { title: 'Retain Surveyor (Updated Survey / Topo)', project_id: 'p1' },
      open,
    );
    expect(match).toBeNull();
  });

  it('matches contained shorter title against longer existing', () => {
    const open = [t('x', 'Send P&G the bond details for the renewal decision')];
    const match = matchExistingTask(
      { title: 'Send bond details to P&G', project_id: 'p1' },
      open,
    );
    expect(match?.id).toBe('x');
  });

  it('penalizes stage mismatch below threshold on borderline match', () => {
    const open = [t('x', 'File city forms fees', 'p1', 'entitlements')];
    const borderline = { title: 'File city forms packet', project_id: 'p1' };
    expect(matchExistingTask({ ...borderline, stage_key: 'entitlements' }, open)?.id).toBe('x');
    expect(matchExistingTask({ ...borderline, stage_key: 'permits' }, open)).toBeNull();
  });
});
