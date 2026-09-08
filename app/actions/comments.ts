'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/state-writer';
import { classifyIntent, INTENT_CLASSIFIER_VERSION, isIntent, type CommentIntent } from '@/lib/comment-intent';

export interface CommentRow {
  id: string;
  entityType: 'task' | 'project' | 'invoice' | 'blocker' | 'general';
  entityId: string | null;
  entityLabel: string;
  body: string;
  suggestedIntent: CommentIntent;
  intent: CommentIntent;
  createdBy: string;
  createdAt: string;
}

type EntityType = 'task' | 'project' | 'invoice' | 'blocker' | 'general';
const ENTITY_TABLE: Record<Exclude<EntityType, 'general'>, string> = {
  task: 'tasks', project: 'projects', invoice: 'invoices', blocker: 'blockers',
};
const isEntityType = (v: string): v is EntityType =>
  v === 'task' || v === 'project' || v === 'invoice' || v === 'blocker' || v === 'general';

/**
 * Record a note Noa wrote, linked to a task/project (or general), with a
 * first-pass intent she can correct. v1 performs NO business action — it only
 * stores the note + its interpretation. The note text is data, never an
 * instruction that overrides permissions.
 */
export async function saveComment(input: {
  body: string;
  entityType: EntityType;
  entityId?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const user = await requireUser();
  const body = (input.body ?? '').trim();
  if (!body) return { error: 'empty note' };
  if (body.length > 4000) return { error: 'note too long' };

  const entityType = input.entityType;
  if (!isEntityType(entityType)) return { error: 'invalid link type' };
  let entityId: string | null = input.entityId?.trim() || null;
  const admin = supabaseAdmin();

  // A linked note must point at a real record; general notes carry no id.
  if (entityType === 'general') {
    entityId = null;
  } else {
    if (!entityId) return { error: 'pick an item to link to' };
    const { data: ent } = await admin.from(ENTITY_TABLE[entityType]).select('id').eq('id', entityId).maybeSingle();
    if (!ent) return { error: `${entityType} not found` };
  }

  const suggested = classifyIntent(body);
  const { data, error } = await admin.from('comments').insert({
    entity_type: entityType,
    entity_id: entityId,
    body,
    suggested_intent: suggested,
    intent: suggested,
    interpreter_version: INTENT_CLASSIFIER_VERSION,
    created_by: user.email ?? user.id,
  }).select('id').single();
  if (error) return { error: error.message };

  await logActivity(admin, {
    entity_type: 'comment', entity_id: data.id, actor: user.email ?? user.id,
    action: 'comment:create', after: { entity_type: entityType, entity_id: entityId, suggested_intent: suggested },
  });
  revalidatePath('/notes');
  return { ok: true, id: data.id as string };
}

/** Correct the interpretation of a note (the human overrides the guess). */
export async function correctCommentIntent(id: string, intent: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  if (!isIntent(intent)) return { error: 'invalid intent' };
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('comments').select('intent').eq('id', id).maybeSingle();
  const { error } = await admin.from('comments').update({ intent }).eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'comment', entity_id: id, actor: user.email ?? user.id,
    action: 'comment:reinterpret',
    before: before ?? null, after: { intent },
  });
  revalidatePath('/notes');
  return { ok: true };
}
