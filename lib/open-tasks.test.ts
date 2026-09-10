import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectOpenTasksExcludingTest } from './open-tasks.ts';

/** A minimal chainable fake mirroring supabase-js's query builder shape:
 *  .from().select().eq().eq() is a query; awaiting it resolves {data,error}.
 *  `columnExists` simulates whether migration 0026 has landed yet. */
function fakeAdmin(opts: { columnExists: boolean; rows: { id: string; is_test?: boolean }[] }) {
  const calls: string[][] = [];
  const build = (eqCalls: string[]) => {
    const self = {
      eq: (col: string, val: unknown) => {
        const next = [...eqCalls, `${col}=${val}`];
        return build(next);
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        calls.push(eqCalls);
        if (eqCalls.some((c) => c.startsWith('is_test=')) && !opts.columnExists) {
          resolve({ data: null, error: { message: 'column tasks.is_test does not exist', code: '42703' } });
          return;
        }
        const filtered = eqCalls.includes('is_test=false')
          ? opts.rows.filter((r) => !r.is_test)
          : opts.rows;
        resolve({ data: filtered, error: null });
      },
    };
    return self;
  };
  const admin = {
    from: () => ({ select: () => build([]) }),
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe('selectOpenTasksExcludingTest', () => {
  it('excludes is_test rows once the column exists (post-migration)', async () => {
    const { admin } = fakeAdmin({
      columnExists: true,
      rows: [{ id: 'real-1' }, { id: 'test-1', is_test: true }],
    });
    const res = await selectOpenTasksExcludingTest(admin);
    expect(res.error).toBeNull();
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['real-1']);
  });

  it('falls back to the unfiltered query when is_test does not exist yet (pre-migration) — never returns zero tasks because of this', async () => {
    const { admin } = fakeAdmin({
      columnExists: false,
      rows: [{ id: 'real-1' }, { id: 'real-2' }],
    });
    const res = await selectOpenTasksExcludingTest(admin);
    expect(res.error).toBeNull();
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['real-1', 'real-2']);
  });
});
