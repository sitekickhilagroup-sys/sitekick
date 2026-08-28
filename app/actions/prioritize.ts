'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import { runPrioritization } from '@/agents/prioritize-tasks';

/** My Work's "Refresh priorities" button — one full agent run on demand.
 *  The daily digest cron runs the same core; this exists so Noa never waits
 *  for tomorrow after a day that changed everything. */
export async function refreshPriorities(): Promise<{ ok: true; ranked: number } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const summary = await runPrioritization(admin, laToday());
  if ('error' in summary) return summary;
  await logActivity(admin, {
    entity_type: 'priority_run', entity_id: summary.run_id,
    actor: user.email ?? user.id, action: 'prioritize',
    after: { ranked: summary.ranked, missing: summary.missing, unknown: summary.unknown },
  });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true, ranked: summary.ranked };
}
