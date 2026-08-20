'use client';

import { useTransition } from 'react';
import { setTaskStatus } from '@/app/actions/tasks';
import { releaseBlocker } from '@/app/actions/blockers';
import { WaitingEditor } from './waiting-editor';
import type { Action } from '@/lib/types';

interface Labels {
  markDone: string;
  dismiss: string;
  waiting: string;
  editWaiting: string;
  fromSource: string;
}

// Each top action shows where it came from and can be cleared in place:
// done / dismiss for tasks, release for blockers (client feedback).
export function ActionRow({ action, index, labels }: { action: Action; index: number; labels: Labels }) {
  const [pending, start] = useTransition();

  const clear = (how: 'done' | 'dropped') => start(async () => {
    if (action.kind === 'task') await setTaskStatus(action.id, how);
    else await releaseBlocker(action.id);
  });

  return (
    <li className={`flex items-start gap-4 rounded-(--radius-card) border border-line bg-card p-4 shadow-card transition-opacity ${pending ? 'opacity-40' : ''}`}>
      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sage-soft font-serif text-sm text-sage">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug text-ink">{action.title}</p>
        <p className="mt-0.5 text-xs text-ink3">
          <span className="font-medium text-ink2">{action.project}</span>
          {action.why ? <> · {action.why}</> : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {action.kind === 'task' && (
            <WaitingEditor
              taskId={action.id}
              value={action.waiting_for}
              label={labels.waiting}
              editTitle={labels.editWaiting}
            />
          )}
          {action.source && (
            <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] text-ink3" title={action.source}>
              {labels.fromSource}: {action.source.length > 42 ? action.source.slice(0, 42) + '…' : action.source}
            </span>
          )}
          {action.kind === 'blocker' && (
            <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] text-coral">⚠</span>
          )}
        </div>
      </div>
      <span className="flex flex-none flex-col gap-1">
        <button
          type="button" disabled={pending} onClick={() => clear('done')}
          title={labels.markDone}
          className="rounded-full border border-sage-line px-2 py-0.5 text-[11px] text-sage hover:bg-sage-soft disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button" disabled={pending} onClick={() => clear('dropped')}
          title={labels.dismiss}
          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink3 hover:bg-inset disabled:opacity-50"
        >
          ✕
        </button>
      </span>
    </li>
  );
}
