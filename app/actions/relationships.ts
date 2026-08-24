'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/state-writer';
import type { RelationshipType } from '@/lib/types';

const VALID_TYPES: RelationshipType[] = [
  'blocks', 'supports', 'parallel', 'unrelated', 'needs_verification',
  'required_for', 'affects', 'related', 'independent', 'conditional',
];

export async function saveRelationship(fromTaskId: string, toTaskId: string, type: RelationshipType, reason: string) {
  const user = await requireUser();
  if (!fromTaskId || !toTaskId) return { error: 'missing task' };
  if (fromTaskId === toTaskId) return { error: 'a task cannot depend on itself' };
  if (!VALID_TYPES.includes(type)) return { error: 'invalid type' };
  const admin = supabaseAdmin();
  const { data: fromTask, error: fromError } = await admin
    .from('tasks')
    .select('project_id')
    .eq('id', fromTaskId)
    .maybeSingle();
  if (fromError) return { error: fromError.message };
  if (!fromTask) return { error: 'task not found' };
  const { data, error } = await admin
    .from('relationships')
    .upsert(
      {
        project_id: fromTask.project_id,
        from_task_id: fromTaskId,
        to_task_id: toTaskId,
        type,
        reason: reason.trim() || null,
        confidence: 1,
        manual_override: true,
        verified_by: user.email,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'from_task_id,to_task_id' },
    )
    .select('id')
    .single();
  if (error) return { error: error.message };
  const actor = user.email ?? user.id;
  await logActivity(admin, {
    entity_type: 'relationship',
    entity_id: data.id,
    actor,
    action: 'save',
    after: { from_task_id: fromTaskId, to_task_id: toTaskId, type, reason: reason.trim() || null },
  });
  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath('/projects/[id]', 'page');
  return { ok: true };
}

export async function deleteRelationship(id: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;
  const { error } = await admin.from('relationships').delete().eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'relationship', entity_id: id, actor, action: 'delete' });
  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath('/projects/[id]', 'page');
  return { ok: true };
}
