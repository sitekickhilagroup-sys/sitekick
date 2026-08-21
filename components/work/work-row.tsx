import type { Task } from '@/lib/types';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';
import { RelationEditor, type RelationRow } from './relation-editor';

interface Props {
  task: Task;
  labels: Record<string, string>;
  relations?: RelationRow[];
  taskOptions?: { id: string; title: string }[];
  /** LA-today (YYYY-MM-DD); enables the Now/Overdue due chip. */
  today?: string;
  /** Today view's clear numeric rank (spec §ז). */
  rank?: number;
  /** Derived "why this ranks now" one-liner (spec §ט). */
  whyNow?: string | null;
  /** Titles of open tasks this one verifiably blocks (spec §ט). */
  unlocks?: string[];
}

export function WorkRow({ task, labels, relations, taskOptions, today, rank, whyNow, unlocks }: Props) {
  // Due urgency chip (client demo anatomy): overdue -> coral, due today -> apricot,
  // future dates keep the quiet mono date.
  const dueState = task.due && today
    ? task.due < today ? 'overdue' : task.due === today ? 'now' : 'future'
    : task.due ? 'future' : null;
  const blocking = task.priority === 'critical';

  return (
    // Mobile: title block, then a controls row — never squeeze the title.
    // Desktop: title grows, controls sit at the end of the row.
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line2 px-3 py-2.5 last:border-b-0">
      <details className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <summary className="min-h-11 cursor-pointer list-none sm:min-h-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:items-baseline">
            {rank != null && (
              <span className="font-mono text-xs font-medium text-sage">{String(rank).padStart(2, '0')}</span>
            )}
            <span aria-hidden="true" className="text-ink3">+</span>
            <span className="min-w-0 flex-1 text-sm text-ink">{task.title}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {blocking && labels.blocking && (
                <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-coral">
                  {labels.blocking}
                </span>
              )}
              {dueState === 'overdue' && (
                <span className="rounded-full bg-coral-soft px-2 py-0.5 font-mono text-[11px] text-coral">{labels.dueOverdue ?? task.due}</span>
              )}
              {dueState === 'now' && (
                <span className="rounded-full bg-apricot-soft px-2 py-0.5 font-mono text-[11px] text-apricot">{labels.dueNow ?? task.due}</span>
              )}
              {dueState === 'future' && (
                <span className="whitespace-nowrap font-mono text-xs text-ink2">{task.due}</span>
              )}
            </span>
          </span>
          {(task.source || task.owner) && (
            <span className="ms-5 mt-0.5 block truncate text-[11px] text-ink3">
              {task.source}
              {task.source && task.owner ? ' · ' : ''}
              {task.owner}
            </span>
          )}
        </summary>
        <div className="ms-5 mt-1 space-y-1.5 text-xs text-ink2">
          {task.description && <p>{task.description}</p>}
          {whyNow && (
            <p>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-apricot">{labels.whyNow}</span>
              {whyNow}
            </p>
          )}
          {unlocks && unlocks.length > 0 && (
            <p>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-sage">{labels.unlocks}</span>
              {unlocks.join(' · ')}
            </p>
          )}
          {task.owner && <p>{labels.owner}: {task.owner}</p>}
          {task.source && <p>{labels.fromSource}: {task.source}</p>}
        </div>
        <div className="ms-5">
          <RelationEditor taskId={task.id} relations={relations ?? []} taskOptions={taskOptions ?? []} labels={labels} />
        </div>
      </details>
      <span className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:basis-auto sm:shrink-0 sm:justify-end">
        <WaitingEditor taskId={task.id} value={task.waiting_for} label={labels.waiting}
          editTitle={labels.editWaiting} saveLabel={labels.save} cancelLabel={labels.cancel} errorLabel={labels.errorSave} />
        <VerbMenu taskId={task.id} labels={labels} />
      </span>
    </li>
  );
}
