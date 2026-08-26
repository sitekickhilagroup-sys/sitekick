'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { verbToPatch, type WorkVerb } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';

const VALID_VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];

/**
 * One update verb → one canonical write, plus the audit row Undo needs.
 * The caller gets `undoId` back so the row can offer "Update recorded · Undo"
 * without a second round trip, exactly like Noa's demo.
 */
export async function applyWorkVerb(taskId: string, verb: WorkVerb, input: string | null) {
  const user = await requireUser();
  if (!VALID_VERBS.includes(verb)) return { error: 'invalid verb' };
  const mapped = verbToPatch(verb, input, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', taskId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: mapped.action, before, after: verb === 'note' ? { note: input } : mapped.patch,
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const, undoId };
}

/** Restores the task snapshot taken before the verb was applied. */
export async function undoWorkVerb(logId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as { entity_type: string; entity_id: string; before_json: Record<string, unknown> | null } | null;
  if (!entry?.before_json || entry.entity_type !== 'task') return { error: 'nothing to undo' };
  const before = entry.before_json;
  const restore: Record<string, unknown> = {};
  // A6: task-details edits (owner/waiting/due already covered above) also
  // touch project/phase/sub-stage/workstream/impact — before_json is a full
  // row snapshot either way, so restoring the extra keys is a no-op for
  // verb-only edits and a real restore for a details edit.
  for (const k of ['status', 'waiting_for', 'due', 'last_touched', 'description', 'owner', 'latest_note',
    'project_id', 'stage_key', 'substage_template_id', 'workstream_id', 'process_impact'] as const) {
    restore[k] = before[k] ?? null;
  }
  const { error } = await admin.from('tasks').update(restore).eq('id', entry.entity_id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo', after: restore,
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const };
}

export async function snoozeTask(taskId: string, until: string) {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: 'invalid date' };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ snoozed_until: until }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'snooze', after: { until } });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

export async function pinTask(taskId: string, manualPriority: number | null) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ manual_priority: manualPriority }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'pin', after: { manualPriority } });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}
