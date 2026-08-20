'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

export async function releaseBlocker(blockerId: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  await supabaseAdmin().from('blockers').update({ status: 'released' }).eq('id', blockerId);
  revalidatePath('/');
}
