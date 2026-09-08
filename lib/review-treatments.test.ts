import { describe, expect, it } from 'vitest';
import { defaultTreatment, selectableTasksFor, targetTaskError, treatmentsFor, updateFieldsPreview } from './review-treatments.ts';

describe('updateFieldsPreview — "what will change" before Apply', () => {
  it('lists only the fields the human filled, on update_existing', () => {
    expect(updateFieldsPreview('update_existing', { title: 'New title', owner: 'Rowan', due: '', note: '' }))
      .toEqual([{ field: 'title', value: 'New title' }, { field: 'owner', value: 'Rowan' }]);
  });
  it('does not change the title on merge_duplicate', () => {
    expect(updateFieldsPreview('merge_duplicate', { title: 'X', note: 'n' }))
      .toEqual([{ field: 'note', value: 'n' }]);
  });
  it('adds status→done on complete_existing', () => {
    expect(updateFieldsPreview('complete_existing', { note: 'done via city' }))
      .toEqual([{ field: 'note', value: 'done via city' }, { field: 'status', value: 'done' }]);
  });
  it('is empty for non-update treatments (create/link/info)', () => {
    expect(updateFieldsPreview('new_task', { title: 'X' })).toEqual([]);
    expect(updateFieldsPreview('information_only', { note: 'n' })).toEqual([]);
    expect(updateFieldsPreview('keep_both_linked', { title: 'X' })).toEqual([]);
  });
});

describe('selectableTasksFor — target-task choices for the chosen project', () => {
  const tasks = [
    { id: 'a', projectId: 'p1' },
    { id: 'b', projectId: 'p2' },
    { id: 'c', projectId: null },
  ];
  it('filters to the chosen project', () => {
    expect(selectableTasksFor(tasks, 'p1').map((t) => t.id)).toEqual(['a']);
  });
  it('treats "" and null as General', () => {
    expect(selectableTasksFor(tasks, '').map((t) => t.id)).toEqual(['c']);
    expect(selectableTasksFor(tasks, null).map((t) => t.id)).toEqual(['c']);
  });
});

describe('targetTaskError — server guard for a manual target pick', () => {
  it('accepts an open task in the same project', () => {
    expect(targetTaskError({ status: 'open', project_id: 'p1' }, 'p1')).toBeNull();
    expect(targetTaskError({ status: 'open', project_id: null }, '')).toBeNull();
  });
  it('rejects a missing task', () => {
    expect(targetTaskError(null, 'p1')).toBe('target task not found');
  });
  it('rejects a task that is not open', () => {
    expect(targetTaskError({ status: 'done', project_id: 'p1' }, 'p1')).toBe('target task is not open');
  });
  it('rejects a task in a different project', () => {
    expect(targetTaskError({ status: 'open', project_id: 'p2' }, 'p1')).toBe('target task belongs to a different project');
  });
});

describe('treatmentsFor', () => {
  it('drops every task-rewriting treatment when nothing matched', () => {
    expect(treatmentsFor('task_create', false)).toEqual(['new_task', 'information_only']);
  });
  it('offers the full set once a task matched', () => {
    expect(treatmentsFor('task_update', true)).toContain('complete_existing');
  });
  it('leads with apply_as_stated for a structural proposal', () => {
    expect(treatmentsFor('relationship_create', false)[0]).toBe('apply_as_stated');
    expect(treatmentsFor('blocker_create', false)).toContain('new_task');
  });
});

describe('defaultTreatment', () => {
  it('never opens on a treatment that needs a task there is none of', () => {
    expect(defaultTreatment('task_done', false)).toBe('new_task');
    expect(defaultTreatment('task_update', false)).toBe('new_task');
  });
  it('closes the matched task for a done claim', () => {
    expect(defaultTreatment('task_done', true)).toBe('complete_existing');
    expect(defaultTreatment('task_update', true)).toBe('update_existing');
  });
  it('applies a structural proposal as what it is, matched or not', () => {
    expect(defaultTreatment('relationship_create', false)).toBe('apply_as_stated');
    expect(defaultTreatment('deadline_update', true)).toBe('apply_as_stated');
  });
});
