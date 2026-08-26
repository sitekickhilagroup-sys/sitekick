'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { activateSubstage, setSubstageNote, setSubstageStatus, undoSubstageChange } from '@/app/actions/process';
import { selectConnectedTasks } from '@/lib/process';
import { ScenarioBox } from '@/components/process/scenario-box';
import { SavedChip } from '@/components/work/saved-chip';
import { VerbMenu } from '@/components/work/verb-menu';
import type { TaskEditorOptions } from '@/components/work/task-editor';
import type { ProjectSubstage, ProjectSubstageStatus, SubstageTemplate, Task, Workstream } from '@/lib/types';

// C4: was a narrow { id, title, owner, waiting_for, priority,
// substage_template_id } projection — TaskEditor (A6) needs the rest of a
// task's persisted fields (due, project_id, workstream_id, process_impact,
// …) to seed its form, and getProjectProcess's tasksQ already selects('*'),
// so the fix is to stop re-narrowing what's already fully loaded rather than
// growing a second field list that can drift from lib/types.ts's Task.
export type ExplorerTask = Task;

export interface ExplorerPhase {
  key: string;
  label: string;
  /** Localized: Current focus / Active in parallel / Done / Not started */
  state: string;
  isCurrent: boolean;
  isParallel: boolean;
  /** `activated` false = this project has no instance of the template, so
   *  nothing has been decided about the stage. */
  substages: { template: SubstageTemplate; instance: ProjectSubstage | null; activated: boolean }[];
  unactivated: SubstageTemplate[];
  workstreams: Workstream[];
  /** Open tasks mapped to this phase — the "Connected actions" panel. */
  tasks: ExplorerTask[];
}

interface Props {
  projectId: string;
  phases: ExplorerPhase[];
  labels: Record<string, string>;
  /** C4: Project/Phase(filter)/Sub-stage/Workstream/Impact choices for the
   *  mini-task rows' "Edit details…" item — same option-list shape My Work
   *  builds once and threads down to VerbMenu (see task-editor.tsx). */
  editorOptions: TaskEditorOptions;
}

// Noa's full sub-stage lifecycle (spec §ג), in her order.
const STATUSES: ProjectSubstageStatus[] = [
  'upcoming', 'active', 'waiting', 'blocked', 'verify', 'submitted', 'with_city', 'done', 'not_applicable',
];

// Spec §טז semantics: green = progress/done, blue = external waiting,
// red = blocked, amber = verify, gray = upcoming / N-A.
const CHIP: Record<ProjectSubstageStatus, string> = {
  done: 'bg-sage-soft text-sage',
  active: 'bg-sage-soft text-sage',
  waiting: 'bg-mist-soft text-mist',
  submitted: 'bg-mist-soft text-mist',
  with_city: 'bg-mist-soft text-mist',
  blocked: 'bg-coral-soft text-coral',
  verify: 'bg-apricot-soft text-apricot',
  upcoming: 'bg-card2 text-ink3',
  not_applicable: 'bg-card2 text-ink3',
};
const DOT: Record<ProjectSubstageStatus, string> = {
  done: 'bg-sage text-white',
  active: 'bg-sage-soft text-sage',
  waiting: 'bg-mist-soft text-mist',
  submitted: 'bg-mist-soft text-mist',
  with_city: 'bg-mist-soft text-mist',
  blocked: 'bg-coral-soft text-coral',
  verify: 'bg-apricot-soft text-apricot',
  upcoming: 'bg-card2 text-ink3',
  not_applicable: 'bg-card2 text-ink3',
};

// Client-demo mirror: horizontal 5-phase card rail (bottom color strip:
// green = current focus, amber = active in parallel) above a master-detail
// split — numbered sub-stage list on one side, the selected sub-stage's
// status, explanation and connected actions on the other.
export function ProcessExplorer({ projectId, phases, labels, editorOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Selection lives in the URL (checklist C1: a refresh must not lose it) —
  // '' is an unreachable phase key, just a non-undefined fallback for the
  // (never expected in practice) empty-phases case, so TS knows selectedKey
  // is always a plain string.
  const current = phases.find((p) => p.isCurrent)?.key ?? phases[0]?.key ?? '';
  const urlPhase = params.get('phase');
  // A stale/hostile ?phase= (a key that no longer exists) falls back to the
  // project's current phase instead of resolving to `undefined` and blanking
  // the panel — a query string never gets to lie.
  const selectedKey = phases.some((p) => p.key === urlPhase) ? urlPhase! : current;
  const selected = phases.find((p) => p.key === selectedKey) ?? phases[0];

  const firstOpenSub = (phase: ExplorerPhase | undefined) =>
    phase?.substages.find(
      (s) => s.instance && s.instance.status !== 'done' && s.instance.status !== 'not_applicable',
    ) ?? phase?.substages[0] ?? null;
  const firstOpenOf = (key: string) => firstOpenSub(phases.find((p) => p.key === key))?.template.id ?? null;

  const firstOpen = firstOpenSub(selected);
  const urlSub = params.get('sub');
  // Same guard for ?sub=: only honor it when that template actually belongs
  // to the selected phase, otherwise fall back to the phase's first-open item.
  const selectedSubId = urlSub && selected.substages.some((s) => s.template.id === urlSub)
    ? urlSub
    : (firstOpen?.template.id ?? null);
  const selectedSub =
    selected.substages.find((s) => s.template.id === selectedSubId) ??
    firstOpen ?? null;

  // scroll: false — a phase/sub-stage click is a selection change, not a page
  // navigation, so it must not stack a history entry the user has to back out
  // of one at a time.
  const setSel = (phase: string, sub: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.set('phase', phase);
    if (sub) q.set('sub', sub); else q.delete('sub');
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const pickPhase = (key: string) => setSel(key, firstOpenOf(key));

  return (
    <div className="space-y-4">
      {/* Phase rail — her .phase cards: number beside a serif name, state
          line, and an always-visible bottom strip (gray -> green current /
          amber parallel), with a soft ring on the selected card. */}
      {/* Spec §6 wants the five phases in one horizontal row; sm:grid-cols-3
          was breaking them onto two rows on tablet. */}
      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:px-0">
        {phases.map((p, i) => {
          const active = p.key === selectedKey;
          return (
            <li key={p.key} className="min-w-44 flex-1 sm:min-w-0">
              <button
                type="button"
                onClick={() => pickPhase(p.key)}
                aria-current={p.isCurrent ? 'step' : undefined}
                aria-expanded={active}
                className={`relative flex min-h-[78px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[10px] border bg-sk-surface px-4 py-3.5 text-start transition-shadow ${
                  active ? 'border-sage-line shadow-[0_0_0_2px_var(--color-sage-soft)]' : 'border-line hover:border-line2'
                }`}
              >
                <span className="font-mono text-[11px] font-semibold text-sk-muted">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-[650] leading-[1.25] text-sk-ink">{p.label}</span>
                  <span className={`mt-1 block text-[8px] leading-[1.35] ${
                    p.isCurrent ? 'text-sage' : p.isParallel ? 'text-sk-amber' : 'text-sk-muted'
                  }`}>{p.state}</span>
                </span>
                <span aria-hidden="true" className={`absolute bottom-0 start-3 end-3 h-[3px] rounded-t ${
                  p.isCurrent ? 'bg-sage' : p.isParallel ? 'bg-sk-amber-dot' : 'bg-line'
                }`} />
              </button>
            </li>
          );
        })}
      </ol>

      {/* Parallel-workstream notice. Spec §7 places it below the rail and
          above the workspace — "this order is important" — with a circular
          directional badge on the cream ground. */}
      {phases.some((p) => p.isParallel) && labels.parallelNoteTitle && (
        <div className="flex items-start gap-3 rounded-[10px] border border-sk-cream-border bg-sk-cream p-3.5">
          <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-sk-amber-halo text-sk-amber">↔</span>
          <p className="text-[11px] leading-[1.5] text-sk-ink">
            <span className="font-[650]">{labels.parallelNoteTitle}</span>
            <span className="mt-0.5 block text-sk-muted">{labels.parallelNote}</span>
          </p>
        </div>
      )}

      {/* Master-detail — .workspace: ONE joined card, sub-stage list on the
          start side, detail panel on a tinted ground with a divider. */}
      <div className="grid overflow-hidden rounded-[15px] border border-line bg-sk-surface shadow-card lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="p-5 sm:p-6">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{selected.label}</p>
          <h2 className="mt-0.5 text-[22px] font-[650] leading-[1.2] tracking-[-0.025em] text-sk-ink">{labels.substages}</h2>
          {selected.workstreams.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {selected.workstreams.map((w) => (
                <span key={w.id} className="rounded-full bg-apricot-soft px-2 py-0.5 text-[11px] text-apricot">
                  {labels.parallel}: {w.name}
                </span>
              ))}
            </p>
          )}
          {selected.substages.length === 0 ? (
            <p className="mt-3 text-xs text-ink3">{labels.emptyPhase}</p>
          ) : (
            <ul className="mt-3">
              {selected.substages.map(({ template, instance, activated }, idx) => {
                const status: ProjectSubstageStatus = instance?.status ?? 'upcoming';
                // Spec §14: never present every possible stage as Upcoming.
                // With no instance nothing has been decided for this project,
                // so it reads as not activated rather than as a planned step.
                const label = activated ? labels['status.' + status] : labels.notActivated;
                const active = selectedSub?.template.id === template.id;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSel(selectedKey, template.id)}
                      aria-expanded={active}
                      className={`mb-1.5 flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[9px] border px-3 py-3 text-start transition-colors ${
                        active ? 'border-sage-line bg-sk-green-soft' : 'border-transparent bg-sk-surface-soft hover:bg-sk-green-soft/60'
                      }`}
                    >
                      <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold ${DOT[status]}`}>
                        {status === 'done' ? '✓' : idx + 1}
                      </span>
                      {/* Spec §9: allow natural wrapping. These were truncated,
                          so a long sub-stage name or note was unreadable. */}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-[550] leading-[1.35] text-sk-ink">{template.name}</span>
                        {instance?.note && (
                          <span className="block text-[8px] leading-[1.35] text-sk-muted">{instance.note}</span>
                        )}
                      </span>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-[650] ${
                        activated ? CHIP[status] : 'bg-sk-surface-soft text-sk-muted-light'
                      }`}>
                        {label}
                      </span>
                      <span aria-hidden="true" className="text-sk-muted rtl:-scale-x-100">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected.unactivated.length > 0 && (
            <details className="mt-3 border-t border-line2 pt-2">
              <summary className="min-h-11 cursor-pointer py-1 text-xs text-ink3 hover:text-ink sm:min-h-0">{labels.activate}</summary>
              <ul className="mt-1">
                {selected.unactivated.map((template) => (
                  <ActivateRow key={template.id} projectId={projectId} template={template} labels={labels} />
                ))}
              </ul>
            </details>
          )}
        </div>

        {selectedSub && (
          <SubstageDetail
            key={selectedSub.template.id}
            projectId={projectId}
            template={selectedSub.template}
            instance={selectedSub.instance}
            tasks={selected.tasks}
            labels={labels}
            editorOptions={editorOptions}
          />
        )}
      </div>
    </div>
  );
}

function ActivateRow({ projectId, template, labels }: { projectId: string; template: SubstageTemplate; labels: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <li className="flex items-center gap-2 border-b border-line2 px-1 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 text-sm text-ink2">{template.name}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setFailed(false);
          const res = await activateSubstage(projectId, template.id, null);
          if (res?.error) setFailed(true);
        })}
        className="min-h-11 cursor-pointer whitespace-nowrap rounded-full bg-card2 px-2.5 py-1 text-xs text-ink3 ring-line transition-shadow hover:ring-2 disabled:opacity-50 sm:min-h-0"
      >
        {labels.activate}
      </button>
      {failed && <span role="alert" className="text-[11px] text-coral">{labels.error}</span>}
    </li>
  );
}

// Her "SELECTED SUB-STAGE" panel: status chip, name, short explanation,
// the full lifecycle as tappable pills, then the phase's connected actions.
function SubstageDetail({ projectId, template, instance, tasks, labels, editorOptions }: {
  projectId: string;
  template: SubstageTemplate;
  instance: ProjectSubstage | null;
  tasks: ExplorerTask[];
  labels: Record<string, string>;
  editorOptions: TaskEditorOptions;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  // C3: the audit row that reverses the last status change, plus the message
  // the SavedChip shows — same result-chip pattern VerbMenu already uses,
  // reusing A6's SavedChip instead of building a second one.
  const [result, setResult] = useState<{ message: string; undoId: string | null } | null>(null);
  const status: ProjectSubstageStatus = instance?.status ?? 'upcoming';

  // C2: this panel used to list every open task in the whole PHASE — sibling
  // sub-stages' work mixed in, with no cap. selectConnectedTasks (lib/process,
  // tested there) scopes `mine` to tasks actually linked to THIS template;
  // `phaseOnly` is the pre-backfill stand-in (until A6/B1 finish linking
  // tasks, most rows have no substage_template_id at all — without this
  // fallback the panel would go empty for every project).
  const { mine, phaseOnly, shown } = selectConnectedTasks(tasks, template.id);

  const setStatus = (next: ProjectSubstageStatus) => start(async () => {
    setFailed(false);
    if (!instance) {
      const res = await activateSubstage(projectId, template.id, null);
      if ('error' in res) setFailed(true);
      return;
    }
    if (next === status) return;
    // 'error' in res (not res?.error) — the same discriminant applyWorkVerb's
    // callers use, and the one TypeScript can actually narrow on: `undoId`
    // only exists on the ok branch.
    const res = await setSubstageStatus(projectId, instance.id, next);
    if ('error' in res) { setFailed(true); return; }
    setResult({ message: labels['msg.status_changed'], undoId: res.undoId ?? null });
  });

  const undo = () => start(async () => {
    if (!result?.undoId) { setResult(null); return; }
    const res = await undoSubstageChange(result.undoId);
    if ('error' in res) { setFailed(true); return; }
    setResult(null);
  });

  return (
    // Her .detail-panel: tinted ground + start-side divider inside the
    // joined workspace card.
    <div className="border-t border-line bg-sk-detail-surface p-5 sm:p-6 lg:border-s lg:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.selectedSub}</p>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-[650] ${CHIP[status]}`}>
          {labels['status.' + status]}
        </span>
      </div>
      <h2 className="mt-2 text-[22px] font-[650] leading-[1.2] tracking-[-0.025em] text-sk-ink">{template.name}</h2>

      {instance ? (
        <textarea
          defaultValue={instance.note ?? ''}
          rows={2}
          disabled={pending}
          aria-label={labels.notePh}
          placeholder={labels.notePh}
          onBlur={(e) => start(async () => {
            if ((instance.note ?? '') === e.target.value) return;
            setFailed(false);
            const res = await setSubstageNote(projectId, instance.id, e.target.value);
            if (res?.error) setFailed(true);
          })}
          className="mt-2 w-full rounded-lg border border-line2 bg-card2 p-2 text-sm leading-relaxed text-ink outline-none disabled:opacity-50"
        />
      ) : (
        <p className="mt-2 text-xs text-ink3">{labels['status.upcoming']}</p>
      )}

      <div className={`mt-3 flex flex-wrap gap-1.5 ${pending ? 'opacity-50' : ''}`}>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            // Spec §10: small segmented chips that do not overpower the panel.
            // All nine states stay — none is dropped for being absent from a
            // screenshot — and aria-pressed carries the selection.
            className={`min-h-11 cursor-pointer rounded-[7px] px-2 py-1 text-[8px] font-[650] leading-none transition-shadow disabled:opacity-50 sm:min-h-0 ${
              status === s ? `${CHIP[s]} ring-1 ring-current` : 'bg-sk-surface text-sk-muted hover:text-sk-ink'
            }`}
          >
            {labels['status.' + s]}
          </button>
        ))}
      </div>
      {failed && <p role="alert" className="mt-2 text-xs text-coral">{labels.error}</p>}
      {result && (
        <div className="mt-2">
          <SavedChip
            message={result.message}
            undoId={result.undoId}
            pending={pending}
            onUndo={undo}
            onDismiss={() => setResult(null)}
            labels={labels}
          />
        </div>
      )}

      {/* Conditional rule (spec §ד) — outcomes to try, never to apply. */}
      <ScenarioBox
        projectId={projectId}
        substageId={instance?.id ?? null}
        decision={instance?.decision ?? null}
        labels={{
          tryEach: labels.tryEach, add: labels.addDecision, edit: labels.editDecision,
          editKicker: labels.decisionKicker, labelPh: labels.decisionLabelPh,
          optionPh: labels.decisionOptionPh, resultPh: labels.decisionResultPh,
          noResult: labels.decisionNoResult, remove: labels.remove,
          save: labels.save, cancel: labels.cancel, error: labels.error,
        }}
      />

      <div className="mt-4 border-t border-line2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.connectedActions}</p>
          {/* Review round 1: this was still the generic register — scoped to
              match the list right below it, same as "View all" and "Open
              register". Without this, a sub-stage with 1-4 tasks (no cap, so
              no "View all" link) had no scoped link at all. */}
          <a href={`/work?view=all&substage=${template.id}`} className="text-[10px] font-[650] text-sk-green hover:underline">
            {labels.viewRegister} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
          </a>
        </div>
        {mine.length > 0 ? (
          <>
            <ul className="mt-2 space-y-2">
              {shown.map((task) => (
                <ConnectedTaskRow key={task.id} task={task} labels={labels} editorOptions={editorOptions} />
              ))}
            </ul>
            {/* Step 1: the rest of `mine` beyond the 4-item cap is one click
                away, scoped to this sub-stage — not the generic register. */}
            {mine.length > 4 && (
              <a
                href={`/work?view=all&substage=${template.id}`}
                className="mt-2 inline-flex min-h-11 items-center text-[10px] font-[650] text-sk-green hover:underline sm:min-h-0"
              >
                {labels.viewAll.replace('{n}', String(mine.length))} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
              </a>
            )}
          </>
        ) : phaseOnly.length > 0 ? (
          <>
            {/* Nothing is linked to THIS sub-stage yet — the phase's
                unlinked tasks stand in so the panel never reads as empty
                before A6/B1 backfill the links, clearly captioned so it
                isn't mistaken for this sub-stage's own list. */}
            <p className="mt-2 text-[10px] leading-[1.4] text-sk-muted">{labels.phaseLevel}</p>
            <ul className="mt-2 space-y-2">
              {phaseOnly.map((task) => (
                <ConnectedTaskRow key={task.id} task={task} labels={labels} editorOptions={editorOptions} />
              ))}
            </ul>
          </>
        ) : (
          // Spec §11: a compact dashed empty-state panel, not a bare line.
          <p className="mt-2 rounded-[9px] border border-dashed border-line bg-sk-surface px-4 py-4 text-center text-[10px] leading-[1.5] text-sk-muted">
            {labels.noTasksPhase}
          </p>
        )}
      </div>
    </div>
  );
}

// Her .mini-task: status icon square, title, owner · waiting, register link +
// inline Update, blocking chip at the end. Extracted so Step 1's two lists
// (sub-stage-scoped vs. phase-level fallback) render identical rows instead
// of forking the markup.
function ConnectedTaskRow({ task, labels, editorOptions }: { task: ExplorerTask; labels: Record<string, string>; editorOptions: TaskEditorOptions }) {
  return (
    <li className="grid grid-cols-[27px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[10px] border border-line bg-card p-3">
      <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs ${
        task.priority === 'critical' ? 'bg-coral-soft text-coral' : task.waiting_for ? 'bg-mist-soft text-mist' : 'bg-apricot-soft text-apricot'
      }`}>
        {task.priority === 'critical' ? '!' : task.waiting_for ? '…' : '→'}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{task.title}</p>
        {(task.owner || task.waiting_for) && (
          <p className="mt-0.5 truncate text-[11px] text-ink3">
            {task.owner ?? ''}
            {task.owner && task.waiting_for ? ' · ' : ''}
            {task.waiting_for ? `${labels.waitingOn}: ${task.waiting_for}` : ''}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Step 2: deep-linked to the specific record, not the generic
              register — filtered + scrolled + highlighted on arrival. */}
          <a
            href={`/work?view=all&task=${task.id}#task-${task.id}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink2 hover:bg-card2 sm:min-h-7"
          >
            {labels.openRegister}
          </a>
          <VerbMenu taskId={task.id} task={task} editorOptions={editorOptions} labels={labels} />
        </div>
      </div>
      {task.priority === 'critical' && (
        <span className="whitespace-nowrap rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-coral">
          {labels.blocking}
        </span>
      )}
    </li>
  );
}
