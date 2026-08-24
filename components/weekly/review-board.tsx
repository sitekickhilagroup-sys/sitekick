'use client';

import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { attachRecording, saveItemNote, saveReview, saveSubtopicContext, setItemSnapshot, setItemStatus, type SnapshotState } from '@/app/actions/weekly';
import type { WeeklyReview, WeeklyReviewItem } from '@/lib/types';

interface Row { item: WeeklyReviewItem; title: string; owner?: string | null; due?: string | null }
interface SubtopicGroup { name: string; projectId?: string | null; context?: string | null; items: Row[] }
interface ProjectGroup { projectName: string; subtopics: SubtopicGroup[] }

interface Props {
  review: WeeklyReview;
  groups: ProjectGroup[];
  labels: Record<string, string>;
}

// Client-demo structure: mode toggle (Sunday draft = edit, Monday presentation
// = clean read-only), 3-step explainer, save + upload cards, project -> sub-topic
// groups, archive-semantics footer. Spec §יא: each project is an accordion and
// only one opens at a time; Completed rows collapse; status is one dropdown.
export function ReviewBoard({ review, groups, labels }: Props) {
  const params = useSearchParams();
  // Mode comes from the URL, not component state: it has to survive a refresh,
  // §2 requires it to come from application state, and it lets the header own
  // the control while this board just reads the value.
  const present = params.get('mode') === 'meeting';
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
      <ReviewControls review={review} labels={labels} present={present} />

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
                      placeholder={labels.contextPh}
                    />
                    {/* §11: display every action. Completed rows used to hide
                        inside a <details>, and the two lists each restarted
                        their numbering at 1 — one continuous counter now. */}
                    <ul className="mt-2 space-y-3">
                      {sub.items.map((row, i) => (
                        <ReviewItemRow key={row.item.id} row={row} index={i + 1} labels={labels} />
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
// no longer a read-only rendering of this.
function SubtopicContext({ reviewId, projectId, subtopic, value, placeholder }: {
  reviewId: string; projectId: string | null; subtopic: string; value: string | null;
  placeholder?: string;
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
          if (res?.error) setFailed(res.error);
        })}
        disabled={pending}
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full max-w-2xl rounded-[13px] border border-line2 bg-sk-green-soft p-2 text-[11px] leading-[1.5] text-sk-ink outline-none [border-inline-start:3px_solid_var(--sk-green)] disabled:opacity-50"
      />
      {failed && <p role="alert" className="text-[10px] text-coral">{failed}</p>}
    </div>
  );
}

function ReviewItemRow({ row, index, labels }: { row: Row; index: number; labels: Record<string, string> }) {
  const { item, title, owner, due } = row;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

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
    const res = await saveItemNote(item.id, note);
    if (res?.error) setFailed(res.error);
  });

  const act = (verb: 'completed' | 'not_applicable') => start(async () => {
    setFailed(null);
    const res = await setItemStatus(item.id, item.task_id, verb);
    if (res?.error) setFailed(res.error);
  });

  // Meeting statuses — annotations only; the canonical task is untouched
  // (Completed stays the task-mutating path via `act`).
  const snap = (state: SnapshotState) => start(async () => {
    setFailed(null);
    const res = await setItemSnapshot(item.id, state);
    if (res?.error) setFailed(res.error);
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

  return (
    <li className="flex flex-wrap items-start gap-2">
      <span className="min-w-0 flex-1 basis-full sm:basis-auto">
        {item.carried_from && labels.itemKicker && (
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink3">
            <span className="me-1.5 font-mono">{index}</span>{labels.itemKicker}
          </span>
        )}
        <span className="block text-sm text-ink">{title}</span>
        {(owner || due) && (
          <span className="mt-0.5 block text-[11px] text-ink3">
            {owner ? `${labels.ownerLabel}: ${owner}` : ''}
            {owner && due ? ' · ' : ''}
            {due ? <bdi>{due}</bdi> : null}
          </span>
        )}
      </span>
      <span role="status" className={`rounded-[6px] px-2 py-1 text-[9px] font-[650] uppercase leading-none ${statusClass}`}>{statusText}</span>

      {/* Editable in both modes now. §13: the note is multiline — this was an
          <input>, which forced a week's meeting notes onto one line. */}
      <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.noteKicker}</span>
        <textarea
          defaultValue={item.weekly_note ?? ''}
          rows={2}
          onBlur={(e) => saveNote(e.target.value)}
          disabled={pending}
          aria-label={labels.noteKicker}
          placeholder={labels.note}
          className="mt-0.5 w-full resize-y rounded-[8px] border border-sk-line-strong bg-sk-green-soft px-2.5 py-1.5 text-[10px] leading-[1.5] text-sk-ink outline-none focus-within:shadow-[0_0_0_2px_var(--color-sage-soft)] disabled:opacity-50"
        />
      </span>
      <span className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto">
        <label className="flex items-center gap-1.5 text-[10px] text-sk-muted">
          {labels.statusLabel}
          <select
            disabled={pending}
            value={currentStatus}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label={`${labels.statusLabel}: ${title}`}
            className="min-h-11 cursor-pointer rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[10px] text-sk-ink outline-none disabled:opacity-50 sm:min-h-0"
          >
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </span>
      {/* §19: surface the real failure, not a generic string. */}
      {failed && <span role="alert" className="basis-full text-[10px] text-coral">{failed}</span>}
    </li>
  );
}

function ReviewControls({ review, labels, present }: { review: WeeklyReview; labels: Record<string, string>; present: boolean }) {
  const saved = review.status === 'saved';
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  const save = () => start(async () => {
    setFailed(null);
    setJustSaved(false);
    const res = await saveReview(review.id);
    if (res?.error) setFailed(res.error);
    else setJustSaved(true);
  });

  const upload = (file: File) => start(async () => {
    setUploaded(false);
    setUploadFailed(false);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.ok === false || !json.documentId) { setUploadFailed(true); return; }
      const attached = await attachRecording(review.id, json.documentId);
      if (attached?.error) { setUploadFailed(true); return; }
      setUploaded(true);
    } catch {
      setUploadFailed(true);
    }
  });

  return (
    // §7 proportions: the save card is the narrower of the two.
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      <div className="rounded-[13px] border border-line bg-sk-surface p-4 shadow-card">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-green">{labels.saveKicker}</p>
        <p className="mt-1 text-[10px] leading-[1.45] text-sk-text">{labels.saveSub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Save is a checkpoint, not a lock: it stays enabled after saving so
              a review can be saved again during the meeting. */}
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="min-h-11 cursor-pointer rounded-[8px] bg-sage px-4 py-2 text-[10px] font-[650] leading-none text-white disabled:opacity-50 sm:min-h-0"
          >
            {justSaved || saved ? labels.saved : labels.save}
          </button>
          <span className="font-mono text-[10px] text-sk-muted">{labels.meeting} · <bdi>{review.meeting_date}</bdi></span>
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
          {uploaded && <span role="status" className="text-xs text-sage">{labels.uploaded}</span>}
          {uploadFailed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
        </div>
      </div>
    </div>
  );
}
