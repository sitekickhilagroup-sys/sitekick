import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectOpenTasksExcludingTest } from './open-tasks.ts';

interface FakeTask { id: string; project_id?: string | null; is_test?: boolean }
interface FakeProject { id: string; is_test?: boolean }

/** A minimal chainable fake mirroring supabase-js's query builder shape for
 *  both `tasks` and `projects`. `columnsExist` simulates whether migration
 *  0026 has landed yet (both is_test columns land together in that file). */
function fakeAdmin(opts: {
  columnsExist: boolean;
  tasks: FakeTask[];
  projects: FakeProject[];
}) {
  const buildTasks = (eqCalls: string[], notCalls: string[]) => {
    const self = {
      eq: (col: string, val: unknown) => buildTasks([...eqCalls, `${col}=${val}`], notCalls),
      not: (col: string, _op: string, val: string) => buildTasks(eqCalls, [...notCalls, `${col}${val}`]),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (eqCalls.some((c) => c.startsWith('is_test=')) && !opts.columnsExist) {
          resolve({ data: null, error: { message: 'column tasks.is_test does not exist', code: '42703' } });
          return;
        }
        let rows = opts.tasks;
        if (eqCalls.includes('is_test=false')) rows = rows.filter((r) => !r.is_test);
        const excludedProjectsCall = notCalls.find((c) => c.startsWith('project_id('));
        if (excludedProjectsCall) {
          const ids = excludedProjectsCall.slice('project_id('.length, -1).split(',');
          rows = rows.filter((r) => !r.project_id || !ids.includes(r.project_id));
        }
        resolve({ data: rows, error: null });
      },
    };
    return self;
  };
  const buildProjects = (eqCalls: string[]) => ({
    eq: (col: string, val: unknown) => buildProjects([...eqCalls, `${col}=${val}`]),
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      if (!opts.columnsExist) {
        resolve({ data: null, error: { message: 'column projects.is_test does not exist', code: '42703' } });
        return;
      }
      const rows = eqCalls.includes('is_test=true') ? opts.projects.filter((p) => p.is_test) : opts.projects;
      resolve({ data: rows, error: null });
    },
  });
  const admin = {
    from: (table: string) => ({
      select: () => (table === 'projects' ? buildProjects([]) : buildTasks([], [])),
    }),
  } as unknown as SupabaseClient;
  return { admin };
}

describe('selectOpenTasksExcludingTest', () => {
  it('excludes a task flagged is_test directly, once columns exist', async () => {
    const { admin } = fakeAdmin({
      columnsExist: true,
      tasks: [{ id: 'real-1' }, { id: 'test-1', is_test: true }],
      projects: [],
    });
    const res = await selectOpenTasksExcludingTest(admin);
    expect(res.error).toBeNull();
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['real-1']);
  });

  it("excludes a task under a TEST PROJECT even when the task's own flag was never set (Rotem's cascade requirement)", async () => {
    const { admin } = fakeAdmin({
      columnsExist: true,
      tasks: [{ id: 'real-1', project_id: 'p-real' }, { id: 'under-test-project', project_id: 'p-test' }],
      projects: [{ id: 'p-real' }, { id: 'p-test', is_test: true }],
    });
    const res = await selectOpenTasksExcludingTest(admin);
    expect(res.error).toBeNull();
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['real-1']);
  });

  it('falls back to the unfiltered query when the columns do not exist yet (pre-migration) — never returns zero tasks because of this', async () => {
    const { admin } = fakeAdmin({
      columnsExist: false,
      tasks: [{ id: 'real-1' }, { id: 'real-2' }],
      projects: [],
    });
    const res = await selectOpenTasksExcludingTest(admin);
    expect(res.error).toBeNull();
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['real-1', 'real-2']);
  });
});
