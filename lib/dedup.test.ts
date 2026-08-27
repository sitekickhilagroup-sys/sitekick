import { describe, expect, it } from 'vitest';
import { findDuplicatePairs, matchExistingTask } from './dedup';
import type { Task } from './types';

function t(id: string, title: string, project_id: string | null = 'p1', stage_key: string | null = null): Task {
  return { id, title, project_id, stage_key, status: 'open' } as Task;
}

function merged(id: string, title: string, project_id: string | null = 'p1'): Task {
  return { id, title, project_id, stage_key: null, status: 'merged', merged_into: 'somewhere-else' } as Task;
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

  // A merge marks the loser `status: 'merged'` + `merged_into` in the same
  // write (0010) — a row in that state is history, not a live duplicate
  // candidate, on either side of a pair.
  it('never pairs a task that has already been merged away', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      merged('gone', 'Hold Letter Corrections', null),
    ];
    expect(findDuplicatePairs(open).length).toBe(0);
  });

  it('never pairs a merged task even when it is the earlier candidate', () => {
    const open = [
      merged('gone', 'Hold Letter Corrections', null),
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
    ];
    expect(findDuplicatePairs(open).length).toBe(0);
  });

  // Noa's "Not a duplicate" persists an 'unrelated' relationship — see
  // saveRelationship (app/actions/relationships.ts). A pair she has already
  // told apart must never resurface as a suggestion again.
  it('excludes a pair already marked unrelated', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      t('general', 'Hold Letter Corrections', null),
    ];
    const relationships = [{ from_task_id: 'scoped', to_task_id: 'general', type: 'unrelated' as const }];
    expect(findDuplicatePairs(open, relationships).length).toBe(0);
  });

  it('excludes a pair marked unrelated in the reverse direction too', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      t('general', 'Hold Letter Corrections', null),
    ];
    const relationships = [{ from_task_id: 'general', to_task_id: 'scoped', type: 'unrelated' as const }];
    expect(findDuplicatePairs(open, relationships).length).toBe(0);
  });

  it('does not let an unrelated mark for a different pair suppress this one', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      t('general', 'Hold Letter Corrections', null),
    ];
    const relationships = [{ from_task_id: 'scoped', to_task_id: 'someone-else', type: 'unrelated' as const }];
    expect(findDuplicatePairs(open, relationships).length).toBe(1);
  });

  it('ignores a non-unrelated relationship between the same two tasks', () => {
    const open = [
      t('scoped', 'Hold Letter Corrections', 'san-marco'),
      t('general', 'Hold Letter Corrections', null),
    ];
    const relationships = [{ from_task_id: 'scoped', to_task_id: 'general', type: 'blocks' as const }];
    expect(findDuplicatePairs(open, relationships).length).toBe(1);
  });
});
