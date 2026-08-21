'use client';

import { useState, useTransition } from 'react';
import { updateTaskWaiting } from '@/app/actions/tasks';

interface Props {
  taskId: string;
  value: string | null;
  label: string; // "waiting on" prefix
  editTitle: string;
  saveLabel?: string;
  cancelLabel: string;
  errorLabel: string;
}

// The person a task waits on changes constantly (client note) —
// one click edits it in place; extract-comms also updates it from emails.
export function WaitingEditor({ taskId, value, label, editTitle, saveLabel, cancelLabel, errorLabel }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        title={editTitle}
        aria-label={`${editTitle} — ${label}: ${value ?? '—'}`}
        onClick={() => { setDraft(value ?? ''); setFailed(false); setEditing(true); }}
        className={`group inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors sm:min-h-7 ${
          value ? 'bg-mist-soft text-ink2 hover:text-ink' : 'bg-inset text-ink3 hover:text-ink2'
        }`}
      >
        {value ? `${label}: ${value}` : `${label}: —`}
        <span aria-hidden="true" className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">✎</span>
      </button>
    );
  }

  const save = () => start(async () => {
    const res = await updateTaskWaiting(taskId, draft);
    if (res?.error) { setFailed(true); return; }
    setEditing(false);
  });

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        aria-label={editTitle}
        aria-invalid={failed || undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={`min-h-11 w-28 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink outline-none sm:min-h-0 ${failed ? 'border-coral' : 'border-mist'}`}
      />
      <button type="button" disabled={pending} onClick={save} aria-label={saveLabel ?? editTitle}
        className="min-h-11 cursor-pointer rounded-full bg-sage px-2.5 py-0.5 text-[11px] text-white disabled:opacity-50 sm:min-h-7">
        <span aria-hidden="true">✓</span>
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label={cancelLabel}
        className="min-h-11 cursor-pointer rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3 sm:min-h-7">
        <span aria-hidden="true">✕</span>
      </button>
      {failed && <span role="alert" title={errorLabel} className="text-[10px] font-semibold text-coral">{errorLabel}</span>}
    </span>
  );
}
