'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { buildReviewItems, nextMonday } from '@/lib/weekly';
import { verbToPatch } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';
import type { Task, TaskPriority, WeeklyReviewItem } from '@/lib/types';

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

  // Inactive projects must not enter the review by default. `projects.active`
  // has existed since 0007 and already marks Flicker inactive; this query was
  // simply ignoring it, which is how a closed project kept turning up in the
  // Monday agenda. Unassigned tasks (General) still come through.
  const { data: projectRows, error: projectsError } = await admin.from('projects').select('id,active');
  if (projectsError) return { error: projectsError.message };
  const inactive = new Set(
    ((projectRows ?? []) as { id: string; active: boolean | null }[])
      .filter((p) => p.active === false)
      .map((p) => p.id),
  );
  const onActiveProject = (t: Task) => !t.project_id || !inactive.has(t.project_id);

  const openTasks = ((openTasksData ?? []) as Task[]).filter(onActiveProject);
  doneSinceTasks = doneSinceTasks.filter(onActiveProject);

  const { data: stagesData, error: stagesError } = await admin.from('project_stages').select('stage_key,label');
  if (stagesError) return { error: stagesError.message };
  const stageLabels = new Map<string, string>();
  for (const row of (stagesData ?? []) as { stage_key: string; label: string }[]) {
    if (!stageLabels.has(row.stage_key)) stageLabels.set(row.stage_key, row.label);
  }

  const drafts = buildReviewItems({ openTasks, doneSinceTasks, priorItems, stageLabels });

  // Notes survive re-preparing. A draft now carries the previous review's note
  // forward, but a note already saved against *this* review is newer, so it
  // wins over the carried one before the upsert overwrites anything.
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

  // Carry sub-topic context paragraphs forward (0006) — never clobber ones
  // already written against this week's review. Soft-fail: context is an
  // enhancement, not a reason to break prepare.
  if (priorReview) {
    const { data: priorCtx } = await admin
      .from('weekly_review_subtopics')
      .select('project_id,subtopic,context')
      .eq('weekly_review_id', priorReview.id);
    const { data: curCtx } = await admin
      .from('weekly_review_subtopics')
      .select('project_id,subtopic')
      .eq('weekly_review_id', reviewId);
    const have = new Set((curCtx ?? []).map((r) => `${r.project_id ?? ''}|${r.subtopic}`));
    const toInsert = (priorCtx ?? [])
      .filter((r) => r.context && !have.has(`${r.project_id ?? ''}|${r.subtopic}`))
      .map((r) => ({ weekly_review_id: reviewId, project_id: r.project_id, subtopic: r.subtopic, context: r.context }));
    if (toInsert.length) await admin.from('weekly_review_subtopics').insert(toInsert);
  }

  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'prepare', after: { meeting_date: meetingDate, item_count: items.length },
  });

  revalidatePath('/weekly');
  return { ok: true, reviewId };
}

/**
 * A7 (Dor #56): items otherwise only materialize once, at prepare time — a
 * task created or edited afterwards showed on Project Process / My Work but
 * never on Weekly until someone re-ran prepare. Called from the tail of
 * every write that can put a task into the "should be on this week's review"
 * state: applyWorkVerb, updateTaskDetails, and AddAction's create.
 *
 * Scoped to `status='preparing'` specifically, not "anything not final".
 * 'saved' means the meeting already ran against a fixed list — a task
 * touched afterwards should not silently reappear on a review someone
 * already presented from. D1 later adds a 'final' status for an explicit
 * Finalize action; `.eq('status', 'preparing')` already excludes it (and
 * 'saved') with no change needed here — a negated match like
 * `.neq('status', 'final')` would instead let a 'saved' review keep
 * growing, which is the behavior this scoping deliberately avoids.
 *
 * Idempotent: the existing-item check short-circuits the common case (a
 * task's 2nd, 3rd, ... write this week), and the upsert's onConflict +
 * ignoreDuplicates is the race-safe backstop — two near-simultaneous writes
 * for the same never-yet-synced task can't produce two rows.
 *
 * Never throws away failures: it throws through the real ones (a failed
 * insert) so a wrapping try/catch at the call site can log them, per the
 * project's silent-failure rule — but a review that's missing or already
 * has the item are legitimate no-ops, not failures.
 */
export async function syncTaskIntoOpenReview(admin: SupabaseClient, taskId: string): Promise<void> {
  const { data: review } = await admin
    .from('weekly_reviews')
    .select('id')
    .eq('status', 'preparing')
    .order('meeting_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!review) return;

  const { data: existing } = await admin
    .from('weekly_review_items')
    .select('id')
    .eq('weekly_review_id', review.id)
    .eq('task_id', taskId)
    .maybeSingle();
  if (existing) return;

  const { data: taskRow } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  const task = taskRow as Task | null;
  if (!task || task.status !== 'open') return;

  // Same stage_key -> label lookup prepareCurrentReview builds, unfiltered
  // across projects — matching it exactly (rather than scoping to this
  // task's own project) is what keeps a synced subtopic identical to what
  // the next real prepare would compute for the same task.
  const { data: stagesData } = await admin.from('project_stages').select('stage_key,label');
  const stageLabels = new Map<string, string>();
  for (const row of (stagesData ?? []) as { stage_key: string; label: string }[]) {
    if (!stageLabels.has(row.stage_key)) stageLabels.set(row.stage_key, row.label);
  }

  // Append after whatever is already on the review — never renumber
  // existing rows, since sequence also drives which project/sub-topic group
  // renders first on the page.
  const { data: lastItem } = await admin
    .from('weekly_review_items')
    .select('sequence')
    .eq('weekly_review_id', review.id)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sequence = ((lastItem as { sequence: number } | null)?.sequence ?? 0) + 1;

  // Reuse prepare's own shaping instead of re-deriving it: calling
  // buildReviewItems with this one task as the sole open task, and nothing
  // prior, drives it down the exact "new item" branch prepare takes for a
  // task it has never seen — so the two paths cannot drift apart.
  const [draft] = buildReviewItems({ openTasks: [task], doneSinceTasks: [], priorItems: [], stageLabels });
  if (!draft) return;

  const { error } = await admin.from('weekly_review_items').upsert({
    weekly_review_id: review.id,
    task_id: draft.task_id,
    project_id: draft.project_id,
    subtopic: draft.subtopic,
    status_snapshot: draft.status_snapshot,
    weekly_note: draft.weekly_note,
    sequence,
    carried_from: draft.carried_from,
  }, { onConflict: 'weekly_review_id,task_id', ignoreDuplicates: true });
  if (error) throw error;
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

// Sub-topic context paragraph (0006): the narrative shown above a sub-topic's
// actions. Manual input is first-class — select-then-write keeps the null-safe
// unique index happy without relying on upsert against an expression index.
export async function saveSubtopicContext(
  reviewId: string, projectId: string | null, subtopic: string, context: string,
) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const trimmed = context.trim() || null;
  let query = admin
    .from('weekly_review_subtopics')
    .select('id')
    .eq('weekly_review_id', reviewId)
    .eq('subtopic', subtopic);
  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null);
  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) return { error: findError.message };

  const { error } = existing
    ? await admin.from('weekly_review_subtopics').update({ context: trimmed }).eq('id', existing.id)
    : await admin.from('weekly_review_subtopics').insert({
        weekly_review_id: reviewId, project_id: projectId, subtopic, context: trimmed,
      });
  if (error) return { error: error.message };

  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'subtopic_context', after: { subtopic, context: trimmed },
  });
  revalidatePath('/weekly');
  return { ok: true };
}

// Meeting annotations. These were review-only: they wrote status_snapshot and
// nothing else, so Waiting or Blocked set during a Monday meeting never
// reached My Work or Project Process — the "three different statuses for the
// same task on three screens" the corrections doc calls out.
//
// Blocked and open now write through to the canonical task, because the
// Blocking signal My Work reads is task.priority. Carried and no_update stay
// review-only: they describe the meeting, not the work.
const SNAPSHOT_STATES = ['open', 'carried', 'waiting', 'blocked', 'no_update'] as const;
export type SnapshotState = (typeof SNAPSHOT_STATES)[number];

export async function setItemSnapshot(itemId: string, snapshot: SnapshotState) {
  const user = await requireUser();
  if (!SNAPSHOT_STATES.includes(snapshot)) return { error: 'invalid status' };
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  const { data: itemRow, error: itemError } = await admin
    .from('weekly_review_items').select('task_id,status_snapshot').eq('id', itemId).single();
  if (itemError) return { error: itemError.message };

  const { error } = await admin
    .from('weekly_review_items')
    .update({ status_snapshot: snapshot })
    .eq('id', itemId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review_item', entity_id: itemId, actor,
    action: 'snapshot',
    before: { status_snapshot: itemRow.status_snapshot },
    after: { status_snapshot: snapshot },
  });

  // Propagate to the one canonical record every screen reads.
  if (itemRow.task_id && (snapshot === 'blocked' || snapshot === 'open')) {
    const { data: taskRow } = await admin
      .from('tasks').select('priority,manual_priority').eq('id', itemRow.task_id).maybeSingle();
    const task = taskRow as { priority: TaskPriority; manual_priority: number | null } | null;
    // Noa's manual ranking always wins — the agent and the meeting may inform
    // it, never overwrite it.
    if (task && task.manual_priority === null) {
      const next: TaskPriority = snapshot === 'blocked' ? 'critical' : 'normal';
      if (task.priority !== next) {
        const { error: taskError } = await admin
          .from('tasks').update({ priority: next, last_touched: laToday() }).eq('id', itemRow.task_id);
        if (taskError) return { error: taskError.message };
        await logActivity(admin, {
          entity_type: 'task', entity_id: itemRow.task_id, actor,
          action: `weekly:${snapshot}`,
          before: { priority: task.priority }, after: { priority: next },
        });
      }
    }
  }

  revalidatePath('/weekly'); revalidatePath('/'); revalidatePath('/work'); revalidatePath('/projects');
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
