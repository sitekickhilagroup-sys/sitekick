'use client';

import { useState, useTransition } from 'react';
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
  const saved = review.status === 'saved';
  const [present, setPresent] = useState(false);
  const [openProject, setOpenProject] = useState<string | null>(groups[0]?.projectName ?? null);
  const readOnly = saved || present;
  const allItems = groups.flatMap((g) => g.subtopics.flatMap((s) => s.items));
  const doneCount = allItems.filter((r) => r.item.status_snapshot === 'done').length;

  const steps = [
    { t: labels.step1t, d: labels.step1d },
    { t: labels.step2t, d: labels.step2d },
    { t: labels.step3t, d: labels.step3d },
  ];

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full bg-card2 p-0.5" role="group" aria-label={labels.modeDraft}>
          <button type="button" onClick={() => setPresent(false)} aria-pressed={!present}
            className={`min-h-11 cursor-pointer rounded-full px-3.5 py-1 text-xs sm:min-h-0 ${!present ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink'}`}>
            {labels.modeDraft}
          </button>
          <button type="button" onClick={() => setPresent(true)} aria-pressed={present}
            className={`min-h-11 cursor-pointer rounded-full px-3.5 py-1 text-xs sm:min-h-0 ${present ? 'bg-ink text-bg' : 'text-ink2 hover:text-ink'}`}>
            {labels.modePresent}
          </button>
        </div>
        {allItems.length > 0 && labels.progress && (
          <p role="status" className="text-sm text-ink2">
            <span className="font-serif text-xl text-ink">{doneCount}</span>
            <span className="text-ink3">/{allItems.length}</span>{' '}
            {labels.progress.replace('{done}/{total} ', '')}
          </p>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="rounded-(--radius-card) border border-line bg-card p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">
              <span className="me-1.5 font-mono">{i + 1}</span>{s.t}
            </p>
            <p className="mt-0.5 text-xs text-ink2">{s.d}</p>
          </li>
        ))}
      </ol>

      {!present && <ReviewControls review={review} labels={labels} />}

      {groups.length === 0 && labels.noItems && (
        <p className="rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{labels.noItems}</p>
      )}
      {groups.map((group) => {
        const open = openProject === group.projectName;
        const groupRows = group.subtopics.flatMap((s) => s.items);
        const groupDone = groupRows.filter((r) => r.item.status_snapshot === 'done').length;
        return (
          <section key={group.projectName} className="overflow-hidden rounded-(--radius-card) border border-line bg-card shadow-card">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenProject(open ? null : group.projectName)}
              className={`flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-start ${open ? 'border-b border-line bg-card2' : ''}`}
            >
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{group.projectName}</span>
              <span className="font-mono text-[11px] text-ink3">{groupDone}/{groupRows.length}</span>
              <span aria-hidden="true" className={`inline-block text-ink3 transition-transform rtl:-scale-x-100 ${open ? 'rotate-90' : ''}`}>▸</span>
            </button>
            {open && (
              <div className="divide-y divide-line2">
                {group.subtopics.map((sub) => {
                  // Completed rows collapse under a quiet details block; the
                  // live conversation (open / blocked / waiting / decisions)
                  // stays front and center.
                  const liveRows = sub.items.filter((r) => r.item.status_snapshot !== 'done');
                  const doneRows = sub.items.filter((r) => r.item.status_snapshot === 'done');
                  return (
                    <div key={sub.name} className="px-4 py-3">
                      <p className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wide text-ink3">
                        <span>{labels.subTopic ? `${labels.subTopic} · ` : ''}{sub.name}</span>
                        <span className="rounded-full bg-card2 px-1.5 py-0.5 font-mono text-[9px] normal-case">
                          {(labels.actionsN ?? '{n}').replace('{n}', String(sub.items.length))}
                        </span>
                      </p>
                      <SubtopicContext
                        reviewId={review.id}
                        projectId={sub.projectId ?? null}
                        subtopic={sub.name}
                        value={sub.context ?? null}
                        readOnly={readOnly}
                        placeholder={labels.contextPh}
                      />
                      <ul className="mt-2 space-y-3">
                        {liveRows.map((row, i) => (
                          <ReviewItemRow key={row.item.id} row={row} index={i + 1} readOnly={readOnly} labels={labels} />
                        ))}
                      </ul>
                      {doneRows.length > 0 && (
                        <details className="mt-2">
                          <summary className="min-h-11 cursor-pointer py-1 text-xs text-ink3 hover:text-ink sm:min-h-0">
                            {(labels.completedN ?? '{n}').replace('{n}', String(doneRows.length))}
                          </summary>
                          <ul className="mt-1 space-y-3 opacity-80">
                            {doneRows.map((row, i) => (
                              <ReviewItemRow key={row.item.id} row={row} index={i + 1} readOnly={readOnly} labels={labels} />
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  );
                })}
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
function SubtopicContext({ reviewId, projectId, subtopic, value, readOnly, placeholder }: {
  reviewId: string; projectId: string | null; subtopic: string; value: string | null;
  readOnly: boolean; placeholder?: string;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  if (readOnly) {
    return value
      ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink2">{value}</p>
      : null;
  }
  return (
    <div className="mt-1.5">
      <textarea
        defaultValue={value ?? ''}
        rows={2}
        onBlur={(e) => start(async () => {
          setFailed(false);
          const res = await saveSubtopicContext(reviewId, projectId, subtopic, e.target.value);
          if (res?.error) setFailed(true);
        })}
        disabled={pending}
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full max-w-2xl rounded-lg border border-line2 bg-card2 p-2 text-sm leading-relaxed text-ink outline-none disabled:opacity-50"
      />
      {failed && <p role="alert" className="text-xs text-coral">!</p>}
    </div>
  );
}

function ReviewItemRow({ row, index, readOnly, labels }: { row: Row; index: number; readOnly: boolean; labels: Record<string, string> }) {
  const { item, title, owner, due } = row;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

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
    setFailed(false);
    const res = await saveItemNote(item.id, note);
    if (res?.error) setFailed(true);
  });

  const act = (verb: 'completed' | 'not_applicable') => start(async () => {
    setFailed(false);
    const res = await setItemStatus(item.id, item.task_id, verb);
    if (res?.error) setFailed(true);
  });

  // Meeting statuses — annotations only; the canonical task is untouched
  // (Completed stays the task-mutating path via `act`).
  const snap = (state: SnapshotState) => start(async () => {
    setFailed(false);
    const res = await setItemSnapshot(item.id, state);
    if (res?.error) setFailed(true);
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
      <span role="status" className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass}`}>{statusText}</span>

      {readOnly ? (
        item.weekly_note && (
          <span className="basis-full rounded-lg bg-card2 px-2.5 py-1.5 text-xs text-ink2">{item.weekly_note}</span>
        )
      ) : (
        <>
          <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.noteKicker}</span>
            <input
              defaultValue={item.weekly_note ?? ''}
              onBlur={(e) => saveNote(e.target.value)}
              disabled={pending}
              aria-label={labels.noteKicker}
              placeholder={labels.note}
              className="mt-0.5 min-h-11 w-full rounded-lg border border-line bg-card2 px-2.5 py-1.5 text-xs text-ink outline-none disabled:opacity-50 sm:min-h-0"
            />
          </span>
          <span className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto">
            <label className="flex items-center gap-1.5 text-[11px] text-ink3">
              {labels.statusLabel}
              <select
                disabled={pending}
                value={currentStatus}
                onChange={(e) => onStatusChange(e.target.value)}
                aria-label={`${labels.statusLabel}: ${title}`}
                className="min-h-11 cursor-pointer rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink outline-none disabled:opacity-50 sm:min-h-0"
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </span>
        </>
      )}
      {failed && <span role="alert" className="basis-full text-xs text-coral">{labels.error}</span>}
    </li>
  );
}

function ReviewControls({ review, labels }: { review: WeeklyReview; labels: Record<string, string> }) {
  const saved = review.status === 'saved';
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  const save = () => start(async () => {
    setFailed(false);
    const res = await saveReview(review.id);
    if (res?.error) setFailed(true);
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
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-sage">{labels.saveKicker}</p>
        <p className="mt-0.5 text-xs text-ink2">{labels.saveSub}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || saved}
            onClick={save}
            className="min-h-11 cursor-pointer rounded-lg bg-sage px-4 py-2 text-sm text-white disabled:opacity-50 sm:min-h-0"
          >
            {saved ? labels.saved : labels.save}
          </button>
          <span className="font-mono text-xs text-ink3">{labels.meeting} · <bdi>{review.meeting_date}</bdi></span>
        </div>
        {failed && <p role="alert" className="mt-2 text-xs text-coral">{labels.error}</p>}
      </div>

      <div className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">{labels.uploadKicker}</p>
        <p className="mt-0.5 text-xs text-ink2">{labels.uploadSub}</p>
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
