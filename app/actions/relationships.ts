'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/state-writer';
import { decideNotDuplicateOutcome } from '@/lib/dedup';
import type { Relationship, RelationshipType } from '@/lib/types';

const VALID_TYPES: RelationshipType[] = [
  'blocks', 'supports', 'parallel', 'unrelated', 'needs_verification',
  'required_for', 'affects', 'related', 'independent', 'conditional',
];

export async function saveRelationship(
  fromTaskId: string, toTaskId: string, type: RelationshipType, reason: string,
): Promise<{ error: string } | { ok: true }> {
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

/**
 * "Not a duplicate" from the /work duplicate-review list. Calling
 * saveRelationship directly here would be unsafe: its upsert is keyed on
 * `(from_task_id, to_task_id)` alone, not on `type`, so it would silently
 * overwrite ANY existing relationship sitting on that exact key — including
 * a real, verified 'blocks' edge between two tasks that also happen to look
 * like title duplicates — with 'unrelated'. And because that key is
 * direction-sensitive, an edge recorded the other way round (b->a) wouldn't
 * conflict at all: writing a->b would leave a second, contradictory row
 * next to an untouched b->a.
 *
 * This reads every relationship between the two ids in EITHER direction
 * first (one query, both directions — no raw string interpolation needed:
 * `.in()` on both columns against the same two-id list only ever matches
 * a->b or b->a, since a self-relationship is refused everywhere it could be
 * created). decideNotDuplicateOutcome (lib/dedup.ts, unit-tested) then
 * decides: a meaningful edge either way is refused, named with its actual
 * type, so the caller can tell Noa what's already recorded instead of
 * quietly destroying it; an 'unrelated' edge already sitting in either
 * direction is treated as already done, no redundant second row; only a
 * genuinely clean pair reaches saveRelationship's write.
 */
export async function markPairNotDuplicate(
  taskId1: string,
  taskId2: string,
  reason: string,
): Promise<{ error: string; conflictType?: RelationshipType } | { ok: true }> {
  await requireUser();
  if (!taskId1 || !taskId2) return { error: 'missing task' };
  if (taskId1 === taskId2) return { error: 'a task cannot depend on itself' };
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('relationships')
    .select('type')
    .in('from_task_id', [taskId1, taskId2])
    .in('to_task_id', [taskId1, taskId2]);
  if (error) return { error: error.message };

  const outcome = decideNotDuplicateOutcome((data ?? []) as Pick<Relationship, 'type'>[]);
  if (outcome.kind === 'blocked') return { error: 'already recorded', conflictType: outcome.conflictType };
  if (outcome.kind === 'noop') return { ok: true as const };
  return saveRelationship(taskId1, taskId2, 'unrelated', reason);
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
