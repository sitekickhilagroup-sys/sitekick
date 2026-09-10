import { describe, expect, it } from 'vitest';
import { buildTaskHistoryEntries, type TaskHistoryRow } from './task-history.ts';

const fmt = (iso: string) => `fmt(${iso})`;

const row = (overrides: Partial<TaskHistoryRow>): TaskHistoryRow => ({
  id: 'log-1', actor: 'noa@hillagroup.com', action: 'edit:details',
  before_json: { title: 'Old', status: 'open' },
  after_json: { title: 'New' },
  created_at: '2026-09-10T20:00:00Z',
  ...overrides,
});

describe('buildTaskHistoryEntries', () => {
  it('only the newest (index 0) entry is undoable', () => {
    const rows = [
      row({ id: 'a', created_at: '2026-09-10T20:00:00Z' }),
      row({ id: 'b', created_at: '2026-09-10T19:00:00Z' }),
      row({ id: 'c', created_at: '2026-09-10T18:00:00Z' }),
    ];
    const entries = buildTaskHistoryEntries(rows, fmt);
    expect(entries.map((e) => [e.id, e.canUndo])).toEqual([
      ['a', true], ['b', false], ['c', false],
    ]);
  });

  it('the newest entry is not undoable if it has no before_json (e.g. a create)', () => {
    const rows = [row({ id: 'a', before_json: null })];
    expect(buildTaskHistoryEntries(rows, fmt)[0].canUndo).toBe(false);
  });

  it('last_touched is never reported as a changed field, even when it is the only real change', () => {
    const rows = [row({
      before_json: { last_touched: '2026-09-07', status: 'open' },
      after_json: { last_touched: '2026-09-10', status: 'open' },
    })];
    expect(buildTaskHistoryEntries(rows, fmt)[0].changedKeys).toEqual([]);
  });

  it('reports every other changed key', () => {
    const rows = [row({
      before_json: { title: 'Old', owner: 'Bob', last_touched: '2026-09-07' },
      after_json: { title: 'New', owner: 'Bob', last_touched: '2026-09-10' },
    })];
    expect(buildTaskHistoryEntries(rows, fmt)[0].changedKeys).toEqual(['title']);
  });

  // Live-caught: reopen/verb actions log a full-row before_json (Undo needs
  // the whole snapshot) alongside a small AFTER patch naming only the fields
  // that action actually touched (e.g. reopen's after_json is just
  // {status: 'open'}). changedKeys must follow after_json's own keys, not
  // "every column that differs from before" — the latter treats every
  // untouched, merely-populated column (id, is_test, created_at, ...) as a
  // change, which is exactly the bug seen live on a plain Reopen.
  it('a partial after_json (reopen/verb shape) reports only the keys it actually names, not every populated column', () => {
    const rows = [row({
      before_json: {
        id: 'task-1', status: 'done', title: 'Set up LLC bank account', owner: 'Noa',
        is_test: false, created_at: '2026-09-07T00:00:00Z', priority: 'normal',
      },
      after_json: { status: 'open' },
    })];
    expect(buildTaskHistoryEntries(rows, fmt)[0].changedKeys).toEqual(['status']);
  });

  it('formats createdAt through the injected formatter and passes actor/action through unchanged', () => {
    const rows = [row({ actor: 'x@y.com', action: 'verb:completed', created_at: '2026-09-10T20:00:00Z' })];
    const entry = buildTaskHistoryEntries(rows, fmt)[0];
    expect(entry.actor).toBe('x@y.com');
    expect(entry.action).toBe('verb:completed');
    expect(entry.createdAt).toBe('fmt(2026-09-10T20:00:00Z)');
  });

  it('empty input yields empty output', () => {
    expect(buildTaskHistoryEntries([], fmt)).toEqual([]);
  });
});
