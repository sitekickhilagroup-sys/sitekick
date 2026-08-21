'use client';

import { useState, useTransition } from 'react';
import { activateSubstage, setSubstageNote, setSubstageStatus } from '@/app/actions/process';
import { VerbMenu } from '@/components/work/verb-menu';
import type { ProjectSubstage, ProjectSubstageStatus, SubstageTemplate, Workstream } from '@/lib/types';

export interface ExplorerTask {
  id: string;
  title: string;
  owner: string | null;
  waiting_for: string | null;
  priority: string;
}

export interface ExplorerPhase {
  key: string;
  label: string;
  /** Localized: Current focus / Active in parallel / Done / Not started */
  state: string;
  isCurrent: boolean;
  isParallel: boolean;
  substages: { template: SubstageTemplate; instance: ProjectSubstage | null }[];
  unactivated: SubstageTemplate[];
  workstreams: Workstream[];
  /** Open tasks mapped to this phase — the "Connected actions" panel. */
  tasks: ExplorerTask[];
}

interface Props {
  projectId: string;
  phases: ExplorerPhase[];
  labels: Record<string, string>;
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
export function ProcessExplorer({ projectId, phases, labels }: Props) {
  const current = phases.find((p) => p.isCurrent)?.key ?? phases[0]?.key;
  const [selectedKey, setSelectedKey] = useState(current);
  const selected = phases.find((p) => p.key === selectedKey) ?? phases[0];

  const firstOpen = selected.substages.find(
    (s) => s.instance && s.instance.status !== 'done' && s.instance.status !== 'not_applicable',
  ) ?? selected.substages[0] ?? null;
  const [selectedSubId, setSelectedSubId] = useState<string | null>(firstOpen?.template.id ?? null);
  const selectedSub =
    selected.substages.find((s) => s.template.id === selectedSubId) ??
    firstOpen ?? null;

  const pickPhase = (key: string) => {
    setSelectedKey(key);
    const phase = phases.find((p) => p.key === key);
    const first = phase?.substages.find(
      (s) => s.instance && s.instance.status !== 'done' && s.instance.status !== 'not_applicable',
    ) ?? phase?.substages[0];
    setSelectedSubId(first?.template.id ?? null);
  };

  return (
    <div className="space-y-4">
      {/* Phase rail — her .phase cards: number beside a serif name, state
          line, and an always-visible bottom strip (gray -> green current /
          amber parallel), with a soft ring on the selected card. */}
      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
        {phases.map((p, i) => {
          const active = p.key === selectedKey;
          return (
            <li key={p.key} className="min-w-44 flex-1 sm:min-w-0">
              <button
                type="button"
                onClick={() => pickPhase(p.key)}
                aria-current={p.isCurrent ? 'step' : undefined}
                aria-expanded={active}
                className={`relative flex min-h-[78px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[13px] border bg-card px-4 py-3.5 text-start transition-shadow ${
                  active ? 'border-sage-line shadow-[0_0_0_2px_var(--color-sage-soft)]' : 'border-line hover:border-line2'
                }`}
              >
                <span className="font-mono text-[11px] font-semibold text-ink3">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block truncate font-serif text-[15px] text-ink">{p.label}</span>
                  <span className={`mt-1 block text-[10px] ${
                    p.isCurrent ? 'text-sage' : p.isParallel ? 'text-apricot' : 'text-ink3'
                  }`}>{p.state}</span>
                </span>
                <span aria-hidden="true" className={`absolute bottom-0 start-3 end-3 h-[3px] rounded-t ${
                  p.isCurrent ? 'bg-sage' : p.isParallel ? 'bg-apricot' : 'bg-line'
                }`} />
              </button>
            </li>
          );
        })}
      </ol>

      {/* Master-detail — her .workspace: ONE joined card, sub-stage list on
          the start side, detail panel on a tinted ground with a divider. */}
      <div className="grid overflow-hidden rounded-2xl border border-line bg-card shadow-card lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{selected.label}</p>
          <h2 className="mt-0.5 font-serif text-2xl text-ink">{labels.substages}</h2>
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
              {selected.substages.map(({ template, instance }, idx) => {
                const status: ProjectSubstageStatus = instance?.status ?? 'upcoming';
                const active = selectedSub?.template.id === template.id;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSubId(template.id)}
                      aria-expanded={active}
                      className={`mb-1.5 flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[11px] border px-3 py-3 text-start transition-colors ${
                        active ? 'border-sage-line bg-sage-soft' : 'border-transparent bg-card2/60 hover:bg-sage-soft/60'
                      }`}
                    >
                      <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold ${DOT[status]}`}>
                        {status === 'done' ? '✓' : idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{template.name}</span>
                        {instance?.note && (
                          <span className="block truncate text-[11px] text-ink3">{instance.note}</span>
                        )}
                      </span>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${CHIP[status]}`}>
                        {labels['status.' + status]}
                      </span>
                      <span aria-hidden="true" className="text-ink3 rtl:-scale-x-100">›</span>
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
function SubstageDetail({ projectId, template, instance, tasks, labels }: {
  projectId: string;
  template: SubstageTemplate;
  instance: ProjectSubstage | null;
  tasks: ExplorerTask[];
  labels: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const status: ProjectSubstageStatus = instance?.status ?? 'upcoming';

  const setStatus = (next: ProjectSubstageStatus) => start(async () => {
    setFailed(false);
    const res = instance
      ? next === status ? null : await setSubstageStatus(projectId, instance.id, next)
      : await activateSubstage(projectId, template.id, null);
    if (res?.error) setFailed(true);
  });

  return (
    // Her .detail-panel: tinted ground + start-side divider inside the
    // joined workspace card.
    <div className="border-t border-line bg-inset p-5 sm:p-6 lg:border-s lg:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.selectedSub}</p>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${CHIP[status]}`}>
          {labels['status.' + status]}
        </span>
      </div>
      <h2 className="mt-2 font-serif text-2xl text-ink">{template.name}</h2>

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
            className={`min-h-11 cursor-pointer rounded-full px-2.5 py-1 text-xs transition-shadow disabled:opacity-50 sm:min-h-0 ${
              status === s ? `${CHIP[s]} ring-1 ring-current` : 'bg-card2 text-ink3 hover:text-ink'
            }`}
          >
            {labels['status.' + s]}
          </button>
        ))}
      </div>
      {failed && <p role="alert" className="mt-2 text-xs text-coral">{labels.error}</p>}

      <div className="mt-4 border-t border-line2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.connectedActions}</p>
          <a href="/work?view=all" className="text-[11px] text-mist hover:underline">
            {labels.viewRegister} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
          </a>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-2 text-xs text-ink3">{labels.noTasksPhase}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {tasks.slice(0, 4).map((task) => (
              // Her .mini-task: status icon square, title, owner · waiting,
              // register link + inline Update, blocking chip at the end.
              <li key={task.id} className="grid grid-cols-[27px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[10px] border border-line bg-card p-3">
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
                    <a href="/work?view=all" className="inline-flex min-h-11 items-center rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink2 hover:bg-card2 sm:min-h-7">
                      {labels.openRegister}
                    </a>
                    <VerbMenu taskId={task.id} labels={labels} />
                  </div>
                </div>
                {task.priority === 'critical' && (
                  <span className="whitespace-nowrap rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-coral">
                    {labels.blocking}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
