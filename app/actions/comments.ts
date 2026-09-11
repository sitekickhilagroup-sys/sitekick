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
  revalidatePath('/notes-center');
  return { ok: true };
}

/**
 * Notes Center (Noa's report §2): associate or re-associate a REAL comment
 * row to a task/project/blocker, or mark it general/unsure. Saving the
 * association is interpretation+attribution only — it never touches the
 * target record itself (no business update rides along). Mirrors saveComment's
 * validation (a linked note must point at a real record).
 */
export async function retargetComment(
  id: string,
  entityType: EntityType,
  entityId?: string | null,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  if (!isEntityType(entityType)) return { error: 'invalid link type' };
  const admin = supabaseAdmin();
  let resolvedId: string | null = entityId?.trim() || null;
  if (entityType === 'general') {
    resolvedId = null;
  } else {
    if (!resolvedId) return { error: 'pick an item to link to' };
    const { data: ent } = await admin.from(ENTITY_TABLE[entityType]).select('id').eq('id', resolvedId).maybeSingle();
    if (!ent) return { error: `${entityType} not found` };
  }
  const { data: before } = await admin.from('comments').select('entity_type,entity_id').eq('id', id).maybeSingle();
  const { error } = await admin.from('comments')
    .update({ entity_type: entityType, entity_id: resolvedId }).eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'comment', entity_id: id, actor: user.email ?? user.id,
    action: 'comment:retarget',
    before: before ?? null, after: { entity_type: entityType, entity_id: resolvedId },
  });
  revalidatePath('/notes-center');
  revalidatePath('/work');
  return { ok: true };
}

/**
 * Notes Center: turn a VIRTUAL historical item (a task's latest_note, never
 * written to `comments`) into a real, reviewable row the first time Noa acts
 * on it — approving its interpretation, re-targeting it, or dismissing it.
 * Idempotent by construction: once a task has any real comment, the loader
 * (lib/notes-center.ts's mergeNoteSources) stops offering its historical item
 * at all, so a second promotion attempt for the same task can't create a
 * second row for the same note.
 */
export async function promoteHistoricalNote(input: {
  taskId: string;
  body: string;
  intent: string;
  entityType: EntityType;
  entityId?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const user = await requireUser();
  if (!isIntent(input.intent)) return { error: 'invalid intent' };
  const body = (input.body ?? '').trim();
  if (!body) return { error: 'empty note' };
  const admin = supabaseAdmin();

  // Refuse if a real comment already exists for this task — the loader should
  // already have hidden this historical item in that case, but the server
  // never trusts the client's view of that state.
  const { data: existing } = await admin.from('comments')
    .select('id').eq('entity_type', 'task').eq('entity_id', input.taskId).limit(1).maybeSingle();
  if (existing) return { error: 'this note was already reviewed' };

  const entityType = input.entityType;
  if (!isEntityType(entityType)) return { error: 'invalid link type' };
  let entityId: string | null = input.entityId?.trim() || null;
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
    intent: input.intent,
    interpreter_version: INTENT_CLASSIFIER_VERSION,
    created_by: user.email ?? user.id,
  }).select('id').single();
  if (error) return { error: error.message };

  await logActivity(admin, {
    entity_type: 'comment', entity_id: data.id, actor: user.email ?? user.id,
    action: 'comment:promote_historical',
    after: { source_task_id: input.taskId, entity_type: entityType, entity_id: entityId, intent: input.intent },
  });
  revalidatePath('/notes-center');
  revalidatePath('/work');
  return { ok: true, id: data.id as string };
}

export interface IssueBacklogItem {
  id: string;
  body: string;
  entityType: EntityType;
  entityId: string | null;
  timeEstimate: string | null;
  significance: 'low' | 'medium' | 'high' | 'critical' | null;
  triaged: boolean;
  createdBy: string;
  createdAt: string;
}

const SIGNIFICANCE_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Rotem's on-demand backlog: every open "Report a problem" note, most
 * significant first. Untriaged items (the daily cron hasn't reached
 * them yet) sort last within their tier, with no time estimate — real
 * status, not silently promised. Never returns a QA-project note.
 */
export async function listIssueBacklog(): Promise<{ ok: true; items: IssueBacklogItem[] } | { error: string }> {
  await requireUser();
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('comments')
    .select('id, body, entity_type, entity_id, time_estimate, significance, triaged_at, created_by, created_at')
    .eq('intent', 'issue')
    .eq('is_test', false)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return { error: error.message };
  const rows = (data ?? []) as {
    id: string; body: string; entity_type: EntityType; entity_id: string | null;
    time_estimate: string | null; significance: IssueBacklogItem['significance']; triaged_at: string | null;
    created_by: string; created_at: string;
  }[];
  const items: IssueBacklogItem[] = rows.map((r) => ({
    id: r.id, body: r.body, entityType: r.entity_type, entityId: r.entity_id,
    timeEstimate: r.time_estimate, significance: r.significance,
    triaged: !!r.triaged_at, createdBy: r.created_by, createdAt: r.created_at,
  }));
  items.sort((a, b) => {
    const ra = a.significance ? SIGNIFICANCE_RANK[a.significance] : 99;
    const rb = b.significance ? SIGNIFICANCE_RANK[b.significance] : 99;
    if (ra !== rb) return ra - rb;
    return a.createdAt < b.createdAt ? 1 : -1; // newest first within a tier
  });
  return { ok: true, items };
}
