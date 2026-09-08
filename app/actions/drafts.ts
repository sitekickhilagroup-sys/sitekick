'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/state-writer';

export async function setDraftStatus(draftId: string, status: 'approved' | 'dismissed' | 'sent') {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const patch: Record<string, unknown> = { status };
  if (status === 'approved') patch.approved_at = new Date().toISOString();
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  // Audit-coverage (learning map §F): approve/dismiss/send is Noa's direct
  // verdict on an AI-written draft — the drafting agent's feedback. It was
  // invisible before; log it as its own action so it can be learned from.
  const { data: before } = await admin.from('drafts').select('status').eq('id', draftId).maybeSingle();
  await admin.from('drafts').update(patch).eq('id', draftId);
  await logActivity(admin, {
    entity_type: 'draft', entity_id: draftId, actor: user.email ?? user.id,
    action: `draft:${status}`, before: before ?? null, after: patch,
  });
  revalidatePath('/drafts');
}
