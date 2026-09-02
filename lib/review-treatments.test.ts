import { describe, expect, it } from 'vitest';
import { defaultTreatment, treatmentsFor } from './review-treatments.ts';

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
