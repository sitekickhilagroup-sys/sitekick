'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';

export async function releaseBlocker(blockerId: string) {
  await requireUser();
  const { error } = await supabaseAdmin().from('blockers').update({ status: 'released' }).eq('id', blockerId);
  if (error) return { error: error.message };
  revalidatePath('/');
  return { ok: true };
}
