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

// Spec §י + her Reconciliation Agent contract: before creating, check for an
// existing open task with the same goal in the same project. Similar matches
// come back as candidates for a human decision — nothing is created until
// the person confirms "new" (force) or picks "same task".
const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a));
  const tb = new Set(normalize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  owner: string | null;
  due: string | null;
  waiting_for: string | null;
}

export async function createTaskChecked(input: {
  projectId: string | null;
  title: string;
  owner?: string | null;
  due?: string | null;
  waitingFor?: string | null;
  force?: boolean;
}) {
  const user = await requireUser();
  const title = input.title.trim();
  if (!title) return { error: 'missing title' };
  const admin = supabaseAdmin();

  if (!input.force) {
    let q = admin.from('tasks').select('id,title,owner,due,waiting_for').eq('status', 'open');
    q = input.projectId ? q.eq('project_id', input.projectId) : q.is('project_id', null);
    const { data: open } = await q;
    const duplicates: DuplicateCandidate[] = ((open ?? []) as DuplicateCandidate[])
      .map((t) => ({ t, score: similarity(title, t.title) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.t);
    if (duplicates.length > 0) return { duplicates };
  }

  const { data, error } = await admin.from('tasks').insert({
    project_id: input.projectId,
    title,
    owner: input.owner?.trim() || null,
    due: input.due || null,
    waiting_for: input.waitingFor?.trim() || null,
    source: 'manual',
    planned: true,
  }).select('id').single();
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: data.id, actor: user.email ?? user.id,
    action: input.force ? 'create_despite_similar' : 'create',
    after: { title, owner: input.owner ?? null, due: input.due ?? null },
  });
  revalidatePath('/work');
  revalidatePath('/');
  return { ok: true, id: data.id };
}

// "Same task" resolution for the duplicate dialog: no new record — the
// existing one is touched and the confirmation lands in the audit trail.
export async function confirmExistingTask(taskId: string, attemptedTitle: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'dedup_confirmed', after: { attempted_title: attemptedTitle },
  });
  revalidatePath('/work');
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
