import { describe, expect, it } from 'vitest';
import { draftKey, isDraftStale, parseDraft, type Draft, type DraftSnapshot } from './inbox-draft.ts';

const snap = (overrides: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  state: 'pending', targetTaskId: null, title: 'Contact Provident for history of ownership transfer',
  ...overrides,
});

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  fields: {
    title: 'Edited title', owner: 'Noa', due: '2026-09-20', treatment: 'new_task',
    note: 'in progress', projectId: '', targetTaskId: '', substageId: '', phaseFilter: '',
  },
  snapshot: snap(),
  savedAt: '2026-09-10T12:00:00.000Z',
  ...overrides,
});

describe('draftKey', () => {
  it('namespaces by proposal id', () => {
    expect(draftKey('abc-123')).toBe('sk:inbox-draft:abc-123');
  });
});

describe('isDraftStale', () => {
  it('is not stale when the row matches the snapshot exactly', () => {
    expect(isDraftStale(snap(), snap())).toBe(false);
  });
  it('is stale when state changed (e.g. decided elsewhere while the draft sat unsaved)', () => {
    expect(isDraftStale(snap({ state: 'pending' }), snap({ state: 'accepted' }))).toBe(true);
  });
  it('is stale when the matched target task changed (re-matching landed on a different task)', () => {
    expect(isDraftStale(snap({ targetTaskId: null }), snap({ targetTaskId: 'task-1' }))).toBe(true);
  });
  it('is stale when the title changed', () => {
    expect(isDraftStale(snap({ title: 'Old title' }), snap({ title: 'New title' }))).toBe(true);
  });
});

describe('parseDraft', () => {
  it('round-trips a real draft through JSON', () => {
    const d = draft();
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
  });
  it('rejects invalid JSON', () => {
    expect(parseDraft('{not json')).toBeNull();
  });
  it('rejects a value missing fields/snapshot/savedAt', () => {
    expect(parseDraft(JSON.stringify({}))).toBeNull();
    expect(parseDraft(JSON.stringify({ fields: draft().fields }))).toBeNull();
  });
  it('rejects a draft whose fields object is missing a required string key (older app version)', () => {
    const bad = { ...draft(), fields: { ...draft().fields, note: undefined } };
    expect(parseDraft(JSON.stringify(bad))).toBeNull();
  });
  it('accepts a snapshot with targetTaskId: null but rejects other non-string values', () => {
    expect(parseDraft(JSON.stringify(draft({ snapshot: snap({ targetTaskId: null }) })))).not.toBeNull();
    const bad = { ...draft(), snapshot: { ...snap(), targetTaskId: 42 } };
    expect(parseDraft(JSON.stringify(bad))).toBeNull();
  });
  it('rejects non-object top-level JSON (a bare string or number)', () => {
    expect(parseDraft('"hello"')).toBeNull();
    expect(parseDraft('42')).toBeNull();
    expect(parseDraft('null')).toBeNull();
  });
});
