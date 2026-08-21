'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const projectId = String(formData.get('project_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!projectId || !title) return { error: 'missing fields' };
  const description = String(formData.get('description') ?? '').trim() || null;
  const owner = String(formData.get('owner') ?? '').trim() || null;
  const due = String(formData.get('due') ?? '') || null;
  const { data, error } = await admin.from('tasks').insert({
    project_id: projectId,
    title,
    description,
    owner,
    due,
    source: 'manual',
    planned: true,
  }).select('id').single();
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: data.id, actor: user.email ?? user.id, action: 'create', after: { title, description, owner, due } });
  revalidatePath('/');
  return { ok: true };
}

export async function setTaskStatus(taskId: string, status: 'open' | 'done' | 'dropped') {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    status,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'set_status', after: { status } });
  revalidatePath('/');
  return { ok: true };
}

export async function updateTaskWaiting(taskId: string, waitingFor: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    waiting_for: waitingFor.trim() || null,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'set_waiting', after: { waiting_for: waitingFor.trim() || null } });
  revalidatePath('/');
  return { ok: true };
}
