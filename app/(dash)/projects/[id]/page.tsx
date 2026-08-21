import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectProcess } from '@/lib/process';
import { PhaseColumn } from '@/components/process/phase-column';
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
  // Relationships fetched alongside the process batch (no second round trip)
  // — the table is small, so we take it whole and filter to listed tasks.
  const [{ project, phaseViews, tasksByPhase, unmappedTasks, unactivatedByPhase }, relsQ] = await Promise.all([
    getProjectProcess(supabase, id),
    supabase.from('relationships').select('*'),
  ]);
  if (!project) notFound();

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
  };

  const rowLabels = {
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

  return (
    <div className="space-y-6 pb-16">
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

      <div>
        <div className="grid gap-3 lg:grid-cols-5">
          {phaseViews.map((view) => (
            <PhaseColumn
              key={view.phase.key}
              projectId={project.id}
              view={view}
              isCurrent={view.phase.key === project.current_phase_key}
              unactivated={unactivatedByPhase.get(view.phase.key) ?? []}
              labels={labels}
            />
          ))}
        </div>
      </div>

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
