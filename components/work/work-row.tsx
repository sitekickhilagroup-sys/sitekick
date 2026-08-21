import type { Task } from '@/lib/types';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';
import { RelationEditor, type RelationRow } from './relation-editor';

interface Props {
  task: Task;
  labels: Record<string, string>;
  relations?: RelationRow[];
  taskOptions?: { id: string; title: string }[];
}

export function WorkRow({ task, labels, relations, taskOptions }: Props) {
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-line2 px-3 py-2 last:border-b-0">
      <details className="min-w-0 flex-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 sm:min-h-0 sm:items-baseline">
          <span aria-hidden="true" className="text-ink3">+</span>
          <span className="text-sm text-ink">{task.title}</span>
          {task.due && <span className="ms-auto whitespace-nowrap font-mono text-xs text-ink2">{task.due}</span>}
        </summary>
        <div className="ms-5 mt-1 space-y-1 text-xs text-ink2">
          {task.description && <p>{task.description}</p>}
          {task.owner && <p>{labels.owner}: {task.owner}</p>}
          {task.source && <p>{labels.fromSource}: {task.source}</p>}
        </div>
        <div className="ms-5">
          <RelationEditor taskId={task.id} relations={relations ?? []} taskOptions={taskOptions ?? []} labels={labels} />
        </div>
      </details>
      <WaitingEditor taskId={task.id} value={task.waiting_for} label={labels.waiting}
        editTitle={labels.editWaiting} saveLabel={labels.save} cancelLabel={labels.cancel} errorLabel={labels.errorSave} />
      <VerbMenu taskId={task.id} labels={labels} />
    </li>
  );
}
