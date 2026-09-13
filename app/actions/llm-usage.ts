'use server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireAdmin } from './users';
import { summarizeLlmUsage, type LlmUsageRow, type LlmUsageSummary } from '@/lib/llm-usage-summary';

// Read-only admin view over llm_usage_log (Cost Controls Release 1). Reuses
// the SAME admin gate as user management (ADMIN_EMAILS) — no new permission
// model. Aggregation itself (summarizeLlmUsage) lives in
// lib/llm-usage-summary.ts, a plain module, not here — a synchronous export
// from a 'use server' file fails the Next.js build.

/** Admin-only. Throws for a non-admin caller — settings/page.tsx wraps this
 *  in `.catch(() => null)`, mirroring listUsers()'s pattern, so the card
 *  simply doesn't render for non-admins. */
export async function getLlmUsageSummary(): Promise<LlmUsageSummary> {
  await requireAdmin();
  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from('llm_usage_log')
    .select('created_at, job, action_type, model, attempt, success, input_tokens, output_tokens, estimated_cost_usd')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  return summarizeLlmUsage((data ?? []) as LlmUsageRow[]);
}
