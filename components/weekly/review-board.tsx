'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  attachRecording, finalizeReview, reopenReview, saveItemNote, saveItemOwnerDue, saveReview, saveSubtopicContext,
  setItemSnapshot, setItemStatus, type SnapshotState,
} from '@/app/actions/weekly';
import { laToday } from '@/lib/date';
import { fmtDate } from '@/lib/format';
import { WEEKLY_ERRORS } from '@/lib/weekly';
import type { WeeklyReview, WeeklyReviewItem } from '@/lib/types';

// Smaller-items fix (whole-branch review): the five named, deterministic
// errors this board's actions can return now map to a real translated
// string, the same way link-editor.tsx maps INVOICE_ERRORS — an unexpected
// DB error (arbitrary Postgres text) still surfaces verbatim, interpolated
// into errorSaveReason, which stays the right call for a reason nobody could
// have pre-translated (see the D4 comment on uploadError below for why
// verbatim-over-generic is this file's deliberate policy for the unknown case).
function weeklyErrorMessage(code: string, labels: Record<string, string>): string {
  switch (code) {
    case WEEKLY_ERRORS.reviewFinalized: return labels.errorReviewFinalized;
    case WEEKLY_ERRORS.itemNotFound: return labels.errorItemNotFound;
    case WEEKLY_ERRORS.invalidVerb: return labels.errorInvalidVerb;
    case WEEKLY_ERRORS.invalidStatus: return labels.errorInvalidStatus;
    case WEEKLY_ERRORS.reviewNotFound: return labels.errorReviewNotFound;
    default: return labels.errorSaveReason ? labels.errorSaveReason.replace('{reason}', code) : code;
  }
}

interface Row { item: WeeklyReviewItem; title: string; owner?: string | null; due?: string | null }
interface SubtopicGroup { name: string; projectId?: string | null; context?: string | null; items: Row[] }
interface ProjectGroup { projectName: string; subtopics: SubtopicGroup[] }

interface Props {
  review: WeeklyReview;
  groups: ProjectGroup[];
  labels: Record<string, string>;
  /** D5: count of state='pending' agent_proposals whose target_task_id is on
   *  this review, computed server-side in page.tsx (agent_proposals has no
   *  weekly_review_id of its own — it is matched by task, same as every
   *  other cross-reference between a review item and its canonical task). */
  pendingProposals: number;
}

// Client-demo structure: mode toggle (Sunday draft = edit, Monday presentation
// = clean read-only), 3-step explainer, save + upload cards, project -> sub-topic
// groups, archive-semantics footer. Spec §יא: each project is an accordion and
// only one opens at a time; Completed rows collapse; status is one dropdown.
export function ReviewBoard({ review, groups, labels, pendingProposals }: Props) {
  const params = useSearchParams();
  // Mode comes from the URL, not component state: it has to survive a refresh,
  // §2 requires it to come from application state, and it lets the header own
  // the control while this board just reads the value.
  const present = params.get('mode') === 'meeting';
  // D1: finalized locks the record for the meeting regardless of which mode
  // (Sunday draft / Monday presentation) the URL happens to be on — it's an
  // orthogonal, stronger axis than present/draft, not a third mode.
  const finalized = review.status === 'final';
  const [openProjects, setOpenProjects] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.projectName)),
  );
  const allItems = groups.flatMap((g) => g.subtopics.flatMap((s) => s.items));
  const doneCount = allItems.filter((r) => r.item.status_snapshot === 'done').length;

  const steps = [
    { t: labels.step1t, d: labels.step1d },
    { t: labels.step2t, d: labels.step2d },
    { t: labels.step3t, d: labels.step3d },
  ];
  // The active stage follows the mode: preparing on Sunday, presenting Monday.
  const activeStep = present ? 2 : 1;

  return (
    <div className="mt-6 space-y-5">
      {/* The mode control lives in the header (spec §2). Progress is derived
          from server data, so switching modes never resets it. */}
      {allItems.length > 0 && labels.progress && (
        <section role="status" className="rounded-[9px] bg-sk-green-dark px-5 py-4">
          <p className="font-mono text-[26px] font-[650] leading-none tabular-nums text-white">
            {doneCount}<span className="text-white/60">/{allItems.length}</span>
          </p>
          <p className="mt-1 text-[10px] text-white/70">{labels.progress.replace('{done}/{total} ', '')}</p>
        </section>
      )}

      {/* Mode context banner (§5): cream while preparing, blue while presenting.
          Same review either way — the copy says so, rather than implying the
          two modes hold different data. */}
      {(present ? labels.modeNoteMeeting : labels.modeNoteDraft) && (
        <p className={`rounded-[10px] border px-4 py-2.5 text-[11px] leading-[1.5] ${
          present ? 'border-sk-blue/30 bg-sk-blue-soft text-sk-blue' : 'border-sk-cream-border bg-sk-cream text-sk-amber'
        }`}>
          {present ? labels.modeNoteMeeting : labels.modeNoteDraft}
        </p>
      )}

      {/* D5: agent_proposals is a real, already-built approval queue (0002 +
          0008, /inbox) — extraction runs on .txt/.docx weekly uploads same as
          any other transcript and writes pending proposals there (.mp4
          recordings are store+link only, no extraction, see the upload card
          below). This surfaces it only when a pending proposal actually
          targets a task on THIS review, rather than a generic "you have
          suggestions somewhere" nag. */}
      {pendingProposals > 0 && labels.proposalsBanner && (
        <p role="status" className="rounded-[10px] border border-apricot/30 bg-apricot-soft px-4 py-2.5 text-[11px] leading-[1.5] text-apricot">
          {labels.proposalsBanner}{' '}
          <Link href="/inbox" className="font-[650] underline underline-offset-2">
            {labels.proposalsBannerLink}
          </Link>
        </p>
      )}

      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className={`rounded-[10px] border p-3 ${
            i === activeStep ? 'border-sage-line bg-sk-green-soft' : 'border-line bg-sk-surface'
          }`}>
            <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">
              <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-full font-mono text-[9px] ${
                i <= activeStep ? 'bg-sage text-white' : 'bg-sk-surface-soft text-sk-muted'
              }`}>{i + 1}</span>
              {s.t}
            </p>
            <p className="mt-1 text-[10px] leading-[1.45] text-sk-text">{s.d}</p>
          </li>
        ))}
      </ol>

      {/* §7 and §16: Save and the upload card stay available in Monday mode.
          They used to disappear entirely when presenting. */}
      <ReviewControls review={review} labels={labels} present={present} finalized={finalized} />

      {groups.length === 0 && labels.noItems && (
        <p className="rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{labels.noItems}</p>
      )}
      {groups.map((group) => {
        const open = openProjects.has(group.projectName);
        const groupRows = group.subtopics.flatMap((s) => s.items);
        const groupDone = groupRows.filter((r) => r.item.status_snapshot === 'done').length;
        const toggle = () => setOpenProjects((prev) => {
          const next = new Set(prev);
          if (next.has(group.projectName)) next.delete(group.projectName);
          else next.add(group.projectName);
          return next;
        });
        return (
          <section key={group.projectName} className="overflow-hidden rounded-[13px] border border-line bg-sk-surface shadow-card">
            <button
              type="button"
              aria-expanded={open}
              onClick={toggle}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-start ${open ? 'border-b-2 border-sage-line' : ''}`}
            >
              <span className="min-w-0 flex-1 text-[13px] font-[650] text-sk-ink">{group.projectName}</span>
              <span className="font-mono text-[10px] text-sk-muted">{groupDone}/{groupRows.length}</span>
              <span aria-hidden="true" className={`inline-block text-sk-muted transition-transform rtl:-scale-x-100 ${open ? 'rotate-90' : ''}`}>▸</span>
            </button>
            {open && (
              <div className="divide-y divide-line2">
                {group.subtopics.map((sub) => (
                  <div key={sub.name} className="px-4 py-3">
                    <p className="flex items-baseline gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">
                      <span>{labels.subTopic ? `${labels.subTopic} · ` : ''}{sub.name}</span>
                      <span className="rounded-[6px] bg-sk-surface-soft px-1.5 py-0.5 font-mono text-[9px] normal-case">
                        {sub.items.length === 1
                          ? (labels.actions1 ?? '1')
                          : (labels.actionsN ?? '{n}').replace('{n}', String(sub.items.length))}
                      </span>
                    </p>
                    <SubtopicContext
                      reviewId={review.id}
                      projectId={sub.projectId ?? null}
                      subtopic={sub.name}
                      value={sub.context ?? null}
                      labels={labels}
                      placeholder={labels.contextPh}
                      finalized={finalized}
                    />
                    {/* §11: display every action. Completed rows used to hide
                        inside a <details>, and the two lists each restarted
                        their numbering at 1 — one continuous counter now. */}
                    <ul className="mt-2 space-y-3">
                      {sub.items.map((row, i) => (
                        <ReviewItemRow key={row.item.id} row={row} index={i + 1} labels={labels} present={present} finalized={finalized} />
                      ))}
                    </ul>
                    {sub.items.length === 0 && labels.noActions && (
                      <p className="mt-2 rounded-[9px] border border-dashed border-line px-4 py-3 text-center text-[10px] text-sk-muted">
                        {labels.noActions}
                      </p>
                    )}
                  </div>
                ))}
                {group.subtopics.length === 0 && labels.noSubtopics && (
                  <p className="px-4 py-3 text-center text-[10px] text-sk-muted">{labels.noSubtopics}</p>
                )}
              </div>
            )}
          </section>
        );
      })}

      {labels.archiveNote && (
        <p className="rounded-(--radius-card) border border-line2 bg-card2 p-4 text-xs leading-relaxed text-ink2">
          {labels.archiveNote}
        </p>
      )}
    </div>
  );
}

// Sub-topic narrative (0006): read as prose; in draft mode a quiet textarea
// saves on blur — same rhythm as the per-item note.
// Editable in both modes: the spec requires Monday to stay live, so there is
// no longer a read-only rendering of this — but D1's finalized lock still
// wins over that: this text is part of the meeting record (it carries
// forward the same way items do), and the server action refuses the write
// regardless of what this <textarea>'s disabled state says, so disabling it
// here isn't optional decoration — see assertReviewEditable in
// app/actions/weekly.ts.
function SubtopicContext({ reviewId, projectId, subtopic, value, labels, placeholder, finalized }: {
  reviewId: string; projectId: string | null; subtopic: string; value: string | null;
  labels: Record<string, string>; placeholder?: string; finalized: boolean;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <div className="mt-1.5">
      {/* §10: pale-green surface with a green rule on the leading edge —
          border-inline-start, not border-left, so Hebrew puts it on the right. */}
      <textarea
        defaultValue={value ?? ''}
        rows={2}
        onBlur={(e) => start(async () => {
          setFailed(null);
          const res = await saveSubtopicContext(reviewId, projectId, subtopic, e.target.value);
          if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
        })}
        disabled={pending || finalized}
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full max-w-2xl rounded-[13px] border border-line2 bg-sk-green-soft p-2 text-[11px] leading-[1.5] text-sk-ink outline-none [border-inline-start:3px_solid_var(--sk-green)] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted"
      />
      {failed && <p role="alert" className="text-[10px] text-coral">{failed}</p>}
    </div>
  );
}

interface ReviewItemRowProps {
  row: Row; index: number; labels: Record<string, string>;
  /** Monday presentation mode — see the `present` const in ReviewBoard. */
  present: boolean;
  /** D1: the review is locked. Wins over `present`: even a Sunday-mode view
   *  of an already-finalized review renders read-only. */
  finalized: boolean;
}

function ReviewItemRow({ row, index, labels, present, finalized }: ReviewItemRowProps) {
  const { item, title, owner, due } = row;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  // D2: Owner/Due are canonical *task* fields (My Work, Project Process read
  // them too), not review-scoped annotations like the note/next-step — the
  // checklist ("אם הוגדרו לעריכה") scopes their inline editing to Sunday
  // prep only, read-only once the meeting is live or the review is
  // finalized. Note and Next step stay editable in both modes, same as
  // today's note field, since they're meeting annotations meant to be
  // captured live.
  const editableOwnerDue = !present && !finalized;

  // Spec §טז: blue = waiting on external, red = blocked, green = completed.
  const statusClass =
    item.status_snapshot === 'done' ? 'bg-sage-soft text-sage'
    : item.status_snapshot === 'blocked' ? 'bg-coral-soft text-coral'
    : item.status_snapshot === 'waiting' ? 'bg-mist-soft text-mist'
    : item.status_snapshot === 'carried' ? 'bg-mist-soft text-mist'
    : item.status_snapshot === 'dropped' || item.status_snapshot === 'no_update' ? 'bg-card2 text-ink3'
    : 'bg-mist-soft text-mist';
  const statusText =
    item.status_snapshot === 'done' ? labels.completed
    : item.status_snapshot === 'dropped' ? labels.notApplicable
    : item.status_snapshot === 'carried' ? labels.stCarried
    : item.status_snapshot === 'waiting' ? labels.stWaiting
    : item.status_snapshot === 'blocked' ? labels.stBlocked
    : item.status_snapshot === 'no_update' ? labels.stNoUpdate
    : labels.statusOpen;

  const saveNote = (note: string) => start(async () => {
    setFailed(null);
    const res = await saveItemNote(item.id, { weekly_note: note });
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });

  // D2: mirrors saveNote exactly — same extended action, same onBlur trigger
  // — just the other key of the patch.
  const saveNextStep = (nextStep: string) => start(async () => {
    setFailed(null);
    const res = await saveItemNote(item.id, { next_step: nextStep });
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });

  // D2: owner/due write the canonical task, so this is a separate action
  // from saveNote/saveNextStep (which only ever touch the review item) —
  // see saveItemOwnerDue's own comment in app/actions/weekly.ts.
  const saveOwnerDue = (patch: { owner?: string; due?: string }) => start(async () => {
    setFailed(null);
    const res = await saveItemOwnerDue(item.id, patch);
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });

  const act = (verb: 'completed' | 'not_applicable') => start(async () => {
    setFailed(null);
    const res = await setItemStatus(item.id, item.task_id, verb);
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });

  // Meeting statuses — annotations only; the canonical task is untouched
  // (Completed stays the task-mutating path via `act`).
  const snap = (state: SnapshotState) => start(async () => {
    setFailed(null);
    const res = await setItemSnapshot(item.id, state);
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });
  // Spec §יא: seven buttons become one dropdown. done/dropped route through
  // the task-mutating verbs; everything else is a review-only snapshot.
  const statusOptions: { value: string; label: string }[] = [
    { value: 'open', label: labels.statusOpen },
    { value: 'carried', label: labels.stCarried },
    { value: 'waiting', label: labels.stWaiting },
    { value: 'blocked', label: labels.stBlocked },
    { value: 'no_update', label: labels.stNoUpdate },
    { value: 'done', label: labels.completed },
    { value: 'dropped', label: labels.notApplicable },
  ];
  const currentStatus = statusOptions.some((o) => o.value === item.status_snapshot)
    ? item.status_snapshot
    : 'open';
  const onStatusChange = (value: string) => {
    if (value === currentStatus) return;
    if (value === 'done') act('completed');
    else if (value === 'dropped') act('not_applicable');
    else snap(value as SnapshotState);
  };

  // D2 reading order: Project/Sub-topic render above this row (accordion +
  // sub-topic header), then Action > Owner > Status > Latest note > Next
  // step > Due, each its own flex child below in that DOM order. Due used
  // to share a line with Owner right after Action; it now renders last,
  // after Next step, to match. The Status *dropdown* used to render after
  // the note (it was the row's last real control); it now sits right next
  // to the read-only Status badge, both between Owner and the note, so
  // "Status" reads as one unit in the required position rather than two.
  return (
    <li className="flex flex-wrap items-start gap-2">
      {/* Action + Owner */}
      <span className="min-w-0 flex-1 basis-full sm:basis-auto">
        {item.carried_from && labels.itemKicker && (
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink3">
            <span className="me-1.5 font-mono">{index}</span>{labels.itemKicker}
          </span>
        )}
        <span className="block text-sm text-ink">{title}</span>
        {editableOwnerDue ? (
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink3">
            {labels.ownerLabel}
            <input
              type="text"
              defaultValue={owner ?? ''}
              onBlur={(e) => saveOwnerDue({ owner: e.target.value })}
              disabled={pending}
              aria-label={`${labels.ownerLabel}: ${title}`}
              className="min-h-11 w-full max-w-[10rem] rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[11px] text-sk-ink outline-none disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
            />
          </label>
        ) : (
          owner && <span className="mt-0.5 block text-[11px] text-ink3">{labels.ownerLabel}: {owner}</span>
        )}
      </span>

      {/* Status: read-only badge + the dropdown that changes it, together */}
      <span role="status" className={`rounded-[6px] px-2 py-1 text-[9px] font-[650] uppercase leading-none ${statusClass}`}>{statusText}</span>
      <span className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto">
        <label className="flex items-center gap-1.5 text-[10px] text-sk-muted">
          {labels.statusLabel}
          <select
            disabled={pending || finalized}
            value={currentStatus}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label={`${labels.statusLabel}: ${title}`}
            className="min-h-11 cursor-pointer rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[10px] text-sk-ink outline-none disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </span>

      {/* Latest note. Editable in both modes — §13: the note is multiline,
          this was an <input>, which forced a week's meeting notes onto one
          line. Locked only by `finalized`, never by `present`. */}
      <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.noteKicker}</span>
        <textarea
          defaultValue={item.weekly_note ?? ''}
          rows={2}
          onBlur={(e) => saveNote(e.target.value)}
          disabled={pending || finalized}
          aria-label={labels.noteKicker}
          placeholder={labels.note}
          className="mt-0.5 w-full resize-y rounded-[8px] border border-sk-line-strong bg-sk-green-soft px-2.5 py-1.5 text-[10px] leading-[1.5] text-sk-ink outline-none focus-within:shadow-[0_0_0_2px_var(--color-sage-soft)] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted"
        />
      </span>

      {/* Next step (D2) — mirrors the note field exactly: same styling, same
          onBlur save, same both-modes editability, only the column differs. */}
      <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.nextStepKicker}</span>
        <textarea
          defaultValue={item.next_step ?? ''}
          rows={2}
          onBlur={(e) => saveNextStep(e.target.value)}
          disabled={pending || finalized}
          aria-label={labels.nextStepKicker}
          placeholder={labels.nextStepPh}
          className="mt-0.5 w-full resize-y rounded-[8px] border border-sk-line-strong bg-sk-green-soft px-2.5 py-1.5 text-[10px] leading-[1.5] text-sk-ink outline-none focus-within:shadow-[0_0_0_2px_var(--color-sage-soft)] disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted"
        />
      </span>

      {/* Due — last, per the required order. Sunday-mode input or read-only
          text; hidden entirely when read-only and empty, same as before. */}
      {(editableOwnerDue || due) && (
        <span className="basis-full sm:basis-auto">
          {editableOwnerDue ? (
            <label className="flex items-center gap-1.5 text-[11px] text-ink3">
              {labels.dueLabel}
              <input
                type="date"
                defaultValue={due ?? ''}
                onBlur={(e) => saveOwnerDue({ due: e.target.value })}
                disabled={pending}
                aria-label={`${labels.dueLabel}: ${title}`}
                className="min-h-11 rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[11px] text-sk-ink outline-none disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
              />
            </label>
          ) : (
            <span className="text-[11px] text-ink3">{labels.dueLabel}: <bdi>{fmtDate(due)}</bdi></span>
          )}
        </span>
      )}

      {/* §19: surface the real failure, not a generic string. */}
      {failed && <span role="alert" className="basis-full text-[10px] text-coral">{failed}</span>}
    </li>
  );
}

function ReviewControls(
  { review, labels, present, finalized }: { review: WeeklyReview; labels: Record<string, string>; present: boolean; finalized: boolean },
) {
  const saved = review.status === 'saved';
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // D4: was two booleans (uploaded/uploadFailed) that could only ever say
  // "something uploaded" with no name, date or status — the checklist wants
  // enough detail to tell which file landed and when. `lastFile` only
  // updates on a confirmed success (fetch + attachRecording both ok), so a
  // later failed attempt never erases the record of what is actually
  // attached to this review right now (see the guard in `upload` below).
  const [lastFile, setLastFile] = useState<{ name: string; at: string } | null>(null);
  // D4 (review follow-up): was a boolean rendering the generic labels.error
  // ("Couldn't save — try again") for every failure alike. route.ts returns
  // real reasons (413 "file too large (max 20MB)", the caught exception
  // text on its 200 catch-all) and attachRecording returns a real Supabase
  // error — every other action in this file surfaces res.error verbatim
  // (see save/finalize/reopen above), and §19 further down says exactly
  // this: surface the real failure, not a generic string. Falls back to
  // labels.error only where there genuinely isn't a specific one (the
  // `!json.documentId` branch below, which route.ts can return without an
  // `error` key).
  const [uploadError, setUploadError] = useState<string | null>(null);

  const save = () => start(async () => {
    setFailed(null);
    setJustSaved(false);
    const res = await saveReview(review.id);
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
    else setJustSaved(true);
  });

  // D1: window.confirm — same pattern the settings page already uses for a
  // consequential one-click action (removing a user). Reopen gets no
  // confirm: it only ever *un*-locks, nothing is destroyed by it.
  const finalize = () => {
    if (!confirm(labels.finalizeConfirm)) return;
    start(async () => {
      setFailed(null);
      const res = await finalizeReview(review.id);
      if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
    });
  };

  const reopen = () => start(async () => {
    setFailed(null);
    const res = await reopenReview(review.id);
    if (res?.error) setFailed(weeklyErrorMessage(res.error, labels));
  });

  const upload = (file: File) => start(async () => {
    // Only the error resets up front. `lastFile` is left alone here on
    // purpose: it describes what is actually attached to the review right
    // now, which a failed *retry* does not change (attachRecording never
    // reran, or never got a new documentId to run with), so clearing it
    // would show "nothing attached" while the prior recording is still
    // there.
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.ok === false || !json.documentId) {
        setUploadError(typeof json.error === 'string' && json.error ? json.error : labels.error);
        return;
      }
      const attached = await attachRecording(review.id, json.documentId);
      if (attached?.error) { setUploadError(attached.error); return; }
      setLastFile({ name: file.name, at: laToday() });
    } catch (e) {
      setUploadError(String(e));
    }
  });

  return (
    // §7 proportions: the save card is the narrower of the two.
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      <div className="rounded-[13px] border border-line bg-sk-surface p-4 shadow-card">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-green">{labels.saveKicker}</p>
        <p className="mt-1 text-[10px] leading-[1.45] text-sk-text">{labels.saveSub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {finalized ? (
            <>
              {/* D1: badge + Reopen replace Save + Finalize once locked —
                  there's nothing left to save, and Save must never be the
                  thing that silently un-finalizes (see saveReview's guard). */}
              <span className="rounded-[6px] bg-sk-green-soft px-2 py-1 text-[10px] font-[650] text-sk-green">
                {labels.finalizedBadge?.replace('{date}', review.finalized_at ? fmtDate(review.finalized_at) : '')}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={reopen}
                className="min-h-11 cursor-pointer rounded-[8px] border border-line bg-sk-surface px-4 py-2 text-[10px] font-[650] leading-none text-sk-ink disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
              >
                {labels.reopen}
              </button>
            </>
          ) : (
            <>
              {/* Save is a checkpoint, not a lock: it stays enabled after
                  saving so a review can be saved again during the meeting. */}
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className="min-h-11 cursor-pointer rounded-[8px] bg-sage px-4 py-2 text-[10px] font-[650] leading-none text-white disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
              >
                {justSaved || saved ? labels.saved : labels.save}
              </button>
              {/* D1: secondary action beside Save, per the checklist —
                  confirmed inline (window.confirm above), locks every item
                  for the meeting; Reopen is how it reverses. */}
              <button
                type="button"
                disabled={pending}
                onClick={finalize}
                className="min-h-11 cursor-pointer rounded-[8px] border border-sage-line px-4 py-2 text-[10px] font-[650] leading-none text-sage disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-sk-surface-soft disabled:text-sk-muted sm:min-h-0"
              >
                {labels.finalize}
              </button>
            </>
          )}
          <span className="font-mono text-[10px] text-sk-muted">{labels.meeting} · <bdi>{fmtDate(review.meeting_date)}</bdi></span>
        </div>
        {justSaved && !failed && <p role="status" className="mt-2 text-[10px] text-sk-green">{labels.saved}</p>}
        {failed && <p role="alert" className="mt-2 text-[10px] text-coral">{failed}</p>}
      </div>

      <div className="rounded-[13px] border border-line bg-sk-surface p-4 shadow-card">
        {/* §7: the eyebrow reflects which side of the meeting we are on. */}
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-blue">
          {present ? labels.uploadKicker : (labels.uploadKickerDraft ?? labels.uploadKicker)}
        </p>
        <p className="mt-1 text-[10px] leading-[1.45] text-sk-text">{labels.uploadSub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink2 hover:bg-card2 sm:min-h-0">
            {labels.upload}
            <input
              type="file"
              accept=".mp4,.txt,.docx"
              aria-label={labels.upload}
              disabled={pending}
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
            />
          </label>
          {/* D4: on success, name + date + status — not just a bare flag.
              Both wrapped in <bdi> (same as due/meeting-date elsewhere in
              this file) since a file name can be arbitrary text sitting next
              to a numeric date in an RTL layout. */}
          {lastFile && (
            <span role="status" className="text-xs text-sage">
              <bdi>{lastFile.name}</bdi> · <bdi>{lastFile.at}</bdi> · {labels.processed}
            </span>
          )}
          {uploadError && <span role="alert" className="text-xs text-coral">{uploadError}</span>}
        </div>
        {/* D4: state exactly the formats accept= allows and route.ts genuinely
            handles — .mp4 stores + links only (no transcription yet), .txt
            and .docx both run through the real transcript pipeline. Same
            casing/format as the identical MP4/TXT/DOCX set already shown on
            the Data Inbox's "Meeting recording" tab (app/(dash)/(focused)/upload/page.tsx). */}
        <p className="mt-2 font-mono text-[9px] text-sk-muted">MP4 · TXT · DOCX</p>
      </div>
    </div>
  );
}
