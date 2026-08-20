'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

async function assertUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
}

export async function setDraftStatus(draftId: string, status: 'approved' | 'dismissed' | 'sent') {
  await assertUser();
  const admin = supabaseAdmin();
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  await admin.from('drafts').update(patch).eq('id', draftId);
  revalidatePath('/drafts');
}
