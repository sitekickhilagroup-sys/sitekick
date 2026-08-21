'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { buildReviewItems, nextMonday } from '@/lib/weekly';
import { verbToPatch } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';
import type { Task, WeeklyReviewItem } from '@/lib/types';

type ReviewVerb = 'completed' | 'not_applicable' | 'sent_email';
const REVIEW_VERBS: ReviewVerb[] = ['completed', 'not_applicable', 'sent_email'];

// Sunday prep: reuse-or-create this week's review row, then recompute its
// items from the prior saved review + current task state (carry-forward
// rule lives in buildReviewItems). Re-running this (idempotent) must not
// clobber notes a user already typed against this week's row.
export async function prepareCurrentReview(): Promise<{ ok: true; reviewId: string } | { error: string }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const meetingDate = nextMonday(laToday());

  const { data: existingReview, error: existingError } = await admin
    .from('weekly_reviews')
    .select('id')
    .eq('meeting_date', meetingDate)
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  const { data: priorReview, error: priorError } = await admin
    .from('weekly_reviews')
    .select('id,meeting_date')
    .eq('status', 'saved')
    .order('meeting_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorError) return { error: priorError.message };

  let reviewId: string;
  if (existingReview) {
    reviewId = existingReview.id;
  } else {
    const { data: inserted, error: insertError } = await admin
      .from('weekly_reviews')
      .insert({ meeting_date: meetingDate, source_review_id: priorReview?.id ?? null })
      .select('id')
      .single();
    if (insertError) return { error: insertError.message };
    reviewId = inserted.id;
  }

  let priorItems: WeeklyReviewItem[] = [];
  let doneSinceTasks: Task[] = [];
  if (priorReview) {
    const { data: priorItemsData, error: priorItemsError } = await admin
      .from('weekly_review_items')
      .select('*')
      .eq('weekly_review_id', priorReview.id);
    if (priorItemsError) return { error: priorItemsError.message };
    priorItems = (priorItemsData ?? []) as WeeklyReviewItem[];

    const { data: doneSinceData, error: doneSinceError } = await admin
      .from('tasks')
      .select('*')
      .eq('status', 'done')
      .gte('last_touched', priorReview.meeting_date);
    if (doneSinceError) return { error: doneSinceError.message };
    doneSinceTasks = (doneSinceData ?? []) as Task[];
  }

  const { data: openTasksData, error: openTasksError } = await admin.from('tasks').select('*').eq('status', 'open');
  if (openTasksError) return { error: openTasksError.message };
  const openTasks = (openTasksData ?? []) as Task[];

  const { data: stagesData, error: stagesError } = await admin.from('project_stages').select('stage_key,label');
  if (stagesError) return { error: stagesError.message };
  const stageLabels = new Map<string, string>();
  for (const row of (stagesData ?? []) as { stage_key: string; label: string }[]) {
    if (!stageLabels.has(row.stage_key)) stageLabels.set(row.stage_key, row.label);
  }

  const drafts = buildReviewItems({ openTasks, doneSinceTasks, priorItems, stageLabels });

  // Notes survive re-preparing: buildReviewItems always starts weekly_note
  // fresh (null), so anything already saved against this review's rows has
  // to be re-merged in before the upsert overwrites them.
  const { data: existingItemsData, error: existingItemsError } = await admin
    .from('weekly_review_items')
    .select('task_id,weekly_note')
    .eq('weekly_review_id', reviewId);
  if (existingItemsError) return { error: existingItemsError.message };
  const existingNotes = new Map<string, string>();
  for (const row of (existingItemsData ?? []) as { task_id: string; weekly_note: string | null }[]) {
    if (row.weekly_note) existingNotes.set(row.task_id, row.weekly_note);
  }

  const items = drafts.map((d) => ({
    ...d,
    weekly_review_id: reviewId,
    weekly_note: existingNotes.get(d.task_id) ?? d.weekly_note,
  }));

  const { error: upsertError } = await admin
    .from('weekly_review_items')
    .upsert(items, { onConflict: 'weekly_review_id,task_id' });
  if (upsertError) return { error: upsertError.message };

  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'prepare', after: { meeting_date: meetingDate, item_count: items.length },
  });

  revalidatePath('/weekly');
  return { ok: true, reviewId };
}

export async function saveItemNote(itemId: string, note: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const weekly_note = note.trim() || null;
  const { error } = await admin.from('weekly_review_items').update({ weekly_note }).eq('id', itemId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review_item', entity_id: itemId, actor: user.email ?? user.id,
    action: 'note', after: { weekly_note },
  });
  revalidatePath('/weekly');
  return { ok: true };
}

// Verb applies to the canonical task (spec: updates propagate everywhere —
// same tasks row /work reads), then the review row snapshots the result.
export async function setItemStatus(itemId: string, taskId: string, verb: ReviewVerb) {
  const user = await requireUser();
  if (!REVIEW_VERBS.includes(verb)) return { error: 'invalid verb' };
  const mapped = verbToPatch(verb, null, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: mapped.action, after: mapped.patch,
  });

  const statusSnapshot = verb === 'completed' ? 'done' : verb === 'not_applicable' ? 'dropped' : null;
  if (statusSnapshot) {
    const { error: itemError } = await admin
      .from('weekly_review_items')
      .update({ status_snapshot: statusSnapshot })
      .eq('id', itemId);
    if (itemError) return { error: itemError.message };
  }

  revalidatePath('/weekly'); revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

export async function saveReview(reviewId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('weekly_reviews').update({ status: 'saved' }).eq('id', reviewId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'save_review', after: { status: 'saved' },
  });
  revalidatePath('/weekly'); revalidatePath('/');
  return { ok: true };
}

export async function attachRecording(reviewId: string, documentId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('weekly_reviews').update({ recording_document_id: documentId }).eq('id', reviewId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'attach_recording', after: { recording_document_id: documentId },
  });
  revalidatePath('/weekly');
  return { ok: true };
}
