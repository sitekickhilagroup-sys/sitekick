import type { SupabaseClient, PostgrestResponse } from '@supabase/supabase-js';
import type { Task } from './types.ts';

/**
 * The one open-tasks query every business-critical path shares (the
 * prioritization run, the daily digest, the extractor's OPEN TASKS context) —
 * excluding UI-driven test records the moment that capability exists, with
 * ZERO deploy-ordering risk.
 *
 * Two ways a task counts as a test record: its own `is_test` flag, OR it
 * belongs to a project whose `is_test` flag is set (Rotem's requirement — a
 * tester marks the PROJECT once, not every task created under it one by one).
 * Computed with a join at read time, not a generated column, so flipping a
 * project's flag takes effect on the very next query.
 *
 * Migration 0026 (supabase/migrations/0026_test_isolation_and_notes_status.sql)
 * adds these columns, but this agent has read-only DB access this session and
 * cannot apply it. Shipping the filter unconditionally before the columns
 * exist would make the WHOLE query error — not just that clause — and every
 * one of these three callers currently does `(data ?? []) as Task[]` on
 * failure, so that would silently rank/digest/extract against ZERO open
 * tasks. That is a much worse regression than "test records aren't excluded
 * yet".
 *
 * So: try the filtered query first; if it errors (missing column today, or
 * any transient issue), fall back to the exact unfiltered query every caller
 * already ran before this file existed. The moment the migration lands, the
 * filtered branch starts succeeding on its own — no redeploy, no further
 * action from anyone.
 */
export async function selectOpenTasksExcludingTest(
  admin: SupabaseClient,
): Promise<PostgrestResponse<Task>> {
  const testProjects = await admin.from('projects').select('id').eq('is_test', true);
  if (!testProjects.error) {
    const testProjectIds = (testProjects.data ?? []).map((p: { id: string }) => p.id);
    let query = admin.from('tasks').select('*').eq('status', 'open').eq('is_test', false);
    if (testProjectIds.length) {
      // PostgREST "not in" excludes NULL project_id rows entirely (NULL NOT IN (...) is
      // neither true nor false), so OR in an explicit is-null branch to keep them.
      query = query.or(`project_id.is.null,project_id.not.in.(${testProjectIds.join(',')})`);
    }
    const filtered = await query;
    if (!filtered.error) return filtered as PostgrestResponse<Task>;
  }
  return admin.from('tasks').select('*').eq('status', 'open') as unknown as Promise<PostgrestResponse<Task>>;
}
