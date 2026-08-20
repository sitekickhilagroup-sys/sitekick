'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';

export async function createTask(formData: FormData) {
  await requireUser();
  const admin = supabaseAdmin();
  const projectId = String(formData.get('project_id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!projectId || !title) return { error: 'missing fields' };
  const description = String(formData.get('description') ?? '').trim() || null;
  const owner = String(formData.get('owner') ?? '').trim() || null;
  const due = String(formData.get('due') ?? '') || null;
  const { error } = await admin.from('tasks').insert({
    project_id: projectId,
    title,
    description,
    owner,
    due,
    source: 'manual',
    planned: true,
  });
  if (error) return { error: error.message };
  revalidatePath('/');
  return { ok: true };
}

export async function setTaskStatus(taskId: string, status: 'open' | 'done' | 'dropped') {
  await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    status,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  revalidatePath('/');
  return { ok: true };
}

export async function updateTaskWaiting(taskId: string, waitingFor: string) {
  await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({
    waiting_for: waitingFor.trim() || null,
    last_touched: laToday(),
  }).eq('id', taskId);
  if (error) return { error: error.message };
  revalidatePath('/');
  return { ok: true };
}
