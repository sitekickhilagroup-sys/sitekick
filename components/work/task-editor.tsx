'use client';

import { useState, useTransition } from 'react';
import { updateTaskDetails, type TaskDetailsPatch } from '@/app/actions/tasks';
import { undoWorkVerb } from '@/app/actions/work';
import { resolveTaskPhaseKey } from '@/lib/task-details';
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
  /** Every project, including inactive ones — "General" (project_id null) is
   *  implicit, no row for it. The editor offers active projects as normal
   *  choices and injects the task's own current project even when it's
   *  inactive (an open task can already belong to one — My Work still
   *  renders it under that project's name), the same way it never hides a
   *  real sub-stage/workstream value either. current_phase_key seeds the
   *  Phase filter's initial guess when the task has no sub-stage of its own
   *  yet. */
  projects: { id: string; name: string; current_phase_key: PhaseKey | null; active: boolean }[];
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

/**
 * Full "Edit details" form: the seven My Work verbs never covered Owner,
 * Waiting-on, Project, Sub-stage or Workstream, and Impact on process had no
 * editor anywhere (QA #51/#52 + Rotem's process-page gap). One patch (only
 * the fields the user actually touched — see save() below), one audited
 * write (updateTaskDetails), the same "Recorded · Undo" outcome as every
 * other My Work action.
 *
 * Phase is NOT one of the persisted fields. tasks.stage_key is a legacy
 * column bridged to phases via stage_phase_map, never a phase itself, so
 * writing a canonical phase key into it would corrupt every other reader of
 * that column (priority scoring, dedup matching, the weekly board, the
 * process page). A task's phase is owned implicitly through
 * substage_template_id instead. The Phase <select> below is a local-only
 * filter that narrows the Sub-stage list and is never sent to the server —
 * see resolveTaskPhaseKey in lib/task-details.ts for the precedence it's
 * seeded from.
 *
 * Positioning contract: this component renders a backdrop plus a
 * fixed/absolutely-positioned sheet (bottom-sheet below `sm:`, popover above
 * it) and does NOT wrap itself in a `relative` anchor — it assumes the caller
 * already provides one, and that the caller's trigger stays rendered/visible
 * while this is open (see verb-menu.tsx for the reference integration: the
 * "Update" button and this component are siblings inside one
 * `relative inline-block` wrapper, so `sm:end-0 sm:top-full` anchors to a
 * real, correctly-sized box instead of collapsing to nothing).
 */
export function TaskEditor({ task, options, labels, onClose }: Props) {
  const [owner, setOwner] = useState(task.owner ?? '');
  const [waitingFor, setWaitingFor] = useState(task.waiting_for ?? '');
  const [due, setDue] = useState(task.due ?? '');
  const [projectId, setProjectId] = useState(task.project_id ?? '');
  const [substageId, setSubstageId] = useState(task.substage_template_id ?? '');
  const [workstreamId, setWorkstreamId] = useState(task.workstream_id ?? '');
  const [impact, setImpact] = useState<ProcessImpact | ''>(task.process_impact ?? '');
  const [category, setCategory] = useState<'project' | 'admin'>(task.category ?? 'project');
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ message: string; undoId: string | null } | null>(null);
  const [pending, start] = useTransition();

  // Local-only filter, never persisted. Seeded from the task's *derived*
  // phase: the sub-stage it's already on wins; failing that, the project's
  // current phase is a reasonable starting point; failing that, empty (the
  // Sub-stage list starts unfiltered — see substageSelectOptions below, which
  // still shows every real value regardless of this filter).
  const [phaseFilter, setPhaseFilter] = useState<string>(() => {
    const initialProject = options.projects.find((p) => p.id === (task.project_id ?? ''));
    const initialSubstage = task.substage_template_id
      ? options.substages.find((s) => s.id === task.substage_template_id)
      : undefined;
    return resolveTaskPhaseKey({
      substagePhaseKey: initialSubstage?.phase_key ?? null,
      projectPhaseKey: initialProject?.current_phase_key ?? null,
    }) ?? '';
  });

  // Never hide a value the record actually has behind a filtered-out select:
  // the phase/project filters narrow which NEW choices are offered, but the
  // control's current value is always present as a real option, even when it
  // falls outside the current filter (e.g. before the user has touched Phase
  // at all, or after they explore a different Phase without meaning to move
  // the sub-stage).
  const substageChoices = options.substages.filter((s) => s.phase_key === phaseFilter);
  const currentSubstage = options.substages.find((s) => s.id === substageId);
  const substageSelectOptions = currentSubstage && !substageChoices.some((s) => s.id === currentSubstage.id)
    ? [currentSubstage, ...substageChoices]
    : substageChoices;

  const workstreamChoices = options.workstreams.filter((w) => w.project_id === projectId);
  const currentWorkstream = options.workstreams.find((w) => w.id === workstreamId);
  const workstreamSelectOptions = currentWorkstream && !workstreamChoices.some((w) => w.id === currentWorkstream.id)
    ? [currentWorkstream, ...workstreamChoices]
    : workstreamChoices;

  const projectChoices = options.projects.filter((p) => p.active);
  const currentProject = options.projects.find((p) => p.id === projectId);
  const projectSelectOptions = currentProject && !projectChoices.some((p) => p.id === currentProject.id)
    ? [currentProject, ...projectChoices]
    : projectChoices;

  const save = () => start(async () => {
    setFailed(false);
    // Only the fields the user actually touched — sending every field back
    // (even unchanged ones) would silently revert a concurrent write, e.g. a
    // verb chip's status/waiting_for change the row hasn't re-rendered yet.
    const patch: TaskDetailsPatch = {};
    if (owner !== (task.owner ?? '')) patch.owner = owner.trim() || null;
    if (waitingFor !== (task.waiting_for ?? '')) patch.waiting_for = waitingFor.trim() || null;
    if (due !== (task.due ?? '')) patch.due = due || null;
    if (projectId !== (task.project_id ?? '')) patch.project_id = projectId || null;
    if (substageId !== (task.substage_template_id ?? '')) patch.substage_template_id = substageId || null;
    if (workstreamId !== (task.workstream_id ?? '')) patch.workstream_id = workstreamId || null;
    if (impact !== (task.process_impact ?? '')) patch.process_impact = (impact || null) as ProcessImpact | null;
    if (category !== (task.category ?? 'project')) patch.category = category;
    if (Object.keys(patch).length === 0) { onClose(); return; }

    const res = await updateTaskDetails(task.id, patch);
    if ('error' in res) { setFailed(true); return; }
    // C3: same reasoning as VerbMenu's run() — the edit itself always
    // succeeded here, so a weekly-sync hiccup (res.syncWarning) rides along
    // on the same chip rather than reading as a failed save.
    const base = labels['msg.details'] ?? labels.recorded;
    const message = res.syncWarning && labels.syncWarning ? `${base} ${labels.syncWarning}` : base;
    setResult({ message, undoId: res.undoId });
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
    <>
      <span aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-ink/40 motion-safe:animate-sk-fade sm:bg-transparent" />
      <span
        role="dialog"
        aria-label={labels.editDetails}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80dvh] flex-col gap-2 overflow-y-auto rounded-t-2xl border-t border-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card motion-safe:animate-sk-rise sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:max-h-[70dvh] sm:w-80 sm:origin-top sm:rounded-lg sm:border sm:p-3 sm:motion-safe:animate-sk-pop"
      >
        <span aria-hidden="true" className="mx-auto mb-0.5 h-1 w-9 shrink-0 rounded-full bg-line sm:hidden" />
        {/* Smaller-items fix: was <p> — invalid nested inside this dialog's
            own <span role="dialog"> (a <span> is phrasing content only). A
            <span> here renders identically: this dialog is a flex column, and
            a flex container's direct children are always blockified for
            layout regardless of their own default display. */}
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3">{labels.editDetails}</span>

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
            {projectSelectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.phase}</span>
          <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="">—</option>
            {options.phases.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.substage}</span>
          <select
            value={substageId}
            onChange={(e) => {
              const id = e.target.value;
              setSubstageId(id);
              // Keep the Phase filter honest once a real sub-stage is picked
              // — it's the sub-stage that owns the phase, not the filter.
              const picked = options.substages.find((s) => s.id === id);
              if (picked) setPhaseFilter(picked.phase_key);
            }}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9"
          >
            <option value="">—</option>
            {substageSelectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.workstream}</span>
          <select value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="">—</option>
            {workstreamSelectOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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

        <label className="block text-xs text-ink2">
          <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.category}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as 'project' | 'admin')}
            className="min-h-11 w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-9">
            <option value="project">{labels['category.project']}</option>
            <option value="admin">{labels['category.admin']}</option>
          </select>
        </label>

        {/* Smaller-items fix: was <div> — same invalid-nesting reason as the
            <span> swap above; same blockification reasoning keeps this a
            pixel-identical row. */}
        <span className="mt-1 flex shrink-0 items-center gap-2">
          <button type="button" disabled={pending} onClick={save}
            className="min-h-11 rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:min-h-7">
            {labels.save}
          </button>
          <button type="button" onClick={onClose}
            className="min-h-11 rounded-full bg-inset px-3 py-1.5 text-xs text-ink3 sm:min-h-7">
            {labels.cancel}
          </button>
          {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.errorSave}</span>}
        </span>
      </span>
    </>
  );
}
