'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { verbToPatch, type WorkVerb } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';

const VALID_VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];

export async function applyWorkVerb(taskId: string, verb: WorkVerb, input: string | null) {
  const user = await requireUser();
  if (!VALID_VERBS.includes(verb)) return { error: 'invalid verb' };
  const mapped = verbToPatch(verb, input, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: mapped.action, after: verb === 'note' ? { note: input } : mapped.patch,
  });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
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
