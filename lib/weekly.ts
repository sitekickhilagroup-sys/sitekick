// Weekly review helpers. nextMonday is date arithmetic on an LA-calendar
// string (not a new "today" source — callers pass laToday()).
import type { Task, TaskStatus, WeeklyReviewItem } from './types.ts';

// Every named, deterministic error app/actions/weekly.ts's actions can
// return, mirrored after lib/invoice-rules.ts's INVOICE_ERRORS — so a Hebrew
// UI can map a known reason to a real translated string (see
// components/weekly/review-board.tsx's weeklyErrorMessage) instead of
// surfacing raw English. An unexpected DB error (arbitrary Postgres text) has
// no fixed translation and still falls back to an interpolated generic
// message, same as invoices.error_save_reason elsewhere in this codebase.
export const WEEKLY_ERRORS = {
  reviewFinalized: 'review is finalized',
  itemNotFound: 'item not found',
  invalidVerb: 'invalid verb',
  invalidStatus: 'invalid status',
  reviewNotFound: 'review not found',
  // C2 — pre-0016, 'final' is not yet a valid weekly_review_status enum
  // value: prepareCurrentReview's own .in('status', ['saved','final']) lookup
  // for a prior review to carry forward from fails with Postgres 22P02
  // (invalid_text_representation) before any row is read. Named the same way
  // createInvoice names its own migration-pending case (INVOICE_ERRORS.
  // migrationPending), so the owner sees what to actually do instead of a
  // raw Postgres internal.
  migrationPending: 'the review status column does not accept "final" yet — migration 0016 needs to be applied first',
} as const;

export function nextMonday(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const add = (8 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/** Shared by prepareCurrentReview (bulk, over every project_stages row) and
 *  syncTaskIntoOpenReview (app/actions/weekly.ts; same query, one task at a
 *  time) so the first-stage_key-wins tie-break can't drift between the two
 *  call sites. */
export function buildStageLabelMap(rows: { stage_key: string; label: string }[]): Map<string, string> {
  const stageLabels = new Map<string, string>();
  for (const row of rows) {
    if (!stageLabels.has(row.stage_key)) stageLabels.set(row.stage_key, row.label);
  }
  return stageLabels;
}

/**
 * D1 review-code review: the single definition of "can this review still be
 * written to." Before this, 'final' was hard-coded as a string in six
 * separate places across app/actions/weekly.ts, which is exactly how a
 * status check can quietly miss a spot — this is the one place that list
 * lives now, and every one of those six sites routes through this instead
 * of repeating the literal, including finalizeReview/reopenReview's own
 * idempotency checks: "already final, nothing to finalize" and "not yet
 * final, nothing to reopen" are both just this predicate read in the
 * direction each action needs (proceed when NOT editable is the "unlock"
 * direction reopenReview needs; proceed when editable is the direction
 * finalizeReview and every write-gate need). The one exception is
 * prepareCurrentReview's prior-review lookup, which is a materially
 * different question ("has this review settled enough to carry FROM") and
 * deliberately keeps its own explicit status list — see the comment there.
 *
 * Takes a plain `string`, not `WeeklyReviewStatus`, on purpose: values
 * arriving from Supabase in this codebase aren't schema-typed, so a status
 * this function has never heard of is a real runtime possibility (a future
 * status added to the enum before this function is updated for it, bad
 * data, whatever) — not just a type-checker abstraction. That case defaults
 * to **not editable** (fail closed): treating an unrecognized status as
 * "safe to write to" is the wrong default for a lock whose entire job is to
 * stop unwanted writes; treating it as locked-until-proven-otherwise is the
 * safe one, even at the cost of occasionally blocking a legitimate edit
 * under a status nobody had taught this function about yet. One
 * consequence worth naming: since reopenReview proceeds whenever
 * `!isReviewEditable(status)`, an unrecognized status is reopenable, not
 * just 'final' is — deliberate, not an oversight. Fail-closed already
 * treats an unknown status as locked everywhere else (no item writes, no
 * re-finalizing over it); letting Reopen unlock it back to 'preparing' is
 * the one place that "locked" gets an escape hatch, and it's a strictly
 * safer direction to err in than the reverse (an unknown status silently
 * accepting writes).
 */
const EDITABLE_REVIEW_STATUSES: readonly string[] = ['preparing', 'saved'];
export function isReviewEditable(status: string): boolean {
  return EDITABLE_REVIEW_STATUSES.includes(status);
}

/**
 * A task under no project (General) always belongs on the review; a task
 * under a project explicitly marked inactive (0007_alignment.sql) never
 * does — "a closed project kept turning up in the Monday agenda" is exactly
 * the bug that column was added to fix (see prepareCurrentReview). Shared
 * between prepare's bulk per-task filter and syncTaskIntoOpenReview's
 * single-project lookup so the rule has one definition, not two that can
 * drift — a second, forgotten copy is exactly how the sync path shipped
 * without this gate the first time.
 */
export function isProjectEligibleForReview(projectId: string | null, projectActive: boolean | null): boolean {
  return !projectId || projectActive !== false;
}

export interface ReviewEligibilityInput {
  status: TaskStatus;
  projectId: string | null;
  /** The task's project's `active` flag, or null when it has no project /
   *  the project's active-ness is unknown. */
  projectActive: boolean | null;
  /** Whether this task already has a row on the target review. */
  alreadyOnReview: boolean;
}

/**
 * The full guard syncTaskIntoOpenReview applies before inserting a task
 * onto the currently-open review: only an 'open' task, only on an active
 * project (or none), and only once. Factored into one pure function so
 * every condition — and their combinations — is directly testable; the
 * missing projects.active leg of this is exactly what let a task under an
 * inactive project resurrect onto a live review before a code review
 * caught it.
 */
export function isTaskEligibleForOpenReview(input: ReviewEligibilityInput): boolean {
  if (input.alreadyOnReview) return false;
  if (input.status !== 'open') return false;
  return isProjectEligibleForReview(input.projectId, input.projectActive);
}

export interface ReviewItemDraft {
  task_id: string;
  project_id: string | null;
  subtopic: string | null;
  status_snapshot: string;
  weekly_note: string | null;
  /** D2: carried forward same as weekly_note — last week's planned next step
   *  is exactly the context this week's meeting needs, same reasoning that
   *  already applies to the note (see the carry loop below). */
  next_step: string | null;
  sequence: number;
  carried_from: string | null;
}

export function buildReviewItems(input: {
  openTasks: Task[]; doneSinceTasks: Task[]; priorItems: WeeklyReviewItem[]; stageLabels: Map<string, string>;
}): ReviewItemDraft[] {
  const current = new Map<string, Task>();
  for (const t of [...input.openTasks, ...input.doneSinceTasks]) current.set(t.id, t);
  const closedThisWeek = new Set(input.doneSinceTasks.map((t) => t.id));
  const out: ReviewItemDraft[] = [];
  const seen = new Set<string>();
  let seq = 0;

  const subtopicFor = (task: Task | undefined, fallback: string | null) =>
    (task?.stage_key ? input.stageLabels.get(task.stage_key) : undefined) ?? fallback;

  for (const prior of [...input.priorItems].sort((a, b) => a.sequence - b.sequence)) {
    const task = current.get(prior.task_id);
    const status = task?.status ?? prior.status_snapshot;
    // Only open work carries. Something closed in an earlier review stays in
    // that review's history rather than following the team forward every week
    // — but work closed *since* the last review belongs in this one, shown as
    // completed, which is the half that was missing entirely.
    if (status !== 'open' && !closedThisWeek.has(prior.task_id)) continue;

    seen.add(prior.task_id);
    out.push({
      task_id: prior.task_id,
      project_id: task?.project_id ?? prior.project_id,
      subtopic: subtopicFor(task, prior.subtopic),
      status_snapshot: status,
      // Last week's note is the context the meeting runs on. It was being
      // dropped on every carry.
      weekly_note: prior.weekly_note,
      next_step: prior.next_step,
      sequence: ++seq,
      carried_from: prior.id,
    });
  }

  // New open work, then anything completed since the last review that was never
  // on it — this loop covered openTasks only, so those completions vanished.
  for (const t of [...input.openTasks, ...input.doneSinceTasks]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      task_id: t.id,
      project_id: t.project_id,
      subtopic: subtopicFor(t, null),
      status_snapshot: t.status,
      weekly_note: null,
      next_step: null,
      sequence: ++seq,
      carried_from: null,
    });
  }
  return out;
}
