'use client';

import { useState, useTransition } from 'react';
import { setProjectSummary } from '@/app/actions/process';

interface Props {
  projectId: string;
  value: string | null;
  placeholder: string;
  editTitle: string;
  saveLabel: string;
  cancelLabel: string;
  errorLabel: string;
}

// The project's narrative context paragraph (0006). Reads as plain prose;
// one tap edits in place — same manual-first pattern as WaitingEditor.
export function SummaryEditor({ projectId, value, placeholder, editTitle, saveLabel, cancelLabel, errorLabel }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setFailed(false);
    const res = await setProjectSummary(projectId, draft);
    if (res?.error) { setFailed(true); return; }
    setEditing(false);
  });

  if (!editing) {
    return (
      <button
        type="button"
        title={editTitle}
        aria-label={editTitle}
        onClick={() => { setDraft(value ?? ''); setFailed(false); setEditing(true); }}
        className="group block max-w-2xl cursor-pointer rounded-lg text-start"
      >
        {value ? (
          <span className="text-sm leading-relaxed text-ink2">{value}</span>
        ) : (
          <span className="text-sm italic text-ink3">{placeholder}</span>
        )}
        <span aria-hidden="true" className="ms-1 text-ink3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">✎</span>
      </button>
    );
  }

  return (
    <div className="max-w-2xl space-y-2">
      <textarea
        autoFocus
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
        aria-label={editTitle}
        placeholder={placeholder}
        className="w-full rounded-lg border border-mist bg-card p-2.5 text-sm leading-relaxed text-ink outline-none"
      />
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={save}
          className="min-h-11 cursor-pointer rounded-lg bg-sage px-3 py-1.5 text-xs text-white disabled:opacity-50 sm:min-h-0">
          {saveLabel}
        </button>
        <button type="button" onClick={() => setEditing(false)}
          className="min-h-11 cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-ink2 hover:bg-card2 sm:min-h-0">
          {cancelLabel}
        </button>
        {failed && <span role="alert" className="text-xs text-coral">{errorLabel}</span>}
      </div>
    </div>
  );
}
