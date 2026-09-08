'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/state-writer';

export async function releaseBlocker(blockerId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  // Audit-coverage (learning map §F): a release makes the blocked task
  // actionable — a real prioritization input. Capture before/after so the
  // signal is reconstructable, same shape as every other logged mutation.
  const { data: before } = await admin.from('blockers').select('status').eq('id', blockerId).maybeSingle();
  const { error } = await admin.from('blockers').update({ status: 'released' }).eq('id', blockerId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'blocker', entity_id: blockerId, actor: user.email ?? user.id,
    action: 'release_blocker', before: before ?? null, after: { status: 'released' },
  });
  revalidatePath('/');
  return { ok: true };
}
