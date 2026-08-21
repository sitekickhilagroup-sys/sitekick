import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { laToday } from '@/lib/date';
import { getProjectProcess } from '@/lib/process';
import { ProcessExplorer, type ExplorerPhase } from '@/components/process/process-explorer';
import { SummaryEditor } from '@/components/process/summary-editor';
import { PhaseSwitcher } from '@/components/process/phase-switcher';
import { InferButton } from '@/components/process/infer-button';
import { WorkRow } from '@/components/work/work-row';
import { type RelationRow } from '@/components/work/relation-editor';
import type { Relationship } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function ProjectProcessPage({ params }: PageProps<'/projects/[id]'>) {
  const { id } = await params;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  const supabase = await supabaseServer();
  const today = laToday();
  // Relationships fetched alongside the process batch (no second round trip)
  // — the table is small, so we take it whole and filter to listed tasks.
  const [{ project, phaseViews, tasksByPhase, unmappedTasks, unactivatedByPhase }, relsQ, projectsQ] = await Promise.all([
    getProjectProcess(supabase, id),
    supabase.from('relationships').select('*'),
    supabase.from('projects').select('*').order('name'),
  ]);
  if (!project) notFound();
  // Inactive projects (spec §ו: Flicker) stay out of the switcher pills, but a
  // direct link to their process page still works — keep the current one visible.
  const allProjects = ((projectsQ.data ?? []) as { id: string; name: string; active?: boolean }[])
    .filter((p) => p.active !== false || p.id === id);

  const allTasks = [...tasksByPhase.values()].flat().concat(unmappedTasks);
  const listedIds = new Set(allTasks.map((t) => t.id));
  const relationships = ((relsQ.data ?? []) as Relationship[]).filter(
    (r) => listedIds.has(r.from_task_id) || listedIds.has(r.to_task_id),
  );
  const taskTitleById = new Map(allTasks.map((t) => [t.id, t.title]));
  const taskOptions = allTasks.map((t) => ({ id: t.id, title: t.title }));
  const relationsFor = (taskId: string): RelationRow[] =>
    relationships
      .filter((r) => r.from_task_id === taskId || r.to_task_id === taskId)
      .map((r) => {
        const direction: 'from' | 'to' = r.from_task_id === taskId ? 'from' : 'to';
        const otherId = direction === 'from' ? r.to_task_id : r.from_task_id;
        return { rel: r, otherTitle: taskTitleById.get(otherId) ?? '', direction };
      })
      // Drop edges to a task we can't resolve a title for (closed or
      // otherwise not loaded on this page) — a nameless chip is worse than none.
      .filter((row) => row.otherTitle);
  const taskOptionsFor = (taskId: string) => taskOptions.filter((o) => o.id !== taskId);

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

  return (
    <div className="space-y-6 pb-16">
      {/* Project switcher — her demo's top pills; jump between process pages. */}
      <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
        {allProjects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            aria-current={p.id === project.id ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 py-1 text-sm sm:min-h-0 ${
              p.id === project.id ? 'bg-ink text-bg' : 'bg-card2 text-ink2 hover:text-ink'
            }`}
          >
            {p.name}
          </Link>
        ))}
      </nav>
      <div>
        <p className="text-sm text-ink3">{t('process.title')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-2xl text-ink sm:text-3xl">{project.name}</h1>
          {project.city_case && (
            <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
              project.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-card2 text-ink3'
            }`}>
              <bdi>{project.city_on_hold ? `${project.city_case} · ${t('rails.on_hold')}` : project.city_case}</bdi>
            </span>
          )}
        </div>
        <div className="mt-2">
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
          <p className="text-sm text-ink3">
            <span className="font-medium text-ink3">{t('process.current')}:</span>{' '}
            <span className="text-ink">{currentPhaseView?.phase.label ?? '—'}</span>
            {activeWorkstreams.length > 0 && (
              <span className="text-ink3"> + {activeWorkstreams.map((w) => w.name).join(', ')}</span>
            )}
          </p>
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

      {activeWorkstreams.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-(--radius-card) border border-mist/25 bg-mist-soft p-3.5">
          <span aria-hidden="true" className="mt-0.5 text-mist">↔</span>
          <p className="text-sm text-ink">
            <span className="font-medium">{t('process.parallel_note_title')}</span>
            <span className="block text-xs text-ink2">{t('process.parallel_note')}</span>
          </p>
        </div>
      )}

      <ProcessExplorer
        projectId={project.id}
        labels={labels}
        phases={phaseViews.map((view, idx): ExplorerPhase => ({
          key: view.phase.key,
          label: view.phase.label,
          state: phaseStateFor(view.phase.key, idx),
          isCurrent: view.phase.key === project.current_phase_key,
          isParallel: parallelKeys.has(view.phase.key),
          substages: view.substages,
          unactivated: unactivatedByPhase.get(view.phase.key) ?? [],
          workstreams: view.workstreams,
        }))}
      />

      <div>
        <p className="text-sm text-ink3">{t('process.connected')}</p>
        {allTasks.length === 0 && (
          <p className="mt-2 rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">
            {t('process.no_connected')}
          </p>
        )}
        <div className="mt-2 space-y-5">
          {phaseViews.map((view) => {
            const tasks = tasksByPhase.get(view.phase.key) ?? [];
            if (tasks.length === 0) return null;
            return (
              <section key={view.phase.key}>
                <h2 className="text-sm font-medium text-ink2">{view.phase.label}</h2>
                <ul className="mt-2 divide-y divide-line2 rounded-(--radius-card) border border-line bg-card shadow-card">
                  {tasks.map((task) => (
                    <WorkRow
                      key={task.id}
                      task={task}
                      labels={rowLabels}
                      today={today}
                      relations={relationsFor(task.id)}
                      taskOptions={taskOptionsFor(task.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {unmappedTasks.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-ink2">{t('process.unmapped')}</h2>
              <ul className="mt-2 divide-y divide-line2 rounded-(--radius-card) border border-line bg-card shadow-card">
                {unmappedTasks.map((task) => (
                  <WorkRow
                    key={task.id}
                    task={task}
                    labels={rowLabels}
                    today={today}
                    relations={relationsFor(task.id)}
                    taskOptions={taskOptionsFor(task.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
