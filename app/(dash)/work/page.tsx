import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { scoreTask } from '@/lib/priority';
import { laToday } from '@/lib/date';
import { WorkRow } from '@/components/work/work-row';
import type { RelationRow } from '@/components/work/relation-editor';
import type { Blocker, Invoice, Project, Relationship, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

type WorkView = 'today' | 'blocking' | 'followups' | 'waiting' | 'all';
const VIEWS: WorkView[] = ['today', 'blocking', 'followups', 'waiting', 'all'];

// View queries (spec §Interfaces) — all operate on already-open tasks.
function filterView(tasks: Task[], view: WorkView, today: string): Task[] {
  switch (view) {
    case 'today':
      return [...tasks]
        .filter((t) => !t.snoozed_until || t.snoozed_until <= today)
        .sort((a, b) => scoreTask(b, { today }) - scoreTask(a, { today }))
        .slice(0, 15);
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
  const [tasksQ, projectsQ, blockersQ, proposalsQ, approvedInvoicesQ] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open'),
    supabase.from('projects').select('id,name'),
    supabase.from('blockers').select('*').eq('status', 'active').order('days_stuck', { ascending: false }),
    supabase.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
    supabase.from('invoices').select('amount_usd').eq('status', 'approved'),
  ]);

  const tasks = (tasksQ.data ?? []) as Task[];
  const projects = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const pendingCount = proposalsQ.count ?? 0;
  const approvedInvoices = (approvedInvoicesQ.data ?? []) as Pick<Invoice, 'amount_usd'>[];
  const approvedCount = approvedInvoices.length;
  const approvedTotal = approvedInvoices.reduce((s, i) => s + Number(i.amount_usd), 0);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

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

  // Relationships for the tasks actually listed on this view — two .in()
  // queries (a task can be the "from" or "to" side) merged + deduped by id.
  const listedIds = filtered.map((t) => t.id);
  const [relFromQ, relToQ] = await Promise.all([
    listedIds.length
      ? supabase.from('relationships').select('*').in('from_task_id', listedIds)
      : Promise.resolve({ data: [] as Relationship[] }),
    listedIds.length
      ? supabase.from('relationships').select('*').in('to_task_id', listedIds)
      : Promise.resolve({ data: [] as Relationship[] }),
  ]);
  const relById = new Map<string, Relationship>();
  for (const r of [...(relFromQ.data ?? []), ...(relToQ.data ?? [])] as Relationship[]) relById.set(r.id, r);
  const relationships = [...relById.values()];
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

  const rowLabels = {
    owner: t('tasks.owner'),
    fromSource: t('actions.from_source'),
    waiting: t('work.verb.waiting'),
    editWaiting: t('actions.edit_waiting'),
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

  const viewTabs: { key: WorkView; label: string }[] = [
    { key: 'today', label: t('work.view.today') },
    { key: 'blocking', label: t('work.view.blocking') },
    { key: 'followups', label: t('work.view.followups') },
    { key: 'waiting', label: t('work.view.waiting') },
    { key: 'all', label: t('work.view.all') },
  ];

  return (
    <div className="space-y-4 pb-16">
      <h1 className="font-serif text-3xl text-ink">{t('work.title')}</h1>
      <p className="mt-1 text-sm text-ink3">{t('work.sub')}</p>

      {pendingCount > 0 && (
        <Link
          href="/inbox"
          className="block rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-sm text-apricot hover:underline"
        >
          {t('inbox.title')} · {pendingCount}
        </Link>
      )}

      <div className="flex gap-1 overflow-x-auto">
        {viewTabs.map(({ key, label }) => (
          <Link
            key={key}
            href={`/work?view=${key}`}
            aria-current={view === key ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm sm:min-h-0 ${
              view === key ? 'bg-ink text-bg' : 'bg-card2 text-ink2 hover:text-ink'
            }`}
          >
            {label}
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
          <p className="text-sm font-medium text-ink">{t('work.payment_run')}</p>
          <p className="mt-1 text-xs text-ink2">
            {t('work.payment_run_sub')
              .replace('{n}', String(approvedCount))
              .replace('{total}', approvedTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))}
          </p>
        </Link>
      )}

      {isEmpty ? (
        <p className="rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{t('work.empty')}</p>
      ) : (
        orderedGroups.map(([projectId, groupTasks]) => (
          <section key={projectId ?? 'none'}>
            <h2 className="text-sm font-medium text-ink2">
              {projectId ? (projectNames.get(projectId) ?? '') : t('common.all')}
            </h2>
            <ul className="mt-2 divide-y divide-line2 rounded-(--radius-card) border border-line bg-card shadow-card">
              {groupTasks.map((task) => (
                <WorkRow
                  key={task.id}
                  task={task}
                  labels={rowLabels}
                  relations={relationsFor(task.id)}
                  taskOptions={taskOptionsFor(task)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
