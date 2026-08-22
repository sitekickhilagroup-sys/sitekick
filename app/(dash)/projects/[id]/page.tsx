import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { verbResultLabels } from '@/lib/i18n/verb-labels';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectProcess } from '@/lib/process';
import { ProcessExplorer, type ExplorerPhase } from '@/components/process/process-explorer';
import { SummaryEditor } from '@/components/process/summary-editor';
import { PhaseSwitcher } from '@/components/process/phase-switcher';
import { InferButton } from '@/components/process/infer-button';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function ProjectProcessPage({ params }: PageProps<'/projects/[id]'>) {
  const { id } = await params;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  const supabase = await supabaseServer();
  const [{ project, phaseViews, tasksByPhase, unactivatedByPhase }, projectsQ] = await Promise.all([
    getProjectProcess(supabase, id),
    supabase.from('projects').select('*').order('name'),
  ]);
  if (!project) notFound();
  // Inactive projects (spec §ו: Flicker) stay out of the switcher pills, but a
  // direct link to their process page still works — keep the current one visible.
  const allProjects = ((projectsQ.data ?? []) as { id: string; name: string; active?: boolean }[])
    .filter((p) => p.active !== false || p.id === id);

  const currentPhaseView = phaseViews.find((v) => v.phase.key === project.current_phase_key);
  const activeWorkstreams = phaseViews.flatMap((v) => v.workstreams).filter((w) => w.status === 'active');

  const labels: Record<string, string> = {
    parallel: t('process.parallel'),
    activate: t('process.activate'),
    emptyPhase: t('process.empty_phase'),
    error: t('common.error_save'),
    'status.upcoming': t('process.status.upcoming'),
    'status.active': t('process.status.active'),
    'status.done': t('process.status.done'),
    'status.not_applicable': t('process.status.not_applicable'),
    'status.waiting': t('process.status.waiting'),
    'status.blocked': t('process.status.blocked'),
    'status.verify': t('process.status.verify'),
    'status.submitted': t('process.status.submitted'),
    'status.with_city': t('process.status.with_city'),
    substages: t('process.substages'),
    selectedSub: t('process.selected_sub'),
    connectedActions: t('process.connected_actions'),
    viewRegister: t('process.view_register'),
    notePh: t('process.note_ph'),
    noTasksPhase: t('process.no_tasks_phase'),
    blocking: t('work.blocking'),
    waitingOn: t('tasks.waiting'),
    openRegister: t('process.open_register'),
    // Conditional-rule explorer (her .scenario-box)
    tryEach: t('process.try_each'),
    addDecision: t('process.add_decision'),
    editDecision: t('process.edit_decision'),
    decisionKicker: t('process.decision_kicker'),
    decisionLabelPh: t('process.decision_label_ph'),
    decisionOptionPh: t('process.decision_option_ph'),
    decisionResultPh: t('process.decision_result_ph'),
    decisionNoResult: t('process.decision_no_result'),
    remove: t('rel.remove'),
    save: t('common.save'),
    cancel: t('common.cancel'),
  };

  const rowLabels = {
    dueNow: t('work.due.now'),
    dueOverdue: t('work.due.overdue'),
    blocking: t('work.blocking'),
    owner: t('tasks.owner'),
    fromSource: t('actions.from_source'),
    waiting: t('work.verb.waiting'),
    editWaiting: t('actions.edit_waiting'),
    save: t('common.save'),
    cancel: t('common.cancel'),
    errorSave: t('common.error_save'),
    completed: t('work.verb.completed'),
    sent_email: t('work.verb.sent_email'),
    delayed: t('work.verb.delayed'),
    scheduled: t('work.verb.scheduled'),
    not_applicable: t('work.verb.not_applicable'),
    note: t('work.verb.note'),
    ...verbResultLabels(t),
    update: t('work.update'),
    title: t('rel.title'),
    add: t('rel.add'),
    pickTask: t('rel.pick_task'),
    relEmpty: t('rel.empty'),
    reason: t('rel.reason'),
    remove: t('rel.remove'),
    error: t('common.error_save'),
    'rel.type.blocks': t('rel.type.blocks'),
    'rel.type.supports': t('rel.type.supports'),
    'rel.type.parallel': t('rel.type.parallel'),
    'rel.type.unrelated': t('rel.type.unrelated'),
    'rel.type.needs_verification': t('rel.type.needs_verification'),
    'rel.blocks_this': t('rel.blocks_this'),
    'rel.blocked_by_this': t('rel.blocked_by_this'),
  };

  const currentIdx = phaseViews.findIndex((v) => v.phase.key === project.current_phase_key);
  const parallelKeys = new Set<string>(activeWorkstreams.map((w) => w.phase_key));
  const phaseStateFor = (key: string, idx: number) =>
    key === project.current_phase_key ? t('process.state.current')
    : parallelKeys.has(key) ? t('process.state.parallel')
    : currentIdx >= 0 && idx < currentIdx ? t('process.state.done')
    : t('process.state.upcoming');

  // "Current position" card copy — "Plan Check + Planning in parallel".
  const parallelPhaseLabels = [...new Set(activeWorkstreams.map((w) =>
    phaseViews.find((v) => v.phase.key === w.phase_key)?.phase.label ?? w.name,
  ))].filter((l) => l !== currentPhaseView?.phase.label);
  const positionText = currentPhaseView
    ? parallelPhaseLabels.length > 0
      ? t('process.in_parallel').replace('{a}', currentPhaseView.phase.label).replace('{b}', parallelPhaseLabels.join(', '))
      : currentPhaseView.phase.label
    : '—';

  return (
    <div className="space-y-5 pb-16">
      {/* Project switcher — her demo's top pills (active = white + sage ring). */}
      <nav aria-label={t('process.project')} className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
        <span className="me-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{t('process.project')}</span>
        {allProjects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            aria-current={p.id === project.id ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-1 text-xs sm:min-h-0 ${
              p.id === project.id
                ? 'border-sage bg-card font-medium text-sage shadow-card'
                : 'border-line bg-card2 text-ink2 hover:text-ink'
            }`}
          >
            {p.name}
          </Link>
        ))}
      </nav>

      {/* Her "PROJECT CONTROL CENTER" header: display name + case chip +
          summary line, with the Current-position card floated at the end. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('process.control_center')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl text-ink sm:text-4xl">{project.name}</h1>
            {project.city_case && (
              <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                project.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-card2 text-ink3'
              }`}>
                <bdi>{project.city_on_hold ? `${project.city_case} · ${t('rails.on_hold')}` : project.city_case}</bdi>
              </span>
            )}
          </div>
          <div className="mt-1.5 max-w-2xl">
            <SummaryEditor
              projectId={project.id}
              value={project.summary}
              placeholder={t('process.summary_ph')}
              editTitle={t('process.summary_edit')}
              saveLabel={t('common.save')}
              cancelLabel={t('common.cancel')}
              errorLabel={t('common.error_save')}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <PhaseSwitcher
              key={project.current_phase_key ?? 'none'}
              projectId={project.id}
              phases={phaseViews.map((v) => v.phase)}
              current={project.current_phase_key}
              label={t('process.current')}
              errorLabel={t('common.error_save')}
            />
            <InferButton
              projectId={project.id}
              label={t('process.infer')}
              doneLabel={t('process.infer_done')}
              sameLabel={t('process.infer_same')}
              errorLabel={t('common.error_save')}
            />
          </div>
        </div>
        {/* Her .health-card: pulse dot with a soft halo; hidden on small screens. */}
        <aside className="hidden items-center gap-3 rounded-[14px] border border-line bg-card px-4.5 py-3.5 shadow-card md:flex">
          <span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${
            activeWorkstreams.length > 0
              ? 'bg-apricot shadow-[0_0_0_5px_var(--color-apricot-soft)]'
              : 'bg-sage shadow-[0_0_0_5px_var(--color-sage-soft)]'
          }`} />
          <span>
            <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-ink3">{t('portfolio.position')}</span>
            <span className="mt-0.5 block text-[13px] font-semibold text-ink">{positionText}</span>
          </span>
        </aside>
      </div>

      {activeWorkstreams.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-(--radius-card) border border-apricot/30 bg-apricot-soft p-3.5">
          <span aria-hidden="true" className="mt-0.5 text-apricot">↔</span>
          <p className="text-sm text-ink">
            <span className="font-medium">{t('process.parallel_note_title')}</span>
            <span className="block text-xs text-ink2">{t('process.parallel_note')}</span>
          </p>
        </div>
      )}

      <ProcessExplorer
        projectId={project.id}
        labels={{ ...rowLabels, ...labels }}
        phases={phaseViews.map((view, idx): ExplorerPhase => ({
          key: view.phase.key,
          label: view.phase.label,
          state: phaseStateFor(view.phase.key, idx),
          isCurrent: view.phase.key === project.current_phase_key,
          isParallel: parallelKeys.has(view.phase.key),
          substages: view.substages,
          unactivated: unactivatedByPhase.get(view.phase.key) ?? [],
          workstreams: view.workstreams,
          tasks: (tasksByPhase.get(view.phase.key) ?? []).map((task) => ({
            id: task.id, title: task.title, owner: task.owner,
            waiting_for: task.waiting_for, priority: task.priority,
          })),
        }))}
      />

    </div>
  );
}
