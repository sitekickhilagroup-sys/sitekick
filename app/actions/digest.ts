'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { buildDigest } from '@/agents/daily-digest';

export async function generateDigest() {
  await requireUser();
  await buildDigest(supabaseAdmin(), laToday());
  revalidatePath('/digest');
}
