'use client';

import { useState, useTransition } from 'react';
import { createTask, setTaskStatus } from '@/app/actions/tasks';
import type { Task } from '@/lib/types';

export interface TaskLabels {
  title: string; colTitle: string; colDesc: string; colOwner: string; colWaiting: string;
  colDue: string; colStage: string; expand: string; collapse: string; addTask: string;
  formTitle: string; formName: string; formDesc: string; formOwner: string; formDue: string;
  save: string; cancel: string; unplanned: string; markDone: string; project: string;
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
  const [pending, start] = useTransition();
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const open = tasks.filter((t) => t.status === 'open');
  const shown = expanded ? open : open.slice(0, PREVIEW);

  return (
    <section aria-labelledby="tasks-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="tasks-h" className="font-serif text-2xl text-ink">{labels.title}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
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
            await createTask(fd);
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
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-sage px-4 py-1.5 text-sm text-white disabled:opacity-60">
              {labels.save}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-line px-4 py-1.5 text-sm text-ink2">
              {labels.cancel}
            </button>
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
            {shown.map((t) => (
              <tr key={t.id} className={t.priority === 'critical' ? 'bg-coral-soft/40' : ''}>
                <td className="max-w-[260px] px-3 py-2 text-ink">
                  {t.title}
                  {!t.planned && <span className="ms-1 rounded bg-apricot-soft px-1 text-[10px] text-apricot">{labels.unplanned}</span>}
                </td>
                <td className="max-w-[260px] px-3 py-2 text-xs text-ink2">{t.description ?? t.source ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{t.project_id ? names.get(t.project_id) : 'All'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{t.owner ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{t.waiting_for ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink2">{t.due ?? ''}</td>
                <td className="px-3 py-2 text-end">
                  <button
                    type="button"
                    onClick={() => start(async () => { await setTaskStatus(t.id, 'done'); })}
                    className="rounded-full border border-sage-line px-2 py-0.5 text-[11px] text-sage hover:bg-sage-soft"
                  >
                    ✓ {labels.markDone}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
