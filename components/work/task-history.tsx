'use client';

import { useState } from 'react';
import { getTaskHistory, revertTaskHistoryEntry, type TaskHistoryEntry } from '@/app/actions/tasks';

/**
 * Task equivalent of invoices' E5 change-trail <details> (link-editor.tsx),
 * with one addition invoices' read-only trail doesn't have: the single
 * newest entry (entry.canUndo, computed server-side by getTaskHistory) can
 * still be reverted from here — this is what makes Undo persistent past the
 * SavedChip's own short lifetime, not just a record of what happened.
 */
export interface TaskHistoryLabels {
  history: string;
  historyEmpty: string;
  historyLoading: string;
  historyChanged: string;
  historyConflict: string;
  errorHistoryLoad: string;
  undo: string;
  // Field/column labels, reused from the editor's own form labels where a
  // key maps directly onto one.
  taskName: string;
  owner: string;
  waitingOn: string;
  colDue: string;
  project: string;
  substage: string;
  workstream: string;
  impact: string;
  category: string;
  fieldStatus: string;
  fieldNote: string;
  // Action labels — reused from the verb menu's own labels where they map.
  historyActionEdit: string;
  historyActionUndo: string;
  historyActionReopen: string;
  completed: string;
  sent_email: string;
  waiting: string;
  delayed: string;
  scheduled: string;
  not_applicable: string;
  note: string;
}

interface Props {
  taskId: string;
  labels: TaskHistoryLabels;
  /** Called after a successful revert — the caller closes the editor so the
   *  next paint reflects the server's already-revalidated task row. */
  onReverted: () => void;
}

export function TaskHistory({ taskId, labels, onReverted }: Props) {
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ id: string; message: string } | null>(null);

  const load = (open: boolean) => {
    if (!open || entries !== null || loading) return;
    setLoading(true);
    setLoadError(null);
    void getTaskHistory(taskId).then((res) => {
      setLoading(false);
      if ('error' in res) { setLoadError(res.error); return; }
      setEntries(res.entries);
    });
  };

  const columnLabel = (key: string): string => {
    const map: Record<string, string> = {
      title: labels.taskName, owner: labels.owner, waiting_for: labels.waitingOn,
      due: labels.colDue, project_id: labels.project, substage_template_id: labels.substage,
      workstream_id: labels.workstream, process_impact: labels.impact, category: labels.category,
      status: labels.fieldStatus, latest_note: labels.fieldNote,
    };
    return map[key] ?? key;
  };

  const ACTION_LABEL: Record<string, string> = {
    'edit:details': labels.historyActionEdit,
    'undo': labels.historyActionUndo,
    'undo:history': labels.historyActionUndo,
    'reopen': labels.historyActionReopen,
    'verb:completed': labels.completed,
    'verb:sent_email': labels.sent_email,
    'verb:waiting': labels.waiting,
    'verb:delayed': labels.delayed,
    'verb:scheduled': labels.scheduled,
    'verb:not_applicable': labels.not_applicable,
    'verb:note': labels.note,
  };
  const actionLabel = (action: string): string => ACTION_LABEL[action] ?? action;

  const revert = (logId: string) => {
    setRevertingId(logId);
    setConflictId(null);
    setErrorId(null);
    void revertTaskHistoryEntry(logId).then((res) => {
      setRevertingId(null);
      if ('error' in res) {
        if (res.conflict) { setConflictId(logId); }
        else { setErrorId({ id: logId, message: res.error }); }
        return;
      }
      onReverted();
    });
  };

  return (
    <details className="mt-1 shrink-0 rounded-lg border border-line" onToggle={(e) => load(e.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer list-none rounded-lg px-2 py-1.5 text-[10px] font-semibold text-ink3 hover:text-ink2 sm:min-h-7">
        {labels.history}
      </summary>
      <div className="max-h-36 overflow-y-auto border-t border-line px-2 py-1.5">
        {loading && <p className="text-[10px] text-ink3">{labels.historyLoading}</p>}
        {loadError && (
          <p role="alert" className="text-[10px] font-semibold text-coral">
            {labels.errorHistoryLoad.replace('{reason}', loadError)}
          </p>
        )}
        {entries && entries.length === 0 && <p className="text-[10px] text-ink3">{labels.historyEmpty}</p>}
        {entries && entries.length > 0 && (
          <ul className="space-y-1.5">
            {entries.map((h) => (
              <li key={h.id} className="border-b border-line2 pb-1.5 text-[10px] leading-relaxed text-ink2 last:border-0 last:pb-0">
                <span className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-ink">{actionLabel(h.action)}</span>
                    <span className="text-ink3"> · {h.actor} · </span>
                    <span className="font-mono text-ink3">{h.createdAt}</span>
                  </span>
                  {h.canUndo && (
                    <button type="button" disabled={revertingId === h.id} onClick={() => revert(h.id)}
                      className="shrink-0 rounded-full bg-inset px-2 py-1 text-[10px] font-semibold text-ink2 disabled:opacity-50">
                      {labels.undo}
                    </button>
                  )}
                </span>
                {h.changedKeys.length > 0 && (
                  <span className="mt-0.5 block text-ink3">
                    {labels.historyChanged} {h.changedKeys.map(columnLabel).join(', ')}
                  </span>
                )}
                {conflictId === h.id && (
                  <span role="alert" className="mt-0.5 block font-semibold text-apricot">{labels.historyConflict}</span>
                )}
                {errorId?.id === h.id && (
                  <span role="alert" className="mt-0.5 block font-semibold text-coral">{errorId.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
