import type { SupabaseClient, PostgrestResponse } from '@supabase/supabase-js';
import type { Task } from './types.ts';

/**
 * The one open-tasks query every business-critical path shares (the
 * prioritization run, the daily digest, the extractor's OPEN TASKS context) —
 * excluding UI-driven test records the moment that capability exists, with
 * ZERO deploy-ordering risk.
 *
 * Migration 0026 (supabase/migrations/0026_test_isolation_and_notes_status.sql)
 * adds tasks.is_test, but this agent has read-only DB access this session and
 * cannot apply it. Shipping `.eq('is_test', false)` unconditionally before
 * that column exists would make the WHOLE query error — not just that
 * clause — and every one of these three callers currently does
 * `(data ?? []) as Task[]` on failure, so that would silently rank/digest/
 * extract against ZERO open tasks. That is a much worse regression than
 * "test records aren't excluded yet".
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
  const filtered = await admin.from('tasks').select('*').eq('status', 'open').eq('is_test', false);
  if (!filtered.error) return filtered as PostgrestResponse<Task>;
  return admin.from('tasks').select('*').eq('status', 'open') as unknown as Promise<PostgrestResponse<Task>>;
}
