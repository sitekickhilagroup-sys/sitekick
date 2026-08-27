import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { verbResultLabels } from '@/lib/i18n/verb-labels';
import { supabaseServer } from '@/lib/supabase/server';
import { getProjectProcess } from '@/lib/process';
import { orderProjectsByRtiProgress } from '@/lib/project-order';
import { ProcessExplorer, type ExplorerPhase } from '@/components/process/process-explorer';
import { SummaryEditor } from '@/components/process/summary-editor';
import { PhaseSwitcher } from '@/components/process/phase-switcher';
import { InferButton } from '@/components/process/infer-button';
import type { TaskEditorOptions } from '@/components/work/task-editor';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function ProjectProcessPage({ params }: PageProps<'/projects/[id]'>) {
  const { id } = await params;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  const supabase = await supabaseServer();
  const [{ project, phaseViews, tasksByPhase, unactivatedByPhase, templates, workstreams }, projectsQ, allInstancesQ] = await Promise.all([
    getProjectProcess(supabase, id),
    supabase.from('projects').select('*').order('name'),
    // Q12: every project's sub-stage instances, so the switcher can order
    // projects by real progress toward RTI (getProjectProcess only fetches
    // this project's own instances).
    supabase.from('project_substages').select('*'),
  ]);
  if (!project) notFound();
  const allProjectRows = (projectsQ.data ?? []) as Project[];
  // Q12 (Noa): pills run most-advanced-first — closest to RTI leads.
  const orderedRows = orderProjectsByRtiProgress(
    allProjectRows,
    phaseViews.map((v) => v.phase),
    templates,
    allInstancesQ.data ?? [],
  );
  // Inactive projects (spec §ו: Flicker) stay out of the switcher pills, but a
  // direct link to their process page still works — keep the current one visible.
  const allProjects = orderedRows.filter((p) => p.active !== false || p.id === id);

  const currentPhaseView = phaseViews.find((v) => v.phase.key === project.current_phase_key);
  const activeWorkstreams = phaseViews.flatMap((v) => v.workstreams).filter((w) => w.status === 'active');

  // C4: TaskEditor's option lists (A6). projectsQ (above) already selects
  // every project — same shape My Work's own editorProjectOptions uses,
  // unfiltered by `active` so an already-open task that belongs to an
  // inactive project still shows its real name instead of vanishing behind
  // a filtered-out select. phases/substages/workstreams ride
  // getProjectProcess's own query batch (lib/process.ts already fetches the
  // full sub-stage template library and — as of C4 — every project's
  // workstreams for exactly this reason) — none of the four lists costs an
  // extra round trip.
  const editorOptions: TaskEditorOptions = {
    projects: allProjectRows.map((p) => ({
      id: p.id, name: p.name, current_phase_key: p.current_phase_key, active: p.active !== false,
    })),
    phases: phaseViews.map((v) => ({ key: v.phase.key, label: v.phase.label })),
    substages: templates.slice().sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, phase_key: s.phase_key, name: s.name })),
    workstreams: workstreams.map((w) => ({ id: w.id, project_id: w.project_id, name: w.name })),
  };

  const labels: Record<string, string> = {
    parallel: t('process.parallel'),
    // Rendered by ProcessExplorer, below the phase rail (spec §7).
    parallelNoteTitle: t('process.parallel_note_title'),
    parallelNote: t('process.parallel_note'),
    activate: t('process.activate'),
    emptyPhase: t('process.empty_phase'),
    error: t('common.error_save'),
    'status.upcoming': t('process.status.upcoming'),
    // Shown instead of a status when this project has no instance of the
    // template — nothing decided, rather than planned-and-upcoming.
    notActivated: t('process.status.not_activated'),
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
    // C2: the capped-list "View all (n)" link, and the caption over the
    // pre-backfill phase-level fallback list (see SubstageDetail).
    viewAll: t('process.view_all'),
    phaseLevel: t('process.phase_level'),
    notePh: t('process.note_ph'),
    noTasksPhase: t('process.no_tasks_phase'),
    // C3: the SavedChip shown after a sub-stage status change (A6's chip,
    // reused rather than rebuilt — see SubstageDetail in process-explorer).
    'msg.status_changed': t('process.msg.status_changed'),
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
    'msg.details': t('work.msg.details'),
    update: t('work.update'),
    // TaskEditor (A6, wired here by C4): editDetails is VerbMenu's 8th item;
    // project/general/phase/substage/workstream/impact + the six impact
    // values are the form's field labels and select options — the exact set
    // work/page.tsx's own rowLabels already carries, reused verbatim so the
    // two pages can't drift on wording. phase reuses review.f_phase (already
    // "Phase"/"שלב") rather than adding a duplicate key.
    editDetails: t('work.edit_details'),
    project: t('common.project'),
    general: t('common.general'),
    waitingOn: t('tasks.waiting'),
    colDue: t('work.col_due'),
    phase: t('review.f_phase'),
    substage: t('work.substage'),
    workstream: t('work.workstream'),
    impact: t('work.impact'),
    'impact.primary_blocker': t('work.why.impact.primary_blocker'),
    'impact.workstream_blocker': t('work.why.impact.workstream_blocker'),
    'impact.future_gate': t('work.why.impact.future_gate'),
    'impact.external_gate': t('work.why.impact.external_gate'),
    'impact.not_blocking': t('work.why.impact.not_blocking'),
    'impact.verify': t('work.why.impact.verify'),
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
    <div className="sk-page space-y-5 pb-16">
      {/* Project switcher. Spec §3 inverts what was here: the active pill is
          the pale-green one, not the white one. */}
      <nav aria-label={t('process.project')} className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
        <span className="me-1 text-[9px] font-bold uppercase tracking-[0.13em] text-sk-muted">{t('process.project')}</span>
        {allProjects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            aria-current={p.id === project.id ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 py-1 text-[11px] sm:min-h-0 ${
              p.id === project.id
                ? 'border-sage-line bg-sk-green-soft font-[650] text-sk-green'
                : 'border-line bg-sk-surface text-sk-muted hover:text-sk-ink'
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
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('process.control_center')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-[clamp(27px,3vw,32px)] font-[650] leading-[1.08] tracking-[-0.035em] text-sk-ink">{project.name}</h1>
            {project.city_case && (
              <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                project.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-card2 text-ink3'
              }`}>
                <bdi>{project.city_on_hold ? `${project.city_case} · ${t('rails.on_hold')}` : project.city_case}</bdi>
              </span>
            )}
          </div>
          {/* C5: substage_templates/phase keys are a GLOBAL library (lib/process.ts
              — not scoped per project), and every editor below seeds local state
              from props at mount time (draft text, an uncontrolled select's
              defaultValue, a last-action result message). None of that resets on
              its own just because the props changed — React only remounts (and
              re-seeds) when a component's `key` changes. A project switch whose
              new current phase / first-open sub-stage template happens to match
              the previous project's (e.g. two untouched projects both sitting on
              Planning step 1) left these components unmounted-in-place — still
              showing, or for the summary draft about to overwrite, the OLD
              project's data. Every child here now keys off project.id so a
              project switch always remounts them. */}
          <div className="mt-1.5 max-w-2xl">
            <SummaryEditor
              key={project.id}
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
              key={`${project.id}:${project.current_phase_key ?? 'none'}`}
              projectId={project.id}
              phases={phaseViews.map((v) => v.phase)}
              current={project.current_phase_key}
              label={t('process.current')}
              errorLabel={t('common.error_save')}
            />
            <InferButton
              key={project.id}
              projectId={project.id}
              label={t('process.infer')}
              doneLabel={t('process.infer_done')}
              sameLabel={t('process.infer_same')}
              errorLabel={t('common.error_save')}
            />
          </div>
        </div>
        {/* .health-card: pulse dot with a soft halo. It used to be md:flex-only,
            which hid the project's current position on phones — spec §16 wants
            it beneath the summary on mobile, not gone. */}
        <aside className="flex items-center gap-3 rounded-[15px] border border-line bg-sk-surface px-4.5 py-3.5 shadow-card">
          <span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${
            activeWorkstreams.length > 0
              ? 'bg-sk-amber-dot shadow-[0_0_0_5px_var(--color-sk-amber-halo)]'
              : 'bg-sage shadow-[0_0_0_5px_var(--color-sage-soft)]'
          }`} />
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-sk-muted">{t('portfolio.position')}</span>
            <span className="mt-0.5 block text-[10px] font-[650] leading-[1.35] text-sk-ink">{positionText}</span>
          </span>
        </aside>
      </div>

      {/* The parallel-workstream notice used to render here, above the phase
          rail. Spec §7 puts it below the rail — "this order is important" —
          and the rail lives inside ProcessExplorer, so the notice moved there
          with it. Only its two strings travel via labels. */}
      <ProcessExplorer
        key={project.id}
        projectId={project.id}
        labels={{ ...rowLabels, ...labels }}
        editorOptions={editorOptions}
        phases={phaseViews.map((view, idx): ExplorerPhase => ({
          key: view.phase.key,
          label: view.phase.label,
          state: phaseStateFor(view.phase.key, idx),
          isCurrent: view.phase.key === project.current_phase_key,
          isParallel: parallelKeys.has(view.phase.key),
          substages: view.substages,
          unactivated: unactivatedByPhase.get(view.phase.key) ?? [],
          workstreams: view.workstreams,
          // ExplorerTask is the full Task (C4) — already on every row from
          // getProjectProcess's tasksQ (select('*')), so no re-projection
          // and no new query needed to feed TaskEditor's form.
          tasks: tasksByPhase.get(view.phase.key) ?? [],
        }))}
      />

    </div>
  );
}
