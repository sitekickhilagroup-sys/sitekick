'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { buildDigest } from '@/agents/daily-digest';
import { BudgetExceededError } from '@/lib/claude';

/** Demo Safety Gate (item 7): a thrown BudgetExceededError must surface as a
 *  clear, catchable {error} — never an unhandled exception that would break
 *  the Weekly Review / Digest page. */
export async function generateDigest(): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  try {
    await buildDigest(supabaseAdmin(), laToday());
  } catch (e) {
    if (e instanceof BudgetExceededError) return { error: `Demo budget reached — digest generation is paused (${e.message})` };
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/digest');
  return { ok: true };
}
