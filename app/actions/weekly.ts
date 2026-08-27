'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import {
  buildReviewItems, buildStageLabelMap, isProjectEligibleForReview, isReviewEditable, isTaskEligibleForOpenReview,
  nextMonday, WEEKLY_ERRORS,
} from '@/lib/weekly';
import { buildDetailsPatch, type TaskDetailsPatch } from '@/lib/task-details';
import { verbToPatch } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';
import type { Task, TaskPriority, WeeklyReviewItem } from '@/lib/types';

type ReviewVerb = 'completed' | 'not_applicable' | 'sent_email';
const REVIEW_VERBS: ReviewVerb[] = ['completed', 'not_applicable', 'sent_email'];

/**
 * Common shape for the item/review mutating actions below. The `ok?:
 * undefined` / `error?: undefined` companions are deliberate, not filler:
 * TypeScript only synthesizes them itself when a return type is left to
 * plain inference from fresh `{ error }` / `{ ok: true }` object literals —
 * the moment one branch instead returns an already-typed value (here,
 * `loadEditableReviewItem`'s `gate` on its error path), that synthesis stops
 * applying and `res?.error` at the call site fails to typecheck (`.error`
 * doesn't exist on the `{ ok: true }` branch). Writing both companions out
 * explicitly gets the same "either key is safe to probe" shape without
 * depending on that inference quirk.
 */
type ActionResult = { error: string; ok?: undefined } | { ok: true; error?: undefined };

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
    .select('id,status')
    .eq('meeting_date', meetingDate)
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  // D1: this week's review already exists and is locked. The Prepare button
  // itself can never reach this — page.tsx only renders it when no review
  // row exists yet for meetingDate, and once one exists (any status) the
  // page swaps to ReviewBoard — but this is still a Server Action a browser
  // can call directly, so the same-day case (finalized this morning, someone
  // retries prepare this afternoon) needs a real server-side stop, not just
  // an absent button. Returning ok rather than an error: from the caller's
  // side "this week is already done" isn't a failure. The `existingReview &&`
  // guard matters: when no review exists yet, `existingReview` is null and
  // this must fall through to create one, not read a nonexistent `.status`.
  if (existingReview && !isReviewEditable(existingReview.status)) {
    return { ok: true, reviewId: existingReview.id };
  }

  // 'final' counts as prior too — a finalized review is a *stronger* form of
  // saved, not a review that stops existing for carry-forward purposes.
  // Without 'final' here, the week after any finalize would find no prior
  // review at all (status stays 'final', never reverts to 'saved') and
  // silently lose every open item, note and sub-topic context that should
  // have carried forward. 'preparing' is deliberately still excluded — an
  // unsaved draft was never treated as a legitimate prior review before D1
  // either. NOT the same list as isReviewEditable's — this is "has this
  // review reached a state settled enough to carry FROM" (saved or final),
  // the near-opposite of "can still be written TO" (preparing or saved) —
  // so it stays its own explicit .in(), not routed through that predicate.
  const { data: priorReview, error: priorError } = await admin
    .from('weekly_reviews')
    .select('id,meeting_date')
    .in('status', ['saved', 'final'])
    .order('meeting_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorError) {
    // C2: pre-0016, 'final' isn't a valid enum value yet, so Postgres rejects
    // the .in() filter above with 22P02 before a single row is read — named
    // the same way createInvoice names its own migration-pending case (see
    // WEEKLY_ERRORS.migrationPending), so the caller can show what to
    // actually do instead of a raw Postgres internal.
    if (priorError.code === '22P02') return { error: WEEKLY_ERRORS.migrationPending };
    return { error: priorError.message };
  }

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
  const activeByProject = new Map(
    ((projectRows ?? []) as { id: string; active: boolean | null }[]).map((p) => [p.id, p.active]),
  );
  // Same predicate syncTaskIntoOpenReview uses, so the active-project rule
  // can't drift between the two paths that populate this table.
  const onActiveProject = (t: Task) =>
    isProjectEligibleForReview(t.project_id, t.project_id ? (activeByProject.get(t.project_id) ?? null) : null);

  const openTasks = ((openTasksData ?? []) as Task[]).filter(onActiveProject);
  doneSinceTasks = doneSinceTasks.filter(onActiveProject);

  const { data: stagesData, error: stagesError } = await admin.from('project_stages').select('stage_key,label');
  if (stagesError) return { error: stagesError.message };
  const stageLabels = buildStageLabelMap((stagesData ?? []) as { stage_key: string; label: string }[]);

  const drafts = buildReviewItems({ openTasks, doneSinceTasks, priorItems, stageLabels });

  // Notes survive re-preparing. A draft now carries the previous review's note
  // forward, but a note already saved against *this* review is newer, so it
  // wins over the carried one before the upsert overwrites anything. Same
  // rule for next_step (D2) — re-running prepare mid-week to pick up a newly
  // added task must not clobber a next_step someone already typed this week.
  const { data: existingItemsData, error: existingItemsError } = await admin
    .from('weekly_review_items')
    .select('task_id,weekly_note,next_step')
    .eq('weekly_review_id', reviewId);
  if (existingItemsError) return { error: existingItemsError.message };
  const existingNotes = new Map<string, string>();
  const existingNextSteps = new Map<string, string>();
  for (const row of (existingItemsData ?? []) as { task_id: string; weekly_note: string | null; next_step: string | null }[]) {
    if (row.weekly_note) existingNotes.set(row.task_id, row.weekly_note);
    if (row.next_step) existingNextSteps.set(row.task_id, row.next_step);
  }

  const items = drafts.map((d) => ({
    ...d,
    weekly_review_id: reviewId,
    weekly_note: existingNotes.get(d.task_id) ?? d.weekly_note,
    next_step: existingNextSteps.get(d.task_id) ?? d.next_step,
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
 * Targets whichever review is still open for editing today (isReviewEditable
 * — 'preparing' or 'saved'). Fetches the *newest* review unconditionally and
 * then checks editability, rather than filtering the query itself to
 * editable statuses: a filtered query conflates "no open review exists"
 * with "the open review isn't the newest one" — those used to be the same
 * thing, but once a review can reach 'final' (D1) they aren't. A finalized
 * review used to make the filtered query skip straight past it to the next
 * most recent 'saved' review — a genuinely older, already-wrapped-up
 * meeting's row — and silently append this week's task edit onto *that*
 * review instead of correctly finding nothing to sync into. "There is no
 * open review right now" must be a no-op, never "fall back to an older
 * one." Save is a checkpoint, not a lock (review-board.tsx: "stays enabled
 * after saving so a review can be saved again during the meeting"), so a
 * review someone has already saved once must still accept a task edited
 * afterward, or this reintroduces a narrower version of the exact bug A7
 * exists to fix.
 *
 * Also applies the same projects.active gate prepareCurrentReview enforces
 * (isProjectEligibleForReview / 0007) — without it, a leftover open task
 * under an inactive project (e.g. Flicker) would resurrect onto a live
 * review the moment someone touched it, reintroducing the exact bug
 * `onActiveProject` was written to fix.
 *
 * Idempotent: the existing-item check short-circuits the common case (a
 * task's 2nd, 3rd, ... write this week), and the upsert's onConflict +
 * ignoreDuplicates is the race-safe backstop — two near-simultaneous writes
 * for the same never-yet-synced task can't produce two rows.
 *
 * Never throws away failures: it throws through the real ones (a failed
 * insert) so a wrapping try/catch at the call site can log them, per the
 * project's silent-failure rule — but a review that's missing, or already
 * has the item, or an ineligible task are legitimate no-ops, not failures.
 */
export async function syncTaskIntoOpenReview(admin: SupabaseClient, taskId: string): Promise<void> {
  const { data: review } = await admin
    .from('weekly_reviews')
    .select('id,status')
    .order('meeting_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!review || !isReviewEditable(review.status)) return;

  // One read covers "already on the review" and "next sequence" from the
  // same consistent snapshot, rather than two separate reads that could
  // each observe a different concurrent state.
  const { data: itemsData } = await admin
    .from('weekly_review_items')
    .select('task_id,sequence')
    .eq('weekly_review_id', review.id);
  const items = (itemsData ?? []) as { task_id: string; sequence: number }[];
  if (items.some((i) => i.task_id === taskId)) return;

  const { data: taskRow } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  const task = taskRow as Task | null;
  if (!task) return;

  let projectActive: boolean | null = null;
  if (task.project_id) {
    const { data: projectRow } = await admin.from('projects').select('active').eq('id', task.project_id).maybeSingle();
    projectActive = (projectRow as { active: boolean | null } | null)?.active ?? null;
  }
  // alreadyOnReview is always false here — the items.some() check above
  // already returned on that case, so this only re-checks status + project.
  if (!isTaskEligibleForOpenReview({
    status: task.status, projectId: task.project_id, projectActive, alreadyOnReview: false,
  })) return;

  // Same stage_key -> label lookup prepareCurrentReview builds, unfiltered
  // across projects — matching it exactly (rather than scoping to this
  // task's own project) is what keeps a synced subtopic identical to what
  // the next real prepare would compute for the same task.
  const { data: stagesData } = await admin.from('project_stages').select('stage_key,label');
  const stageLabels = buildStageLabelMap((stagesData ?? []) as { stage_key: string; label: string }[]);

  // Append after whatever is already on the review — never renumber
  // existing rows, since sequence also drives which project/sub-topic group
  // renders first on the page. (Read-max-then-increment, same as any other
  // read-modify-write in this codebase; two concurrent syncs of two
  // different tasks on the same review could in principle land on the same
  // number — cosmetic tie in display order, not a duplicate row, since
  // task_id uniqueness is what the upsert's onConflict actually guards.)
  const sequence = items.reduce((max, i) => Math.max(max, i.sequence), 0) + 1;

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
    next_step: draft.next_step,
    sequence,
    carried_from: draft.carried_from,
  }, { onConflict: 'weekly_review_id,task_id', ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * D1: the actual server-side gate — fetches the review's status fresh from
 * `reviewId` on every call, never trusted from anything a client passes.
 * This is the one place in the file that calls isReviewEditable to decide
 * "can this review still be written to."
 *
 * Scope: gates weekly_review_items writes (note, next_step, status_snapshot)
 * via loadEditableReviewItem below, the owner/due edit that rides along
 * with them, and saveSubtopicContext directly (the sub-topic narrative is
 * part of the meeting record too — prepareCurrentReview carries it forward
 * the same way it carries items, see "Carry sub-topic context paragraphs
 * forward" further up). attachRecording stays ungated deliberately: it's
 * normally uploaded *after* the meeting, i.e. after finalize, so locking it
 * would force a Reopen just to attach a file.
 */
async function assertReviewEditable(admin: SupabaseClient, reviewId: string): Promise<{ error: string } | { ok: true }> {
  const { data: review, error: reviewError } = await admin
    .from('weekly_reviews').select('status').eq('id', reviewId).maybeSingle();
  if (reviewError) return { error: reviewError.message };
  if (!review || !isReviewEditable(review.status)) return { error: WEEKLY_ERRORS.reviewFinalized };
  return { ok: true };
}

/**
 * Item-scoped wrapper around assertReviewEditable: looks the item up by
 * itemId, then gates on its parent review — a disabled <input> is a UI
 * nicety, not a guarantee, since every item-mutating action here is a
 * Server Action a signed-in browser can call directly with any itemId.
 * Returns the item row itself (not just a boolean) so callers that need
 * task_id or the current field values don't have to re-query it.
 */
async function loadEditableReviewItem(
  admin: SupabaseClient, itemId: string,
): Promise<{ error: string } | { ok: true; item: WeeklyReviewItem }> {
  const { data: item, error: itemError } = await admin
    .from('weekly_review_items').select('*').eq('id', itemId).maybeSingle();
  if (itemError) return { error: itemError.message };
  if (!item) return { error: WEEKLY_ERRORS.itemNotFound };
  const row = item as WeeklyReviewItem;
  const gate = await assertReviewEditable(admin, row.weekly_review_id);
  if ('error' in gate) return gate;
  return { ok: true, item: row };
}

// D2: now also accepts next_step, rather than a parallel action — each
// field saves independently on its own textarea's onBlur, so a patch only
// ever carries the one key that just blurred and the two can never clobber
// each other. Gated the same way status/snapshot are (D1) — see
// loadEditableReviewItem.
export async function saveItemNote(itemId: string, patch: { weekly_note?: string; next_step?: string }): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const gate = await loadEditableReviewItem(admin, itemId);
  if ('error' in gate) return gate;

  const update: Record<string, string | null> = {};
  if ('weekly_note' in patch) update.weekly_note = (patch.weekly_note ?? '').trim() || null;
  if ('next_step' in patch) update.next_step = (patch.next_step ?? '').trim() || null;
  if (Object.keys(update).length === 0) return { ok: true };

  const { error } = await admin.from('weekly_review_items').update(update).eq('id', itemId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review_item', entity_id: itemId, actor: user.email ?? user.id,
    action: 'next_step' in patch ? 'next_step' : 'note', after: update,
  });
  revalidatePath('/weekly');
  return { ok: true };
}

/**
 * D2: Owner + Due edited inline from the review, Sunday-mode only (see
 * `editableOwnerDue` in review-board.tsx for why). Both live on the
 * canonical task — the same columns task-editor.tsx's "Edit details" form
 * writes, not on the review item — so this is a real task mutation and gets
 * applyWorkVerb's audited snapshot-before/update/logActivity pattern, never
 * a bare .update() the way a review-only field would.
 *
 * Shaping and validation go through buildDetailsPatch (lib/task-details.ts)
 * rather than a second, inline owner/due whitelist + date regex — that
 * function already whitelists exactly this field set (it takes any subset
 * of TaskDetailsPatch, so passing only owner/due naturally clean-patches
 * only those two) and is already exported, tested, and used by
 * app/actions/tasks.ts's updateTaskDetails. One definition of "what a date
 * field is allowed to look like," not two that could drift.
 */
export async function saveItemOwnerDue(itemId: string, patch: { owner?: string; due?: string }): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const gate = await loadEditableReviewItem(admin, itemId);
  if ('error' in gate) return gate;
  const taskId = gate.item.task_id;

  // buildDetailsPatch itself doesn't trim/null-coalesce (task-editor.tsx
  // does that client-side, before calling the server) — do the same
  // normalization here, since this server action receives the raw
  // onBlur value directly.
  const input: TaskDetailsPatch = {};
  if ('owner' in patch) input.owner = (patch.owner ?? '').trim() || null;
  if ('due' in patch) input.due = (patch.due ?? '').trim() || null;
  const built = buildDetailsPatch(input);
  if ('error' in built) return built;

  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  const { error } = await admin.from('tasks').update({ ...built.clean, last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'weekly:owner_due', before, after: built.clean,
  });
  revalidatePath('/weekly'); revalidatePath('/'); revalidatePath('/work'); revalidatePath('/projects/[id]', 'page');
  return { ok: true };
}

// Verb applies to the canonical task (spec: updates propagate everywhere —
// same tasks row /work reads), then the review row snapshots the result.
//
// Re-review authorization fix: taskId used to be trusted straight from the
// caller and used as the write target. loadEditableReviewItem only proves
// itemId belongs to a review still open for editing — it says nothing about
// whether the taskId a caller *also* passed actually belongs to that item.
// A signed-in browser can call this Server Action directly with any two
// ids, so without deriving the real target from the gated item itself, a
// valid itemId on an editable review could mark an UNRELATED, never-gated
// task done — audited, but against a task the gate never checked, while the
// review item snapshots a status for a task that was never touched.
// saveItemOwnerDue (above) already gets this right (`const taskId =
// gate.item.task_id`) — this now matches it. The logic lives in
// setItemStatusForAdmin so it's callable with a fake admin/actor in tests,
// the same shape this file's own syncTaskIntoOpenReview and lib/ingest.ts's
// ingestDocument already use for the same reason.
export async function setItemStatus(itemId: string, taskId: string, verb: ReviewVerb): Promise<ActionResult> {
  const user = await requireUser();
  const res = await setItemStatusForAdmin(supabaseAdmin(), user.email ?? user.id, itemId, taskId, verb);
  // revalidatePath (like requireUser above) needs a real Next.js request
  // context that only exists for the exported Server Action, not for
  // setItemStatusForAdmin's own fake-admin tests — kept here for that
  // reason, gated on success the same way the inline version was (every
  // error branch below returns before this point either way).
  if ('ok' in res && res.ok) { revalidatePath('/weekly'); revalidatePath('/'); revalidatePath('/work'); }
  return res;
}

export async function setItemStatusForAdmin(
  admin: SupabaseClient, actor: string, itemId: string, taskId: string, verb: ReviewVerb,
): Promise<ActionResult> {
  if (!REVIEW_VERBS.includes(verb)) return { error: WEEKLY_ERRORS.invalidVerb };
  const mapped = verbToPatch(verb, null, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const gate = await loadEditableReviewItem(admin, itemId);
  if ('error' in gate) return gate;
  // The gated item's own task_id is the only id ever written to below —
  // taskId is compared only to flag a caller sending a mismatched pair (a
  // bug, or a probe), never used to pick the write target.
  if (taskId !== gate.item.task_id) {
    console.error('[setItemStatus] taskId did not match the gated item\'s own task_id — using the gated one, ignoring the supplied one', {
      itemId, suppliedTaskId: taskId, actualTaskId: gate.item.task_id,
    });
  }
  const gatedTaskId = gate.item.task_id;
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', gatedTaskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: gatedTaskId, actor,
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

  return { ok: true };
}

// Sub-topic context paragraph (0006): the narrative shown above a sub-topic's
// actions. Manual input is first-class — select-then-write keeps the null-safe
// unique index happy without relying on upsert against an expression index.
// D1: gated the same way item inputs are — this text is part of the meeting
// record (carried forward at "Carry sub-topic context paragraphs forward"
// above, same as items) and was the one write in this file that could still
// land on a finalized review. Also now snapshots `before`, matching every
// other material write in this file — an overwrite of meeting-record text
// with no `before` would be unauditable and unundoable.
export async function saveSubtopicContext(
  reviewId: string, projectId: string | null, subtopic: string, context: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const gate = await assertReviewEditable(admin, reviewId);
  if ('error' in gate) return gate;

  const trimmed = context.trim() || null;
  let query = admin
    .from('weekly_review_subtopics')
    .select('id,context')
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
    action: 'subtopic_context',
    before: { context: existing?.context ?? null },
    after: { subtopic, context: trimmed },
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

export async function setItemSnapshot(itemId: string, snapshot: SnapshotState): Promise<ActionResult> {
  const user = await requireUser();
  if (!SNAPSHOT_STATES.includes(snapshot)) return { error: WEEKLY_ERRORS.invalidStatus };
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;

  // D1: reuses the same finalized-review gate note/next_step/status share —
  // and since it already has to fetch the item to check the review's
  // status, that row's task_id/status_snapshot replace the two-column
  // select this used to run on its own.
  const gate = await loadEditableReviewItem(admin, itemId);
  if ('error' in gate) return gate;
  const itemRow = gate.item;

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

export async function saveReview(reviewId: string): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: current, error: currentError } = await admin
    .from('weekly_reviews').select('status').eq('id', reviewId).maybeSingle();
  if (currentError) return { error: currentError.message };
  // D1: Save is a checkpoint, never a lock (review-board.tsx: "stays enabled
  // after saving so a review can be saved again during the meeting") — but it
  // must also never be a silent *downgrade*. Without this guard, clicking
  // Save after Finalize would flip status back to 'saved' while finalized_at
  // stays set, corrupting the exact state Reopen exists to change on
  // purpose. The UI already stops offering Save once final (ReviewControls
  // swaps it for the Finalized badge + Reopen); this is the server-side half
  // of that, for the same reason every other finalized-state guard here is
  // server-side.
  if (current && !isReviewEditable(current.status)) return { ok: true };
  const { error } = await admin.from('weekly_reviews').update({ status: 'saved' }).eq('id', reviewId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'save_review', after: { status: 'saved' },
  });
  revalidatePath('/weekly'); revalidatePath('/');
  return { ok: true };
}

export async function attachRecording(reviewId: string, documentId: string): Promise<ActionResult> {
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

/**
 * D1: locks a review as the meeting record. Distinct from saveReview on
 * purpose — the checklist requires Save to stay a draft-only action and
 * Finalize to be the one control that actually locks. Audited with a full
 * `before` snapshot (applyWorkVerb's pattern), even though only status/
 * finalized_at change, so undo tooling elsewhere that expects a full-row
 * before_json keeps working uniformly across entity types.
 *
 * Idempotent: finalizing an already-final review is a no-op success rather
 * than an error — matches syncTaskIntoOpenReview's existing-item short
 * circuit elsewhere in this file — since the only way the UI could call this
 * twice is a double-click race the disabled-while-pending button mostly
 * prevents anyway.
 */
export async function finalizeReview(reviewId: string): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before, error: beforeError } = await admin
    .from('weekly_reviews').select('*').eq('id', reviewId).maybeSingle();
  if (beforeError) return { error: beforeError.message };
  if (!before) return { error: WEEKLY_ERRORS.reviewNotFound };
  if (!isReviewEditable(before.status)) return { ok: true };

  const finalized_at = new Date().toISOString();
  const { error } = await admin
    .from('weekly_reviews')
    .update({ status: 'final', finalized_at })
    .eq('id', reviewId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'finalize', before, after: { status: 'final', finalized_at },
  });
  revalidatePath('/weekly'); revalidatePath('/');
  return { ok: true };
}

/** D1: reverses finalizeReview — back to 'preparing' (not 'saved': Reopen is
 *  "start editing again," not "pretend it was only ever saved"), and clears
 *  finalized_at so the badge disappears. Audited and idempotent the same way
 *  finalizeReview is. */
export async function reopenReview(reviewId: string): Promise<ActionResult> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before, error: beforeError } = await admin
    .from('weekly_reviews').select('*').eq('id', reviewId).maybeSingle();
  if (beforeError) return { error: beforeError.message };
  if (!before) return { error: WEEKLY_ERRORS.reviewNotFound };
  if (isReviewEditable(before.status)) return { ok: true };

  const { error } = await admin
    .from('weekly_reviews')
    .update({ status: 'preparing', finalized_at: null })
    .eq('id', reviewId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'weekly_review', entity_id: reviewId, actor: user.email ?? user.id,
    action: 'reopen', before, after: { status: 'preparing', finalized_at: null },
  });
  revalidatePath('/weekly'); revalidatePath('/');
  return { ok: true };
}
