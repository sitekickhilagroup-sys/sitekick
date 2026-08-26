import { describe, expect, it } from 'vitest';
import { findDuplicatePairs, matchExistingTask } from './dedup';
import type { Task } from './types';

function t(id: string, title: string, project_id: string | null = 'p1', stage_key: string | null = null): Task {
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

  it('never matches across two known projects', () => {
    const open = [t('x', 'Retain Surveyor (Updated Survey / Topo)', 'p2')];
    const match = matchExistingTask(
      { title: 'Retain Surveyor (Updated Survey / Topo)', project_id: 'p1' },
      open,
    );
    expect(match).toBeNull();
  });

  // The eleven duplicate groups Noa found were all this shape: one row filed
  // against the project, an identical row with no project showing as General.
  // They were never compared, so they could never be deduplicated.
  it('matches an unassigned candidate against the same work in a project', () => {
    const open = [t('x', 'Retain Certified Arborist', 'p1')];
    const match = matchExistingTask(
      { title: 'Retain Certified Arborist', project_id: null },
      open,
    );
    expect(match?.id).toBe('x');
  });

  it('matches a project candidate against the same work sitting in General', () => {
    const open = [t('x', 'Hold Letter Corrections', null)];
    const match = matchExistingTask(
      { title: 'Hold Letter Corrections', project_id: 'p1' },
      open,
    );
    expect(match?.id).toBe('x');
  });

  it('still needs the work to look the same when one side is unassigned', () => {
    const open = [t('x', 'Retain Civil Engineer for grading plan', null)];
    const match = matchExistingTask(
      { title: 'Review new lawsuit filing', project_id: 'p1' },
      open,
    );
    expect(match).toBeNull();
  });

  it('prefers the same-project row over an unassigned one', () => {
    const open = [
      t('general', 'Form LLC for San Marco', null),
      t('scoped', 'Form LLC for San Marco', 'p1'),
    ];
    const match = matchExistingTask(
      { title: 'Form LLC for San Marco', project_id: 'p1' },
      open,
    );
    expect(match?.id).toBe('scoped');
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

describe('findDuplicatePairs', () => {
  it('pairs a General twin with the same work filed against a project', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      t('general', 'Hold Letter Corrections', null),
    ];
    const pairs = findDuplicatePairs(open);
    expect(pairs.length).toBe(1);
  });

  it('finds no pairs among unrelated titles', () => {
    const open = [
      t('a', 'Retain Certified Arborist', 'san-marco'),
      t('b', 'Review new lawsuit filing', null),
    ];
    const pairs = findDuplicatePairs(open);
    expect(pairs.length).toBe(0);
  });
});
