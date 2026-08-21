'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { applyProposal, logActivity } from '@/lib/state-writer';
import type { AgentProposal } from '@/lib/types';

async function decide(id: string, accept: boolean): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;
  const { data } = await admin.from('agent_proposals').select('*').eq('id', id).eq('state', 'pending').maybeSingle();
  if (!data) return { error: 'proposal not found or already decided' };
  const proposal = data as AgentProposal;
  if (accept) {
    const applied = await applyProposal(admin, proposal, actor, laToday());
    if ('error' in applied) return applied;
  }
  const { error } = await admin.from('agent_proposals')
    .update({ state: accept ? 'accepted' : 'rejected', decided_by: actor, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'proposal', entity_id: id, actor, action: accept ? 'accept_proposal' : 'reject_proposal' });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/inbox');
  revalidatePath('/projects/[id]', 'page');
  return { ok: true };
}

export async function acceptProposal(id: string) { return decide(id, true); }
export async function rejectProposal(id: string) { return decide(id, false); }
