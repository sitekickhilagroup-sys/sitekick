'use client';

import { useState, useTransition } from 'react';
import { updateTaskDetails, type TaskDetailsPatch } from '@/app/actions/tasks';
import { undoWorkVerb } from '@/app/actions/work';
import type { PhaseKey, ProcessImpact, Task } from '@/lib/types';
import { SavedChip } from './saved-chip';

const IMPACTS: ProcessImpact[] = [
  'primary_blocker', 'workstream_blocker', 'future_gate',
  'external_gate', 'not_blocking', 'verify',
];

/**
 * Every option list the editor's selects need. Built once per page (one
 * query batch) and threaded down — C4's process-page callers build the same
 * shape from their own already-loaded phase/workstream data.
 */
export interface TaskEditorOptions {
  /** Active projects; "General" (project_id null) is implicit — no row for it. */
  projects: { id: string; name: string }[];
  /** The 5 canonical phases, in position order. */
  phases: { key: PhaseKey; label: string }[];
  /** Full library; the editor filters to the chosen phase itself. */
  substages: { id: string; phase_key: PhaseKey; name: string }[];
  /** Every project's workstreams; the editor filters to the chosen project. */
  workstreams: { id: string; project_id: string; name: string }[];
}

interface Props {
  task: Task;
  options: TaskEditorOptions;
  /** Same label bag VerbMenu already carries, plus the keys Step 4 adds:
   *  editDetails, owner, waitingOn, colDue, project, general, phase,
   *  substage, workstream, impact, 'impact.<value>' x6, save, cancel,
   *  errorSave, recorded, undo, 'msg.details'. */
  labels: Record<string, string>;
  /** Collapses the editor back to its trigger — fired on Cancel, on the
   *  saved chip's dismiss, and after a successful Undo. */
  onClose: () => void;
}

// Full "Edit details" form: the seven My Work verbs never covered Owner,
// Waiting-on, Project, Phase, Sub-stage or Workstream, and Impact on process
// had no editor anywhere (QA #51/#52 + Rotem's process-page gap). One patch,
// one audited write (updateTaskDetails), the same "Recorded · Undo" outcome
// as every other My Work action.
export function TaskEditor({ task, options, labels, onClose }: Props) {
  const [owner, setOwner] = useState(task.owner ?? '');
  const [waitingFor, setWaitingFor] = useState(task.waiting_for ?? '');
  const [due, setDue] = useState(task.due ?? '');
  const [projectId, setProjectId] = useState(task.project_id ?? '');
  const [stageKey, setStageKey] = useState(task.stage_key ?? '');
  const [substageId, setSubstageId] = useState(task.substage_template_id ?? '');
  const [workstreamId, setWorkstreamId] = useState(task.workstream_id ?? '');
  const [impact, setImpact] = useState<ProcessImpact | ''>(task.process_impact ?? '');
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ message: string; undoId: string | null } | null>(null);
  const [pending, start] = useTransition();

  const substageChoices = options.substages.filter((s) => s.phase_key === stageKey);
  const workstreamChoices = options.workstreams.filter((w) => w.project_id === projectId);

  const save = () => start(async () => {
    setFailed(false);
    const patch: TaskDetailsPatch = {
      owner: owner.trim() || null,
      waiting_for: waitingFor.trim() || null,
      due: due || null,
      project_id: projectId || null,
      stage_key: stageKey || null,
      substage_template_id: substageId || null,
      workstream_id: workstreamId || null,
      process_impact: impact || null,
    };
    const res = await updateTaskDetails(task.id, patch);
    if ('error' in res) { setFailed(true); return; }
    setResult({ message: labels['msg.details'] ?? labels.recorded, undoId: res.undoId });
  });

  const undo = () => start(async () => {
    if (!result?.undoId) { onClose(); return; }
    const res = await undoWorkVerb(result.undoId);
    if ('error' in res) { setFailed(true); return; }
    onClose();
  });

  if (result) {
    return (
      <SavedChip message={result.message} undoId={result.undoId} pending={pending}
        onUndo={undo} onDismiss={onClose} labels={labels} />
    );
  }

  return (
    <span className="relative inline-block" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <span aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-ink/40 sm:bg-transparent" />
      <span
        role="dialog"
        aria-label={labels.editDetails}
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80dvh] flex-col gap-2 overflow-y-auto rounded-t-2xl border-t border-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:max-h-[70dvh] sm:w-80 sm:rounded-lg sm:border sm:p-3"
      >
        <span aria-hidden="true" className="mx-auto mb-0.5 h-1 w-9 shrink-0 rounded-full bg-line sm:hidden" />
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3">{labels.editDetails}</p>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.owner}</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9" />
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.waitingOn}</span>
          <input value={waitingFor} onChange={(e) => setWaitingFor(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9" />
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.colDue}</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9" />
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.project}</span>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setWorkstreamId(''); }}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="">{labels.general}</option>
            {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.phase}</span>
          <select value={stageKey} onChange={(e) => { setStageKey(e.target.value); setSubstageId(''); }}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="">—</option>
            {options.phases.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.substage}</span>
          <select value={substageId} onChange={(e) => setSubstageId(e.target.value)} disabled={!stageKey}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink disabled:opacity-50 sm:min-h-9">
            <option value="">—</option>
            {substageChoices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.workstream}</span>
          <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)} disabled={!projectId}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink disabled:opacity-50 sm:min-h-9">
            <option value="">—</option>
            {workstreamChoices.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.impact}</span>
          <select value={impact} onChange={(e) => setImpact(e.target.value as ProcessImpact | '')}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="">—</option>
            {IMPACTS.map((v) => <option key={v} value={v}>{labels['impact.' + v]}</option>)}
          </select>
        </label>

        <div className="mt-1 flex shrink-0 items-center gap-2">
          <button type="button" disabled={pending} onClick={save}
            className="min-h-11 rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:min-h-7">
            {labels.save}
          </button>
          <button type="button" onClick={onClose}
            className="min-h-11 rounded-full bg-inset px-3 py-1.5 text-xs text-ink3 sm:min-h-7">
            {labels.cancel}
          </button>
          {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.errorSave}</span>}
        </div>
      </span>
    </span>
  );
}
