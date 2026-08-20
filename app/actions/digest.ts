'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { buildDigest } from '@/agents/daily-digest';

export async function generateDigest() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  const laDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  await buildDigest(supabaseAdmin(), laDate);
  revalidatePath('/digest');
}
