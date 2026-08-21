'use client';

import { useState, useTransition } from 'react';
import { createTask, setTaskStatus } from '@/app/actions/tasks';
import { WaitingEditor } from './waiting-editor';
import type { Task } from '@/lib/types';

export interface TaskLabels {
  title: string; colTitle: string; colDesc: string; colOwner: string; colWaiting: string;
  colDue: string; colStage: string; expand: string; collapse: string; addTask: string;
  formTitle: string; formName: string; formDesc: string; formOwner: string; formDue: string;
  save: string; cancel: string; unplanned: string; markDone: string; project: string;
  dismiss: string; editWaiting: string; all: string; empty: string; errorSave: string;
}

interface Props {
  tasks: Task[];
  projects: { id: string; name: string }[];
  labels: TaskLabels;
}

const PREVIEW = 6;

// Collapsed by default (item 6), Description column (item 8), manual add (item 13).
export function TasksSection({ tasks, projects, labels }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const open = tasks.filter((t) => t.status === 'open');
  const shown = expanded ? open : open.slice(0, PREVIEW);

  const setStatus = (id: string, status: 'done' | 'dropped') => start(async () => {
    setRowError(null);
    const res = await setTaskStatus(id, status);
    if (res?.error) setRowError(labels.errorSave);
  });

  return (
    <section aria-labelledby="tasks-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="tasks-h" className="font-serif text-2xl text-ink">{labels.title}</h2>
        <div className="flex items-center gap-2">
          {rowError && <span role="alert" className="rounded-full bg-coral-soft px-2 py-0.5 text-[11px] text-coral">{rowError}</span>}
          <button
            type="button"
            onClick={() => { setShowForm((v) => !v); setFormError(null); }}
            aria-expanded={showForm}
            className="rounded-full border border-sage-line bg-sage-soft px-3 py-1 text-xs text-sage transition-transform active:scale-[0.97]"
          >
            + {labels.addTask}
          </button>
          {open.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2"
            >
              {expanded ? labels.collapse : labels.expand.replace('{n}', String(open.length))}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form
          className="mt-3 grid gap-2 rounded-(--radius-card) border border-line bg-card p-4 shadow-card sm:grid-cols-2"
          action={(fd) => start(async () => {
            setFormError(null);
            const res = await createTask(fd);
            if (res?.error) { setFormError(labels.errorSave); return; }
            setShowForm(false);
          })}
        >
          <div className="space-y-1">
            <label htmlFor="nt-project" className="block text-xs text-ink2">{labels.project}</label>
            <select id="nt-project" name="project_id" required className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="nt-title" className="block text-xs text-ink2">{labels.formName}</label>
            <input id="nt-title" name="title" required className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="nt-desc" className="block text-xs text-ink2">{labels.formDesc}</label>
            <input id="nt-desc" name="description" className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink" />
          </div>
          <div className="space-y-1">
            <label htmlFor="nt-owner" className="block text-xs text-ink2">{labels.formOwner}</label>
            <input id="nt-owner" name="owner" className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink" />
          </div>
          <div className="space-y-1">
            <label htmlFor="nt-due" className="block text-xs text-ink2">{labels.formDue}</label>
            <input id="nt-due" name="due" type="date" className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-sage px-4 py-1.5 text-sm text-white disabled:opacity-60">
              {labels.save}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-line px-4 py-1.5 text-sm text-ink2">
              {labels.cancel}
            </button>
            {formError && <span role="alert" className="text-xs text-coral">{formError}</span>}
          </div>
        </form>
      )}

      <div className="mt-3 overflow-x-auto rounded-(--radius-card) border border-line bg-card shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs text-ink3">
              <th className="px-3 py-2 text-start font-medium">{labels.colTitle}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.colDesc}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.project}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.colOwner}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.colWaiting}</th>
              <th className="px-3 py-2 text-start font-medium">{labels.colDue}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line2">
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-ink3">{labels.empty}</td>
              </tr>
            )}
            {shown.map((t) => (
              <tr key={t.id} className={t.priority === 'critical' ? 'bg-apricot-soft/50' : ''}>
                <td className="max-w-[260px] px-3 py-2 text-ink">
                  {t.title}
                  {!t.planned && <span className="ms-1 rounded bg-apricot-soft px-1 text-[10px] text-apricot">{labels.unplanned}</span>}
                </td>
                <td className="max-w-[260px] px-3 py-2 text-xs text-ink2">{t.description ?? t.source ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{t.project_id ? names.get(t.project_id) ?? labels.all : labels.all}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{t.owner ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <WaitingEditor
                    taskId={t.id}
                    value={t.waiting_for}
                    label={labels.colWaiting}
                    editTitle={labels.editWaiting}
                    cancelLabel={labels.cancel}
                    errorLabel={labels.errorSave}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink2">{t.due ?? ''}</td>
                <td className="px-3 py-2 text-end">
                  <span className="inline-flex gap-1">
                    <button
                      type="button" disabled={pending} title={labels.markDone} aria-label={labels.markDone}
                      onClick={() => setStatus(t.id, 'done')}
                      className="min-h-7 min-w-7 rounded-full border border-sage-line px-2 py-0.5 text-[11px] text-sage hover:bg-sage-soft disabled:opacity-50"
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      type="button" disabled={pending} title={labels.dismiss} aria-label={labels.dismiss}
                      onClick={() => setStatus(t.id, 'dropped')}
                      className="min-h-7 min-w-7 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink3 hover:bg-inset disabled:opacity-50"
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
