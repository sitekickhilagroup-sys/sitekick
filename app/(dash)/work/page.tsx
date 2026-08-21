import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { scoreTask } from '@/lib/priority';
import { laToday } from '@/lib/date';
import { WorkTableRow } from '@/components/work/work-table-row';
import type { RelationRow } from '@/components/work/relation-editor';
import type { Blocker, Invoice, Phase, Project, Relationship, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

type WorkView = 'today' | 'blocking' | 'followups' | 'waiting' | 'all';
const VIEWS: WorkView[] = ['today', 'blocking', 'followups', 'waiting', 'all'];

// View queries (spec §Interfaces) — all operate on already-open tasks.
function filterView(tasks: Task[], view: WorkView, today: string): Task[] {
  switch (view) {
    case 'today':
      // Spec §ז: Today is 5-8 real actions, not every open task.
      return [...tasks]
        .filter((t) => !t.snoozed_until || t.snoozed_until <= today)
        .sort((a, b) => scoreTask(b, { today }) - scoreTask(a, { today }))
        .slice(0, 8);
    case 'blocking':
      return tasks.filter((t) => t.priority === 'critical');
    case 'followups':
      return tasks.filter(
        (t) => (!!t.follow_up_date && t.follow_up_date <= today) || (!!t.check_back_on && t.check_back_on <= today),
      );
    case 'waiting':
      return tasks.filter((t) => !!t.waiting_for);
    case 'all':
      return tasks;
  }
}

export default async function WorkPage({ searchParams }: PageProps<'/work'>) {
  const sp = await searchParams;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const today = laToday();

  const rawView = typeof sp.view === 'string' ? sp.view : '';
  const view: WorkView = (VIEWS as string[]).includes(rawView) ? (rawView as WorkView) : 'today';

  const supabase = await supabaseServer();
  // Relationships ride the same batch (table is small — filter in memory
  // below) so the page costs one database round trip, not two.
  const [tasksQ, projectsQ, blockersQ, proposalsQ, approvedInvoicesQ, relsQ, phasesQ, stageMapQ] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open'),
    supabase.from('projects').select('*'),
    supabase.from('blockers').select('*').eq('status', 'active').order('days_stuck', { ascending: false }),
    supabase.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
    supabase.from('invoices').select('amount_usd,vendor_id').eq('status', 'approved'),
    supabase.from('relationships').select('*'),
    // Her table's "Phase / sub-stage" column: task.stage_key -> canonical phase.
    supabase.from('phases').select('*'),
    supabase.from('stage_phase_map').select('*'),
  ]);

  const tasks = (tasksQ.data ?? []) as Task[];
  const projects = (projectsQ.data ?? []) as Project[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const pendingCount = proposalsQ.count ?? 0;
  const approvedInvoices = (approvedInvoicesQ.data ?? []) as Pick<Invoice, 'amount_usd' | 'vendor_id'>[];
  const approvedCount = approvedInvoices.length;
  const approvedTotal = approvedInvoices.reduce((s, i) => s + Number(i.amount_usd), 0);
  const vendorGroups = new Set(approvedInvoices.map((i) => i.vendor_id ?? '—')).size;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Phase / sub-stage column: stage_key -> canonical phase via stage_phase_map;
  // unmapped tasks fall back to their project's current phase.
  const phaseLabelByKey = new Map(((phasesQ.data ?? []) as Phase[]).map((ph) => [ph.key as string, ph.label]));
  const phaseKeyByStage = new Map(((stageMapQ.data ?? []) as { stage_key: string; phase_key: string }[])
    .map((m) => [m.stage_key, m.phase_key]));
  const prettyStage = (key: string) =>
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const phaseLabelFor = (task: Task): string | null => {
    const mapped = task.stage_key ? phaseKeyByStage.get(task.stage_key) : null;
    const key = mapped ?? (task.project_id ? projectById.get(task.project_id)?.current_phase_key : null);
    return key ? (phaseLabelByKey.get(key) ?? null) : null;
  };

  const filtered = filterView(tasks, view, today);
  const scoreOf = (task: Task) => scoreTask(task, { today });

  const groups = new Map<string | null, Task[]>();
  for (const task of filtered) {
    const list = groups.get(task.project_id);
    if (list) list.push(task);
    else groups.set(task.project_id, [task]);
  }
  const orderedGroups = [...groups.entries()].sort(
    (a, b) => Math.max(...b[1].map(scoreOf)) - Math.max(...a[1].map(scoreOf)),
  );
  for (const [, list] of orderedGroups) list.sort((a, b) => scoreOf(b) - scoreOf(a));

  const isEmpty = view === 'blocking' ? blockers.length === 0 && filtered.length === 0 : filtered.length === 0;

  // Relationships for the tasks actually listed on this view — already
  // fetched in the batch above; a task can be the "from" or "to" side.
  const listedIds = new Set(filtered.map((t) => t.id));
  const relationships = ((relsQ.data ?? []) as Relationship[]).filter(
    (r) => listedIds.has(r.from_task_id) || listedIds.has(r.to_task_id),
  );
  const taskTitleById = new Map(tasks.map((t) => [t.id, t.title]));
  const tasksByProject = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const list = tasksByProject.get(t.project_id);
    if (list) list.push(t);
    else tasksByProject.set(t.project_id, [t]);
  }
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
  const taskOptionsFor = (task: Task) =>
    (tasksByProject.get(task.project_id) ?? [])
      .filter((t) => t.id !== task.id)
      .map((t) => ({ id: t.id, title: t.title }));

  // Spec §ז+§ט: Today shows a clear numeric rank plus "Why now" and "What
  // this unlocks" on every task — all derived from real records, no guesses.
  const rankById = view === 'today' ? new Map(filtered.map((task, i) => [task.id, i + 1])) : null;
  const openIds = new Set(tasks.map((task) => task.id));
  const allRels = (relsQ.data ?? []) as Relationship[];
  const unlocksFor = (taskId: string): string[] =>
    allRels
      .filter((r) => r.from_task_id === taskId && r.type === 'blocks'
        && (r.verified_by || r.manual_override) && openIds.has(r.to_task_id))
      .map((r) => taskTitleById.get(r.to_task_id) ?? '')
      .filter(Boolean)
      .slice(0, 3);
  const whyNowFor = (task: Task): string | null => {
    const parts: string[] = [];
    if (task.priority === 'critical') parts.push(t('work.blocking'));
    if (task.due && task.due < today) parts.push(t('work.due.overdue'));
    else if (task.due === today) parts.push(t('work.due.now'));
    if ((task.follow_up_date && task.follow_up_date <= today) || (task.check_back_on && task.check_back_on <= today)) {
      parts.push(t('work.why.followup'));
    }
    if (task.waiting_for) parts.push(`${t('tasks.waiting')}: ${task.waiting_for}`);
    return parts.length ? parts.join(' · ') : null;
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
    whyNow: t('work.why_now'),
    unlocks: t('work.unlocks'),
    details: t('work.details'),
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

  // Per-view counts + one-line meaning — her demo's tab anatomy.
  const countOf = (v: WorkView) => (v === 'blocking'
    ? filterView(tasks, v, today).length + blockers.length
    : filterView(tasks, v, today).length);
  const viewTabs: { key: WorkView; label: string; sub: string; count: number }[] = [
    { key: 'today', label: t('work.view.today'), sub: t('work.tab_sub.today'), count: countOf('today') },
    { key: 'blocking', label: t('work.view.blocking'), sub: t('work.tab_sub.blocking'), count: countOf('blocking') },
    { key: 'followups', label: t('work.view.followups'), sub: t('work.tab_sub.followups'), count: countOf('followups') },
    { key: 'waiting', label: t('work.view.waiting'), sub: t('work.tab_sub.waiting'), count: countOf('waiting') },
    { key: 'all', label: t('work.view.all'), sub: t('work.tab_sub.all'), count: countOf('all') },
  ];

  return (
    <div className="space-y-4 pb-16">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('work.title')}</p>
        <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('work.statement')}</h1>
        <p className="mt-1 text-sm text-ink3">{t('work.sub')}</p>
      </div>

      {pendingCount > 0 && (
        <Link
          href="/inbox"
          className="flex min-h-11 items-center rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-sm text-apricot hover:underline"
        >
          {t('inbox.title')} · {pendingCount}
        </Link>
      )}

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
        {viewTabs.map(({ key, label, sub, count }) => (
          <Link
            key={key}
            href={`/work?view=${key}`}
            aria-current={view === key ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 flex-col justify-center whitespace-nowrap rounded-xl px-4 py-1.5 ${
              view === key ? 'bg-ink text-bg' : 'bg-card2 text-ink2 hover:text-ink'
            }`}
          >
            <span className="text-sm font-medium">
              {label} <span className={view === key ? 'opacity-70' : 'text-ink3'}>{count}</span>
            </span>
            <span className={`text-[10px] ${view === key ? 'opacity-70' : 'text-ink3'}`}>{sub}</span>
          </Link>
        ))}
      </div>

      {view === 'blocking' && blockers.length > 0 && (
        <div className="space-y-3">
          {blockers.map((b) => (
            <article key={b.id} className="rounded-(--radius-card) border border-coral/25 bg-card p-4 shadow-card">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-ink2">{projectNames.get(b.project_id) ?? ''}</p>
                <span className="whitespace-nowrap rounded-full bg-coral-soft px-2 py-0.5 text-xs text-coral">
                  {t('overview.stuck_days').replace('{n}', String(b.days_stuck))}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-snug text-ink">{b.what}</p>
              <p className="mt-2 text-xs text-ink3">
                <span className="font-medium text-ink2">{t('overview.blocked_by')}:</span> {b.blocked_by}
              </p>
              {b.suggested_action && (
                <p className="mt-1 rounded-lg bg-apricot-soft px-2.5 py-1.5 text-xs text-ink2">
                  <span className="font-medium">{t('overview.suggested')}:</span> {b.suggested_action}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {view === 'today' && approvedCount > 0 && (
        <Link
          href="/invoices?status=approved"
          className="block rounded-(--radius-card) border border-sage-line bg-sage-soft p-4 hover:opacity-90"
        >
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage font-mono text-sm text-white">$</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{t('work.payment_run')}</span>
              <span className="mt-0.5 block text-xs text-ink2">
                {t('work.payment_run_sub')
                  .replace('{n}', String(approvedCount))
                  .replace('{total}', approvedTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))}
                {' · '}{t('work.payment_groups').replace('{n}', String(vendorGroups))}
              </span>
            </span>
          </div>
        </Link>
      )}

      {isEmpty ? (
        <p className="rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{t('work.empty')}</p>
      ) : (
        orderedGroups.map(([projectId, groupTasks]) => {
          const project = projectId ? projectById.get(projectId) : null;
          const phaseLabel = project?.current_phase_key ? phaseLabelByKey.get(project.current_phase_key) : null;
          return (
            <section key={projectId ?? 'none'}>
              {/* Her group header: name + phase · case + count. */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
                <h2 className="text-sm font-semibold text-ink">
                  {project?.name ?? t('common.general')}
                </h2>
                {(phaseLabel || project?.city_case) && (
                  <span className="font-mono text-[11px] text-ink3">
                    {[phaseLabel, project?.city_case].filter(Boolean).join(' · ')}
                  </span>
                )}
                <span className="ms-auto text-[11px] text-ink3">
                  {t('work.today_n').replace('{n}', String(groupTasks.length))}
                </span>
              </div>
              <div className="mt-2 rounded-(--radius-card) border border-line bg-card shadow-card">
                <div className="hidden grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1.1fr)] gap-x-4 border-b border-line bg-card2/60 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-ink3 lg:grid">
                  <span>{t('work.col_what')}</span>
                  <span>{t('work.col_phase')}</span>
                  <span>{t('work.col_owner')}</span>
                  <span>{t('work.col_due')}</span>
                  <span className="text-end">{t('work.col_status')}</span>
                </div>
                <ul>
                  {groupTasks.map((task) => (
                    <WorkTableRow
                      key={task.id}
                      task={task}
                      labels={rowLabels}
                      today={today}
                      rank={rankById?.get(task.id)}
                      whyNow={whyNowFor(task)}
                      unlocks={unlocksFor(task.id)}
                      relations={relationsFor(task.id)}
                      taskOptions={taskOptionsFor(task)}
                      phaseLabel={phaseLabelFor(task)}
                      stageLabel={task.stage_key ? prettyStage(task.stage_key) : null}
                    />
                  ))}
                </ul>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
