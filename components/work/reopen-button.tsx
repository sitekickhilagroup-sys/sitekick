'use client';

import { useState, useTransition } from 'react';
import { reopenTask, undoWorkVerb } from '@/app/actions/work';
import { SavedChip } from './saved-chip';

interface Props {
  taskId: string;
  labels: { reopen: string; reopened: string; undo: string; cancel: string; error: string };
}

/**
 * Noa round 3, critical #1: the way back for a task closed by mistake — one
 * press reopens it through the audited action; the SavedChip that replaces
 * the button carries Undo (undoWorkVerb restores the closed snapshot).
 * The row itself stays rendered until the revalidated list drops it, so the
 * chip has somewhere to live.
 */
export function ReopenButton({ taskId, labels }: Props) {
  const [result, setResult] = useState<{ undoId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const reopen = () => start(async () => {
    setFailed(false);
    const res = await reopenTask(taskId);
    if ('error' in res) { setFailed(true); return; }
    setResult({ undoId: res.undoId });
  });

  const undo = (undoId: string) => start(async () => {
    const res = await undoWorkVerb(undoId);
    if (!('error' in res)) setResult(null);
  });

  if (result) {
    return (
      <SavedChip
        message={labels.reopened}
        undoId={result.undoId}
        pending={pending}
        onUndo={() => { if (result.undoId) undo(result.undoId); }}
        onDismiss={() => setResult(null)}
        labels={{ recorded: labels.reopened, undo: labels.undo, cancel: labels.cancel }}
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={reopen}
        className="min-h-11 cursor-pointer whitespace-nowrap rounded-full border border-sage-line px-2.5 py-1 text-[11px] font-[650] text-sage hover:bg-sk-green-soft disabled:opacity-50 sm:min-h-7"
      >
        {labels.reopen}
      </button>
      {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.error}</span>}
    </span>
  );
}
