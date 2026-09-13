'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import { runPrioritization } from '@/agents/prioritize-tasks';
import { BudgetExceededError } from '@/lib/claude';

/** My Work's "Refresh priorities" button — one full agent run on demand.
 *  The daily digest cron runs the same core; this exists so Noa never waits
 *  for tomorrow after a day that changed everything.
 *
 *  Demo Safety Gate (item 7): runStructured can throw BudgetExceededError —
 *  this must surface as a clear, catchable {error}, never an unhandled
 *  Server Action exception that would break the whole My Work page. */
export async function refreshPriorities(): Promise<{ ok: true; ranked: number } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  let summary;
  try {
    summary = await runPrioritization(admin, laToday());
  } catch (e) {
    if (e instanceof BudgetExceededError) return { error: `Demo budget reached — priority refresh is paused (${e.message})` };
    throw e;
  }
  if ('error' in summary) return summary;
  // Cost Controls Release 1, step 5: a skip means no relevant business data
  // changed since the last run — the existing ranking is reused as-is, so
  // there's nothing new to log (no agent call happened this time).
  if (!('skipped' in summary)) {
    await logActivity(admin, {
      entity_type: 'priority_run', entity_id: summary.run_id,
      actor: user.email ?? user.id, action: 'prioritize',
      after: { ranked: summary.ranked, missing: summary.missing, unknown: summary.unknown },
    });
  }
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true, ranked: summary.ranked };
}
