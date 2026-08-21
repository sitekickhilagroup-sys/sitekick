'use client';

import { useState, useTransition } from 'react';
import { applyWorkVerb } from '@/app/actions/work';
import type { WorkVerb } from '@/lib/work-verbs';

const NEEDS_TEXT: WorkVerb[] = ['waiting', 'note'];
const NEEDS_DATE: WorkVerb[] = ['delayed', 'scheduled'];
const VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];

export function VerbMenu({ taskId, labels }: { taskId: string; labels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [askInput, setAskInput] = useState<WorkVerb | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const run = (verb: WorkVerb, input: string | null) => start(async () => {
    setFailed(false);
    const res = await applyWorkVerb(taskId, verb, input);
    if (res?.error) { setFailed(true); return; }
    setOpen(false); setAskInput(null); setDraft('');
  });

  if (askInput) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus aria-label={labels[askInput]} value={draft}
          type={NEEDS_DATE.includes(askInput) ? 'date' : 'text'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(askInput, draft); if (e.key === 'Escape') setAskInput(null); }}
          className={`w-32 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink ${failed ? 'border-coral' : 'border-mist'}`} />
        <button type="button" disabled={pending} onClick={() => run(askInput, draft)} aria-label={labels[askInput]}
          className="min-h-11 rounded-full bg-sage px-2.5 py-0.5 text-[11px] text-white disabled:opacity-50 sm:min-h-7"><span aria-hidden="true">✓</span></button>
        <button type="button" onClick={() => setAskInput(null)} aria-label={labels.cancel}
          className="min-h-11 rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3 sm:min-h-7"><span aria-hidden="true">✕</span></button>
        {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.errorSave}</span>}
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
        className="min-h-11 rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2 hover:bg-card2 sm:min-h-0">
        {labels.update}
      </button>
      {open && (
        <>
          <span aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-20 sm:hidden" />
          <span role="menu" className="fixed inset-x-2 bottom-2 z-30 flex flex-col rounded-lg border border-line bg-card p-1 shadow-card sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:w-44">
            {VERBS.map((v) => (
              <button key={v} type="button" role="menuitem" disabled={pending}
                onClick={() => (NEEDS_TEXT.includes(v) || NEEDS_DATE.includes(v)) ? setAskInput(v) : run(v, null)}
                className="min-h-11 rounded px-2 py-1.5 text-start text-xs text-ink2 hover:bg-card2 hover:text-ink disabled:opacity-50 sm:min-h-0">
                {labels[v]}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
