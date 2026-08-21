'use client';

import { useState, useTransition } from 'react';
import { attachRecording, saveItemNote, saveReview, setItemSnapshot, setItemStatus, type SnapshotState } from '@/app/actions/weekly';
import type { WeeklyReview, WeeklyReviewItem } from '@/lib/types';

interface Row { item: WeeklyReviewItem; title: string }
interface SubtopicGroup { name: string; items: Row[] }
interface ProjectGroup { projectName: string; subtopics: SubtopicGroup[] }

interface Props {
  review: WeeklyReview;
  groups: ProjectGroup[];
  labels: Record<string, string>;
}

export function ReviewBoard({ review, groups, labels }: Props) {
  const saved = review.status === 'saved';
  const allItems = groups.flatMap((g) => g.subtopics.flatMap((s) => s.items));
  const doneCount = allItems.filter((r) => r.item.status_snapshot === 'done').length;

  return (
    <div className="mt-6 space-y-5">
      {allItems.length > 0 && labels.progress && (
        <p role="status" className="text-sm text-ink2">
          {labels.progress
            .replace('{done}', `⁨${doneCount}⁩`)
            .replace('{total}', `⁨${allItems.length}⁩`)}
        </p>
      )}
      {groups.length === 0 && labels.noItems && (
        <p className="rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{labels.noItems}</p>
      )}
      {groups.map((group) => (
        <section key={group.projectName} className="overflow-hidden rounded-(--radius-card) border border-line bg-card shadow-card">
          <h2 className="border-b border-line bg-card2 px-4 py-2.5 text-sm font-semibold text-ink">{group.projectName}</h2>
          <div className="divide-y divide-line2">
            {group.subtopics.map((sub) => (
              <div key={sub.name} className="px-4 py-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-ink3">{sub.name}</h3>
                <ul className="mt-2 space-y-2">
                  {sub.items.map((row) => (
                    <ReviewItemRow key={row.item.id} row={row} saved={saved} labels={labels} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
      <ReviewFooter review={review} labels={labels} />
    </div>
  );
}

function ReviewItemRow({ row, saved, labels }: { row: Row; saved: boolean; labels: Record<string, string> }) {
  const { item, title } = row;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const statusClass =
    item.status_snapshot === 'done' ? 'bg-sage-soft text-sage'
    : item.status_snapshot === 'blocked' ? 'bg-coral-soft text-coral'
    : item.status_snapshot === 'waiting' ? 'bg-apricot-soft text-apricot'
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

  // Client-demo meeting statuses — annotations only; the canonical task is
  // untouched (Completed stays the task-mutating path via `act`).
  const snap = (state: SnapshotState) => start(async () => {
    setFailed(false);
    const res = await setItemSnapshot(item.id, state);
    if (res?.error) setFailed(true);
  });
  const snapButtons: { state: SnapshotState; label: string }[] = [
    { state: 'open', label: labels.statusOpen },
    { state: 'carried', label: labels.stCarried },
    { state: 'waiting', label: labels.stWaiting },
    { state: 'blocked', label: labels.stBlocked },
    { state: 'no_update', label: labels.stNoUpdate },
  ];

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 basis-full text-sm text-ink sm:basis-auto">{title}</span>
      <span role="status" className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass}`}>{statusText}</span>
      <input
        defaultValue={item.weekly_note ?? ''}
        onBlur={(e) => saveNote(e.target.value)}
        disabled={pending || saved}
        aria-label={labels.note}
        placeholder={labels.note}
        className="min-h-11 w-full flex-1 rounded-lg border border-line bg-card2 px-2.5 py-1.5 text-xs text-ink outline-none disabled:opacity-50 sm:min-h-0 sm:w-40"
      />
      {!saved && (
        <span className="flex basis-full flex-wrap items-center gap-1.5">
          <button type="button" disabled={pending} onClick={() => act('completed')}
            className={`min-h-11 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50 sm:min-h-0 sm:py-1 ${
              item.status_snapshot === 'done'
                ? 'bg-sage text-white'
                : 'border border-sage-line text-sage hover:bg-sage-soft'
            }`}>
            {labels.completed}
          </button>
          {snapButtons.map(({ state, label }) => (
            <button key={state} type="button" disabled={pending} onClick={() => snap(state)}
              aria-pressed={item.status_snapshot === state}
              className={`min-h-11 cursor-pointer rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50 sm:min-h-0 sm:py-1 ${
                item.status_snapshot === state
                  ? 'bg-ink text-bg'
                  : 'border border-line text-ink2 hover:bg-card2'
              }`}>
              {label}
            </button>
          ))}
          <button type="button" disabled={pending} onClick={() => act('not_applicable')}
            className="min-h-11 cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink3 hover:bg-card2 disabled:opacity-50 sm:min-h-0 sm:py-1">
            {labels.notApplicable}
          </button>
        </span>
      )}
      {failed && <span role="alert" className="basis-full text-xs text-coral">{labels.error}</span>}
    </li>
  );
}

function ReviewFooter({ review, labels }: { review: WeeklyReview; labels: Record<string, string> }) {
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
    <footer className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
      <span className="font-mono text-xs text-ink3">{labels.meeting} · <bdi>{review.meeting_date}</bdi></span>
      <button
        type="button"
        disabled={pending || saved}
        onClick={save}
        className="min-h-11 rounded-lg bg-sage px-4 py-2 text-sm text-white disabled:opacity-50 sm:min-h-0"
      >
        {saved ? labels.saved : labels.save}
      </button>
      <label className="min-h-11 inline-flex cursor-pointer items-center rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink2 hover:bg-card2 sm:min-h-0">
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
      {(failed || uploadFailed) && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
    </footer>
  );
}
