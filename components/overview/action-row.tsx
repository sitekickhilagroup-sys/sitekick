'use client';

import { useState, useTransition } from 'react';
import { setTaskStatus } from '@/app/actions/tasks';
import { releaseBlocker } from '@/app/actions/blockers';
import { WaitingEditor } from './waiting-editor';
import type { Action } from '@/lib/types';
import { fmtDate } from '@/lib/format';

interface Labels {
  markDone: string;
  dismiss: string;
  waiting: string;
  editWaiting: string;
  fromSource: string;
  cancel: string;
  errorSave: string;
  all: string;
  whyCritical: string;
  whyDue: string;
  unlocksN: string; // "unlocks {n}"
  stuckDays: string; // "{n}d stuck"
  blockedBy: string;
}

// Each top action shows where it came from and can be cleared in place:
// done / dismiss for tasks, release for blockers (client feedback).
export function ActionRow({ action, index, labels }: { action: Action; index: number; labels: Labels }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const clear = (how: 'done' | 'dropped') => start(async () => {
    setFailed(false);
    const res = action.kind === 'task' ? await setTaskStatus(action.id, how) : await releaseBlocker(action.id);
    if (res && 'error' in res && res.error) setFailed(true);
  });

  // why-parts arrive locale-neutral from the priority engine; translate here.
  const why = [
    action.why.critical ? labels.whyCritical : null,
    action.why.due ? `${labels.whyDue} ${fmtDate(action.why.due)}` : null,
    action.why.waiting ? `${labels.waiting}: ${action.why.waiting}` : null,
    action.why.unlocks ? labels.unlocksN.replace('{n}', String(action.why.unlocks)) : null,
    action.why.stuck_days != null ? labels.stuckDays.replace('{n}', String(action.why.stuck_days)) : null,
    action.why.blocked_by ? `${labels.blockedBy} ${action.why.blocked_by}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <li className={`flex items-start gap-4 rounded-(--radius-card) border border-line bg-card p-4 shadow-card transition-opacity ${pending ? 'opacity-40' : ''}`}>
      <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sage-soft font-serif text-sm text-sage">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug text-ink">{action.title}</p>
        <p className="mt-0.5 text-xs text-ink3">
          <span className="font-medium text-ink2">{action.project ?? labels.all}</span>
          {why ? <> · {why}</> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {action.kind === 'task' && (
            <WaitingEditor
              taskId={action.id}
              value={action.waiting_for}
              label={labels.waiting}
              editTitle={labels.editWaiting}
              cancelLabel={labels.cancel}
              errorLabel={labels.errorSave}
            />
          )}
          {action.source && (
            <span className="rounded-full bg-card2 px-2 py-0.5 text-[10px] text-ink3" title={action.source}>
              {labels.fromSource}: {action.source.length > 42 ? action.source.slice(0, 42) + '…' : action.source}
            </span>
          )}
          {action.kind === 'blocker' && (
            <span aria-hidden="true" className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] text-coral">⚠</span>
          )}
          {failed && <span role="alert" className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] text-coral">{labels.errorSave}</span>}
        </div>
      </div>
      <span className="flex flex-none flex-col gap-1">
        <button
          type="button" disabled={pending} onClick={() => clear('done')}
          title={labels.markDone} aria-label={labels.markDone}
          className="min-h-7 min-w-7 rounded-full border border-sage-line px-2 py-0.5 text-[11px] text-sage hover:bg-sage-soft disabled:opacity-50"
        >
          <span aria-hidden="true">✓</span>
        </button>
        {/* Blockers have one outcome (released) — a second button would lie. */}
        {action.kind === 'task' && (
          <button
            type="button" disabled={pending} onClick={() => clear('dropped')}
            title={labels.dismiss} aria-label={labels.dismiss}
            className="min-h-11 min-w-11 cursor-pointer sm:min-h-7 sm:min-w-7 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink3 hover:bg-inset disabled:opacity-50"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </span>
    </li>
  );
}
