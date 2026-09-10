import { describe, expect, it } from 'vitest';
import { applyCasGuard } from './state-writer.ts';

/** A minimal stand-in for a Supabase update query builder — records which
 *  filter each call applied instead of talking to a real database, so the
 *  branching logic (null -> .is, non-null -> .eq) can be verified directly. */
function fakeQuery() {
  const calls: { method: 'eq' | 'is'; col: string; val: unknown }[] = [];
  const builder = {
    calls,
    eq(col: string, val: unknown) { calls.push({ method: 'eq', col, val }); return builder; },
    is(col: string, val: null) { calls.push({ method: 'is', col, val }); return builder; },
  };
  return builder;
}

describe('applyCasGuard', () => {
  it('uses .eq for a non-null value', () => {
    const q = applyCasGuard(fakeQuery(), { status: 'open' }, ['status']);
    expect(q.calls).toEqual([{ method: 'eq', col: 'status', val: 'open' }]);
  });

  it('uses .is for a null value, not .eq (PostgREST eq.null does not mean IS NULL)', () => {
    const q = applyCasGuard(fakeQuery(), { owner: null }, ['owner']);
    expect(q.calls).toEqual([{ method: 'is', col: 'owner', val: null }]);
  });

  it('treats an undefined value the same as null (column absent from the snapshot)', () => {
    const q = applyCasGuard(fakeQuery(), {}, ['owner']);
    expect(q.calls).toEqual([{ method: 'is', col: 'owner', val: null }]);
  });

  it('chains one filter per key, in order, over a mix of null and non-null values', () => {
    const q = applyCasGuard(fakeQuery(), { status: 'open', owner: null, title: 'Fix roof' }, ['status', 'owner', 'title']);
    expect(q.calls).toEqual([
      { method: 'eq', col: 'status', val: 'open' },
      { method: 'is', col: 'owner', val: null },
      { method: 'eq', col: 'title', val: 'Fix roof' },
    ]);
  });

  it('applies no filters for an empty key list', () => {
    const q = applyCasGuard(fakeQuery(), { status: 'open' }, []);
    expect(q.calls).toEqual([]);
  });
});
