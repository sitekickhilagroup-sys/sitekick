import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { verbResultLabels } from '@/lib/i18n/verb-labels';
import { findDuplicatePairs } from '@/lib/dedup';
import { isBlockingTask } from '@/lib/blockers';
import { supabaseServer } from '@/lib/supabase/server';
import { rankToday, scoreTask, type TodayRankContext } from '@/lib/priority';
import { laToday } from '@/lib/date';
import { resolveTaskPhaseKey, resolveTaskSubstageLabel } from '@/lib/task-details';
import { WorkTableRow } from '@/components/work/work-table-row';
import { WORK_COLS } from '@/components/work/work-cols';
import { AddAction } from '@/components/work/add-action';
import { ReopenButton } from '@/components/work/reopen-button';
import { PrioritiesRefresh } from '@/components/work/priorities-refresh';
import { DuplicateReview, type DupPairSide, type DupPairView, type DuplicateReviewLabels } from '@/components/work/duplicate-review';
import { projectColor } from '@/lib/project-color';
import type { RelationRow } from '@/components/work/relation-editor';
import type { TaskEditorOptions } from '@/components/work/task-editor';
import type { Blocker, Invoice, Phase, PhaseKey, Project, ProjectStage, Relationship, SubstageTemplate, Task, TaskRank, Vendor, Workstream } from '@/lib/types';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

// 'completed' (Noa round 3, request #3): recently-closed records with a
// Reopen control — the missing way back after the undo toast expires.
type WorkView = 'today' | 'blocking' | 'followups' | 'waiting' | 'all' | 'completed';
const VIEWS: WorkView[] = ['today', 'blocking', 'followups', 'waiting', 'all', 'completed'];

// View queries (spec §Interfaces) — all operate on already-open tasks. Today
// used to be a case here too (a flat score+slice) — it moved out because
// rankToday() needs business-rank + current-stage context this function
// doesn't receive. See computeView, its replacement for the 'today' view.
function filterView(tasks: Task[], view: Exclude<WorkView, 'today' | 'completed'>, today: string): Task[] {
  switch (view) {
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

// Single source of truth for "what does this view show", for every view
// including today — used for both the tab's count and the rendered list, so
// the two can't drift. (The Blocking tab had exactly that class of mismatch
// before this QA round: the count and the render read different functions.)
function computeView(tasks: Task[], view: Exclude<WorkView, 'completed'>, today: string, todayCtx: TodayRankContext): Task[] {
  return view === 'today' ? rankToday(tasks, todayCtx) : filterView(tasks, view, today);
}

export default async function WorkPage({ searchParams }: PageProps<'/work'>) {
  const sp = await searchParams;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const today = laToday();

  const rawView = typeof sp.view === 'string' ? sp.view : '';
  const view: WorkView = (VIEWS as string[]).includes(rawView) ? (rawView as WorkView) : 'today';
  // C2 deep links from the process page: ?substage= narrows the list to one
  // sub-stage's tasks (validated below, once substage_templates is loaded —
  // an id that matches no real template is dropped, never honored blind);
  // ?task= just marks a row to highlight + anchor-scroll to, so an unknown
  // value is harmless on its own (no row matches, nothing highlights).
  const rawSubstage = typeof sp.substage === 'string' ? sp.substage : '';
  const spTask = typeof sp.task === 'string' ? sp.task : '';
  // Brief §2: category filter — everything / project work / administrative.
  const rawCat = typeof sp.cat === 'string' ? sp.cat : '';
  const cat: 'all' | 'project' | 'admin' = rawCat === 'project' || rawCat === 'admin' ? rawCat : 'all';

  const supabase = await supabaseServer();
  // Relationships ride the same batch (table is small — filter in memory
  // below) so the page costs one database round trip, not two.
  const [tasksQ, projectsQ, blockersQ, proposalsQ, approvedInvoicesQ, relsQ, phasesQ, stageMapQ, projectStagesQ, vendorsQ, substageTemplatesQ, workstreamsQ, closedQ] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open'),
    supabase.from('projects').select('*'),
    supabase.from('blockers').select('*').eq('status', 'active').order('days_stuck', { ascending: false }),
    supabase.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
    supabase.from('invoices').select('amount_usd,vendor_id').eq('status', 'approved'),
    supabase.from('relationships').select('*'),
    // Her table's "Phase / sub-stage" column: task.stage_key -> canonical phase.
    supabase.from('phases').select('*'),
    supabase.from('stage_phase_map').select('*'),
    // Today ranking needs each project's current stage, derived the same way
    // topActions() does it (stages.find(s => s.status === 'current')).
    supabase.from('project_stages').select('*'),
    // Payment Run vendor-group breakdown needs names.
    supabase.from('vendors').select('id,name'),
    // TaskEditor's Sub-stage / Workstream selects (A6) — same batch, no extra round trip.
    supabase.from('substage_templates').select('id,phase_key,name,kind,position'),
    supabase.from('workstreams').select('id,project_id,name'),
    // Completed view (Noa request #3): the 100 most recently touched closed
    // records — done AND dropped, since both closings can be accidental
    // ('merged' stays out; un-merging is the duplicate review's job).
    supabase.from('tasks').select('*').in('status', ['done', 'dropped'])
      .order('last_touched', { ascending: false }).limit(100),
  ]);

  const tasks = (tasksQ.data ?? []) as Task[];
  const closedTasks = (closedQ.data ?? []) as Task[];

  // Latest AI prioritization run (0022) — the suggestion layer: per-project
  // and cross-project ranks plus a grounded reason per task. Two small
  // queries; absent (no run yet) everything below falls back to the
  // deterministic engine exactly as before.
  const { data: latestRunRow } = await supabase.from('priority_runs')
    .select('id,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const { data: prioRows } = latestRunRow
    ? await supabase.from('task_priorities').select('*').eq('run_id', latestRunRow.id)
    : { data: [] as TaskRank[] };
  const aiByTask = new Map(((prioRows ?? []) as TaskRank[]).map((r) => [r.task_id, r]));
  const aiRunAt: string | null = latestRunRow?.created_at ?? null;
  // Full relationship set — needed both here (excluding pairs Noa already
  // told apart via 'unrelated' — see lib/dedup.ts's findDuplicatePairs) and
  // later for unlocksFor's blocks-edge lookup.
  const allRels = (relsQ.data ?? []) as Relationship[];
  // Header claim (below) is computed from this, not asserted — Dor #47 saw
  // "Nothing is duplicated" above a real General/project duplicate pair.
  const dupPairs = findDuplicatePairs(tasks, allRels);
  const projects = (projectsQ.data ?? []) as Project[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const pendingCount = proposalsQ.count ?? 0;
  const approvedInvoices = (approvedInvoicesQ.data ?? []) as Pick<Invoice, 'amount_usd' | 'vendor_id'>[];
  const approvedCount = approvedInvoices.length;
  const approvedTotal = approvedInvoices.reduce((s, i) => s + Number(i.amount_usd), 0);
  // Her Payment Run breakdown: one row per vendor group with count + total.
  const vendorNameById = new Map(((vendorsQ.data ?? []) as Pick<Vendor, 'id' | 'name'>[]).map((v) => [v.id, v.name.trim().replace(/\s+/g, ' ')]));
  const paymentGroups = [...approvedInvoices
    .reduce((m, inv) => {
      const name = inv.vendor_id ? (vendorNameById.get(inv.vendor_id) ?? '—') : '—';
      const g = m.get(name) ?? { vendor: name, count: 0, total: 0 };
      g.count++; g.total += Number(inv.amount_usd);
      m.set(name, g);
      return m;
    }, new Map<string, { vendor: string; count: number; total: number }>())
    .values()].sort((a, b) => b.total - a.total);
  const vendorGroups = paymentGroups.length;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Side-by-side view for the duplicate-review list (DuplicateReview) —
  // resolves each task's project name (or General) once here, server-side,
  // rather than shipping the whole `projects` array to the client.
  const toDupSide = (task: Task): DupPairSide => ({
    id: task.id,
    title: task.title,
    project_id: task.project_id,
    projectName: task.project_id ? (projectNames.get(task.project_id) ?? t('common.general')) : t('common.general'),
    owner: task.owner,
    waiting_for: task.waiting_for,
    due: task.due,
    last_touched: task.last_touched,
  });
  const dupPairViews: DupPairView[] = dupPairs.map(([x, y]) => ({ a: toDupSide(x), b: toDupSide(y) }));

  // Today ranking context: 0015's business_rank per project, plus each
  // project's current stage — same derivation topActions() uses.
  const businessRankByProject = new Map(
    projects.filter((p) => p.business_rank != null).map((p) => [p.id, p.business_rank!]),
  );
  const projectStages = (projectStagesQ.data ?? []) as ProjectStage[];
  const stagesByProject = new Map<string, ProjectStage[]>();
  for (const s of projectStages) {
    const list = stagesByProject.get(s.project_id);
    if (list) list.push(s); else stagesByProject.set(s.project_id, [s]);
  }
  const currentStageByProject = new Map<string, string | null>();
  for (const [pid, stages] of stagesByProject) {
    currentStageByProject.set(pid, stages.find((s) => s.status === 'current')?.stage_key ?? null);
  }
  const todayCtx: TodayRankContext = { today, businessRankByProject, currentStageByProject };

  // Phase / sub-stage column: a task's phase is DERIVED, never stored on
  // tasks.stage_key (that column is the legacy stage tag bridged to phases
  // via stage_phase_map — never a phase_key itself). Precedence matches
  // resolveTaskPhaseKey: the sub-stage it's actually on wins; the legacy
  // stage_key bridge is next; the project's current phase is the last
  // resort. See lib/task-details.ts for why, and app/actions/tasks.ts for
  // why the editor never writes stage_key.
  const phaseLabelByKey = new Map(((phasesQ.data ?? []) as Phase[]).map((ph) => [ph.key as string, ph.label]));
  const phaseKeyByStage = new Map(((stageMapQ.data ?? []) as { stage_key: string; phase_key: PhaseKey }[])
    .map((m) => [m.stage_key, m.phase_key]));
  const substageTemplates = (substageTemplatesQ.data ?? []) as SubstageTemplate[];
  const phaseKeyBySubstageId = new Map(substageTemplates.map((s) => [s.id, s.phase_key]));
  const substageNameById = new Map(substageTemplates.map((s) => [s.id, s.name]));
  // A stale/hostile ?substage= (an id matching no real template) is dropped
  // rather than honored — the same rule process-explorer.tsx applies to its
  // own ?phase=/?sub= — so a bad query string filters nothing instead of
  // silently producing a blank table with no explanation.
  const substageIds = new Set(substageTemplates.map((s) => s.id));
  const spSubstage = rawSubstage && substageIds.has(rawSubstage) ? rawSubstage : '';
  const prettyStage = (key: string) =>
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const phaseLabelFor = (task: Task): string | null => {
    const key = resolveTaskPhaseKey({
      substagePhaseKey: task.substage_template_id ? phaseKeyBySubstageId.get(task.substage_template_id) ?? null : null,
      legacyPhaseKey: task.stage_key ? phaseKeyByStage.get(task.stage_key) ?? null : null,
      projectPhaseKey: task.project_id ? projectById.get(task.project_id)?.current_phase_key ?? null : null,
    });
    return key ? (phaseLabelByKey.get(key) ?? null) : null;
  };
  // C2: the row's sub-stage line used to read `stage_key` only, so
  // re-classifying a task's Sub-stage within the same phase (A6's editor)
  // changed nothing visible here — see resolveTaskSubstageLabel.
  const stageLabelFor = (task: Task): string | null =>
    resolveTaskSubstageLabel({
      substageName: task.substage_template_id ? substageNameById.get(task.substage_template_id) ?? null : null,
      legacyLabel: task.stage_key ? prettyStage(task.stage_key) : null,
    });

  // TaskEditor's option lists (A6). AddAction only ever creates a task
  // against an active project, so it keeps the active-only projectOptions
  // list below unchanged. The editor is different: an already-open task can
  // belong to a project that has since gone inactive (this page still
  // renders that task under the project's name — see the render loop below,
  // which looks projects up with no active filter), so editorOptions gets
  // every project instead, each flagged active/inactive — TaskEditor offers
  // active ones as normal choices and injects the task's own current project
  // even when it's inactive, so its name is never silently hidden.
  const projectOptions = projects.filter((p) => p.active !== false)
    .map((p) => ({ id: p.id, name: p.name, current_phase_key: p.current_phase_key }));
  const editorProjectOptions = projects.map((p) => ({
    id: p.id, name: p.name, current_phase_key: p.current_phase_key, active: p.active !== false,
  }));
  const phaseOptions = ((phasesQ.data ?? []) as Phase[])
    .slice().sort((a, b) => a.position - b.position)
    .map((p) => ({ key: p.key, label: p.label }));
  const substageOptions = substageTemplates
    .slice().sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, phase_key: s.phase_key, name: s.name }));
  const workstreamOptions = ((workstreamsQ.data ?? []) as Pick<Workstream, 'id' | 'project_id' | 'name'>[])
    .map((w) => ({ id: w.id, project_id: w.project_id, name: w.name }));
  const editorOptions: TaskEditorOptions = {
    projects: editorProjectOptions, phases: phaseOptions, substages: substageOptions, workstreams: workstreamOptions,
  };

  // Brief §2: the category filter applies BEFORE the view computation (Dor
  // 8/29: cat=admin on Today showed nothing — it used to narrow Today's
  // already-picked top-8, where admin work rarely ranks; now Today ranks the
  // top of the CHOSEN category). Tab counts above stay whole-register so the
  // numbers keep meaning "everything open".
  const catTasks = cat === 'all' ? tasks : tasks.filter((t) => (t.category ?? 'project') === cat);
  const viewTasks = view === 'completed' ? [] : computeView(catTasks, view, today, todayCtx);
  // ?substage= (the process page's "View all (n)" deep link) narrows
  // whichever view is active down to that one sub-stage's tasks. Validated
  // above, so this only ever narrows to a real (possibly empty) result —
  // never blanks the table because of a bad id — and a legitimately empty
  // result still gets the existing isEmpty/work.empty explanation below.
  const filtered = spSubstage ? viewTasks.filter((t) => t.substage_template_id === spSubstage) : viewTasks;
  // Administrative work renders in its own block (separate rectangles), even
  // when attributed to a project — hidden entirely only by cat=project.
  const adminTasks = cat === 'project' ? [] : filtered.filter((t) => (t.category ?? 'project') === 'admin');
  const projectWorkTasks = cat === 'admin' ? [] : filtered.filter((t) => (t.category ?? 'project') !== 'admin');
  const scoreOf = (task: Task) => scoreTask(task, { today });

  const buildGroups = (list: Task[]) => {
    const m = new Map<string | null, Task[]>();
    for (const task of list) {
      const g = m.get(task.project_id);
      if (g) g.push(task); else m.set(task.project_id, [task]);
    }
    return m;
  };
  const groups = buildGroups(projectWorkTasks);
  const adminGroups = [...buildGroups(adminTasks).entries()];
  // Today orders its project sections by urgency: with an AI run present, the
  // project whose top task is most urgent comes first (Dor: "which project
  // has the most urgent task") — manual pins count as rank 0 so Noa's own
  // order still leads. Without a run, the standing business priority
  // (Blair > San Marco > Rinconia > Alta Mesa) applies as before. Every
  // other view keeps the existing max-score ordering.
  const aiRank = (t: Task) => (t.manual_priority != null ? 0 : aiByTask.get(t.id)?.global_rank ?? 9999);
  const orderedGroups = [...groups.entries()];
  if (view === 'today') {
    if (aiByTask.size > 0) {
      const minRank = (list: Task[]) => Math.min(...list.map(aiRank));
      orderedGroups.sort((a, b) => minRank(a[1]) - minRank(b[1]));
      // Inside a project: pins first (her explicit order), then the agent's
      // project_rank via global order, then rankToday's own sequence.
      for (const [, list] of orderedGroups) {
        list.sort((a, b) => {
          const ma = a.manual_priority ?? Infinity;
          const mb = b.manual_priority ?? Infinity;
          if (ma !== mb) return ma - mb;
          return aiRank(a) - aiRank(b);
        });
      }
      adminGroups.sort((a, b) => Math.min(...a[1].map(aiRank)) - Math.min(...b[1].map(aiRank)));
      for (const [, list] of adminGroups) list.sort((a, b) => aiRank(a) - aiRank(b));
    } else {
      const rankOf = (pid: string | null) => (pid ? businessRankByProject.get(pid) ?? Infinity : Infinity);
      orderedGroups.sort((a, b) => rankOf(a[0]) - rankOf(b[0]));
      adminGroups.sort((a, b) => rankOf(a[0]) - rankOf(b[0]));
      // Intra-group order already reflects rankToday's impact/due weighting —
      // re-sorting here with the plain score would silently undo that.
    }
  } else {
    orderedGroups.sort((a, b) => Math.max(...b[1].map(scoreOf)) - Math.max(...a[1].map(scoreOf)));
    for (const [, list] of orderedGroups) list.sort((a, b) => scoreOf(b) - scoreOf(a));
    adminGroups.sort((a, b) => Math.max(...b[1].map(scoreOf)) - Math.max(...a[1].map(scoreOf)));
    for (const [, list] of adminGroups) list.sort((a, b) => scoreOf(b) - scoreOf(a));
  }

  // Cross-project "most urgent now" strip (Dor: "which tasks are most urgent"
  // across ALL projects): the top of the latest run over currently-open
  // tasks, regardless of which view section they land in.
  const topAcross = view === 'today' && aiByTask.size > 0
    ? tasks
      .filter((t) => aiByTask.has(t.id) && (!t.snoozed_until || t.snoozed_until <= today))
      .sort((a, b) => aiByTask.get(a.id)!.global_rank - aiByTask.get(b.id)!.global_rank)
      .slice(0, 5)
      .map((t) => ({
        task: t,
        ai: aiByTask.get(t.id)!,
        color: projectColor(t.project_id),
        name: t.project_id ? projectNames.get(t.project_id) ?? null : null,
      }))
    : [];

  const isEmpty = view === 'completed'
    ? closedTasks.length === 0
    : view === 'blocking' ? blockers.length === 0 && filtered.length === 0 : filtered.length === 0;

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
  // Numbered from orderedGroups (the final rendered, post business-rank-sort
  // order), not the pre-group `filtered` order: rankToday's fill step can
  // place a project's 3rd pick after other projects' top-2s, which would
  // otherwise print e.g. Blair 01, 02, 07 / San Marco 03, 04 reading down
  // the page — a real number that no longer reads as a clean sequence.
  const rankById = view === 'today'
    ? new Map([...orderedGroups, ...adminGroups].flatMap(([, list]) => list).map((task, i) => [task.id, i + 1]))
    : null;
  const openIds = new Set(tasks.map((task) => task.id));
  const unlocksFor = (taskId: string): string[] =>
    allRels
      .filter((r) => r.from_task_id === taskId && r.type === 'blocks'
        && (r.verified_by || r.manual_override) && openIds.has(r.to_task_id))
      .map((r) => taskTitleById.get(r.to_task_id) ?? '')
      .filter(Boolean)
      .slice(0, 3);
  const whyNowFor = (task: Task): string | null => {
    const parts: string[] = [];
    // The agent's grounded one-liner leads when a run exists — it's the
    // "Claude explains" half of the brief's propose-and-explain loop.
    const ai = aiByTask.get(task.id);
    if (ai?.reason) parts.push(ai.reason);
    // Impact (0013) opens the line when classified — the "documented reason"
    // the QA checklist wants for why this task outranks (or yields to) a sibling.
    if (task.process_impact) parts.push(t('work.why.impact.' + task.process_impact));
    // isBlockingTask, not raw priority — impact classification takes
    // precedence over the legacy heuristic (0013_task_process_impact.sql),
    // and this must agree with the row's own Blocking badge (work-table-row.tsx).
    if (isBlockingTask(task)) parts.push(t('work.blocking'));
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
    // Reused as the per-cell labels below lg, where the column header row is
    // hidden and each field has to name itself.
    colPhase: t('work.col_phase'),
    colOwner: t('work.col_owner'),
    colDue: t('work.col_due'),
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
    // Noa critical #2: the armed second-press labels for the two verbs that
    // close a record.
    'confirm.completed': t('work.verb.confirm_completed'),
    'confirm.not_applicable': t('work.verb.confirm_not_applicable'),
    ...verbResultLabels(t),
    'msg.details': t('work.msg.details'),
    update: t('work.update'),
    // TaskEditor (A6): editDetails is VerbMenu's 8th item; project/general/
    // phase/substage/workstream/impact + the six impact values are the
    // form's field labels and select options. phase reuses review.f_phase
    // (already "Phase"/"שלב") rather than adding a duplicate key.
    editDetails: t('work.edit_details'),
    project: t('common.project'),
    general: t('common.general'),
    waitingOn: t('tasks.waiting'),
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
    category: t('work.category'),
    'category.project': t('work.cat_project'),
    'category.admin': t('work.cat_admin'),
    whyNow: t('work.why_now'),
    urgencyNow: t('work.urgency.now'),
    unlocks: t('work.unlocks'),
    details: t('work.details'),
    evidence: t('work.evidence'),
    relationship: t('work.relationship'),
    recommended: t('work.recommended'),
    blocksAffects: t('work.blocks_affects'),
    needsVerification: t('rel.type.needs_verification'),
    noUnlocks: t('work.no_unlocks'),
    noRel: t('work.no_rel'),
    noEvidence: t('work.no_evidence'),
    confHigh: t('work.conf_high'),
    confMed: t('work.conf_med'),
    confLow: t('work.conf_low'),
    recWaiting: t('work.rec_waiting'),
    recBlocking: t('work.rec_blocking'),
    recComplete: t('work.rec_complete'),
    openProject: t('work.open_project'),
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
  const countOf = (v: Exclude<WorkView, 'completed'>) => computeView(tasks, v, today, todayCtx).length;
  const blockingBreakdown = view === 'blocking'
    ? t('work.blocking_breakdown')
        .replace('{tasks}', String(countOf('blocking')))
        .replace('{blockers}', String(blockers.length))
    : null;
  const viewTabs: { key: WorkView; label: string; sub: string; count: number }[] = [
    { key: 'today', label: t('work.view.today'), sub: t('work.tab_sub.today'), count: countOf('today') },
    { key: 'blocking', label: t('work.view.blocking'), sub: t('work.tab_sub.blocking'), count: countOf('blocking') },
    { key: 'followups', label: t('work.view.followups'), sub: t('work.tab_sub.followups'), count: countOf('followups') },
    { key: 'waiting', label: t('work.view.waiting'), sub: t('work.tab_sub.waiting'), count: countOf('waiting') },
    { key: 'all', label: t('work.view.all'), sub: t('work.tab_sub.all'), count: countOf('all') },
    // Capped at the query's 100 most recent — a recovery view, not an archive.
    { key: 'completed', label: t('work.view.completed'), sub: t('work.tab_sub.completed'), count: closedTasks.length },
  ];

  const activeTab = viewTabs.find((v) => v.key === view);

  // Reused only to fill errorConflict's {type} — markPairNotDuplicate names
  // the conflicting relationship's real type (e.g. 'blocks'), and this is
  // how that becomes the same translated label RelationEditor's own chips
  // already show for it, rather than a second, drifting copy.
  const relTypeLabels: Record<string, string> = {
    blocks: t('rel.type.blocks'),
    supports: t('rel.type.supports'),
    parallel: t('rel.type.parallel'),
    unrelated: t('rel.type.unrelated'),
    needs_verification: t('rel.type.needs_verification'),
    required_for: t('rel.type.required_for'),
    affects: t('rel.type.affects'),
    related: t('rel.type.related'),
    independent: t('rel.type.independent'),
    conditional: t('rel.type.conditional'),
  };

  const dupReviewLabels: DuplicateReviewLabels = {
    warning: t('work.dup_warning'),
    hint: t('work.dup_review_hint'),
    keep: t('work.dup_keep'),
    project: t('common.project'),
    owner: t('tasks.owner'),
    waiting: t('tasks.waiting'),
    due: t('work.col_due'),
    lastTouched: t('work.dup_last_touched'),
    consequence: t('work.dup_consequence'),
    notDuplicateConsequence: t('work.dup_not_duplicate_consequence'),
    merge: t('work.dup_merge'),
    notDuplicate: t('work.dup_not_duplicate'),
    leave: t('work.dup_leave'),
    reason: t('rel.reason'),
    mergedMsg: t('work.dup_merged_msg'),
    notDuplicateMsg: t('work.dup_not_duplicate_msg'),
    recorded: t('work.recorded'),
    undoMerge: t('work.dup_undo_merge'),
    cancel: t('common.cancel'),
    errorSelf: t('work.dup_error_self'),
    errorNotFound: t('work.dup_error_not_found'),
    errorAlreadyMerged: t('work.dup_error_already_merged'),
    errorMasterMerged: t('work.dup_error_master_merged'),
    errorNotMerged: t('work.dup_error_not_merged'),
    errorConflict: t('work.dup_error_conflict'),
    relTypeLabels,
    errorReason: t('work.dup_error_reason'),
  };

  // One project section — shared by the main (project-work) list and the
  // separate administrative block (brief §2's "separate rectangles"). Border
  // and count badge carry the project's identity color (Dor: the red circle
  // stopped meaning anything once every project was blocked).
  const renderGroupSection = ([projectId, groupTasks]: [string | null, Task[]]) => {
    const project = projectId ? projectById.get(projectId) : null;
    const phaseLabel = project?.current_phase_key ? phaseLabelByKey.get(project.current_phase_key) : null;
    const color = projectColor(projectId);
    return (
      <section key={projectId ?? 'none'} className="rounded-[14px] border bg-sk-salmon-surface p-3.5" style={{ borderColor: color.border }}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
          <h2 className="flex items-center gap-2 text-[13px] font-[650] leading-[1.25] text-sk-ink">
            <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: color.solid }} />
            {project?.name ?? t('common.general')}
          </h2>
          {(phaseLabel || project?.city_case) && (
            <span className="text-[10px] leading-[1.35] text-sk-muted">
              {phaseLabel}
              {phaseLabel && project?.city_case ? ' · ' : ''}
              {project?.city_case && <span className="font-mono">{project.city_case}</span>}
            </span>
          )}
          <span className="ms-auto rounded-[6px] px-2 py-1 text-[10px] font-[650] leading-none" style={{ background: color.soft, color: color.text }}>
            {groupTasks.length === 1
              ? t('work.tasks_today_one')
              : t('work.tasks_today_other').replace('{n}', `⁨${groupTasks.length}⁩`)}
          </span>
        </div>
        {/* QA item 04 (Rotem): overflow stays visible so VerbMenu's desktop
            dropdown never clips at the card border. */}
        <div className="mt-2 rounded-[10px] border border-line bg-sk-surface">
          <div className={`hidden ${WORK_COLS} gap-x-4 rounded-t-[9px] border-b border-line bg-sk-surface-header px-3 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-sk-muted lg:grid`}>
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
                urgency={aiByTask.get(task.id)?.urgency}
                whyNow={whyNowFor(task)}
                unlocks={unlocksFor(task.id)}
                relations={relationsFor(task.id)}
                taskOptions={taskOptionsFor(task)}
                editorOptions={editorOptions}
                phaseLabel={phaseLabelFor(task)}
                stageLabel={stageLabelFor(task)}
                highlight={!!spTask && task.id === spTask}
                projectHref={task.project_id ? `/projects/${task.project_id}` : null}
              />
            ))}
          </ul>
        </div>
      </section>
    );
  };

  return (
    <div className="sk-page mx-auto w-full max-w-[1060px] space-y-4 px-2 pb-16 sm:px-4">
      {/* register-hero (centered) + the Add-action button. */}
      <div className="relative pt-2 text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-sk-muted">{t('work.title')}</p>
        <h1 className="mt-1 text-[clamp(26px,2.6vw,30px)] font-[650] leading-[1.1] tracking-[-0.035em] text-sk-ink">
          {t('work.statement')}
        </h1>
        <p className="mx-auto mt-1.5 max-w-xl text-[11px] leading-[1.5] text-sk-muted">
          {t('work.sub')}
          {dupPairs.length === 0 && ` ${t('work.sub_clean')}`}
        </p>
        <div className="mt-3 flex justify-center sm:absolute sm:end-0 sm:top-2 sm:mt-0">
          <AddAction
            projects={projectOptions}
            labels={{
              addAction: t('work.add_action'),
              titlePh: t('work.add_title_ph'),
              project: t('common.project'),
              general: t('common.general'),
              owner: t('tasks.owner'),
              due: t('work.col_due'),
              waiting: t('tasks.waiting'),
              save: t('common.save'),
              cancel: t('common.cancel'),
              error: t('common.error_save'),
              back: t('common.cancel'),
              dupKicker: t('work.dup_kicker'),
              dupTitle: t('work.dup_title'),
              dupSub: t('work.dup_sub'),
              dupSame: t('work.dup_same'),
              dupNew: t('work.dup_new'),
            }}
          />
        </div>
      </div>

      {/* Unconditional — DuplicateReview must stay mounted even once the
          server reports zero pairs, so a resolved outcome (and a merge's
          only Undo control) can't be torn down by the very revalidation its
          own write triggers. See the component's own doc comment. */}
      <DuplicateReview pairs={dupPairViews} labels={dupReviewLabels} />

      {pendingCount > 0 && (
        <Link
          href="/inbox"
          className="flex min-h-11 items-center rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-sm text-apricot hover:underline"
        >
          {t('inbox.title')} · {pendingCount}
        </Link>
      )}

      {/* Her .management-cards: big count, view name, one-line meaning. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {viewTabs.map(({ key, label, sub, count }) => (
          <Link
            key={key}
            href={`/work?view=${key}`}
            aria-current={view === key ? 'page' : undefined}
            className={`rounded-[14px] border px-3.5 py-3 transition-colors ${
              view === key
                ? 'border-sage-line bg-sk-green-soft-strong shadow-[0_0_0_2px_var(--color-sage-soft)]'
                : 'border-line bg-sk-surface hover:border-line2'
            }`}
          >
            <span className={`block text-[23px] font-[650] leading-none tracking-[-0.02em] ${view === key ? 'text-sage' : 'text-sk-ink'}`}>
              {count}
            </span>
            <span className="mt-1 block text-[10px] font-[650] text-sk-ink">{label}</span>
            <span className="mt-0.5 block text-[10px] leading-[1.4] text-sk-muted">{sub}</span>
          </Link>
        ))}
      </div>

      {/* Her .register-context strip. */}
      {activeTab && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[10px] bg-sk-surface-soft px-4 py-2.5">
          <span className="text-[13px] font-[650] text-sk-ink">{activeTab.label}</span>
          <span className="text-[11px] leading-[1.5] text-sk-muted">{blockingBreakdown ?? activeTab.sub}</span>
          {/* Brief §2: everything / project work / administrative. */}
          {view !== 'completed' && (
            <span className="flex items-center gap-1">
              {(['all', 'project', 'admin'] as const).map((k) => (
                <Link
                  key={k}
                  href={`/work?view=${view}${k === 'all' ? '' : `&cat=${k}`}`}
                  aria-current={cat === k ? 'page' : undefined}
                  className={`min-h-6 rounded-full border px-2.5 py-0.5 text-[10px] font-[650] ${
                    cat === k ? 'border-sage-line bg-sage-soft text-sage' : 'border-line bg-card text-ink2 hover:border-sage-line'
                  }`}
                >
                  {t(`work.cat_${k}`)}
                </Link>
              ))}
            </span>
          )}
          <span className="ms-auto text-[11px] leading-[1.5] text-sk-muted">{t('work.one_record')}</span>
        </div>
      )}

      {/* Cross-project urgency strip (brief §3–4 + Dor's ask): the agent's
          top-5 across every project, each with its project color and the
          reason it leads — plus the on-demand re-rank. */}
      {view === 'today' && (
        <section className="rounded-[14px] border border-sage-line bg-sk-surface p-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-sk-ink">{t('work.ai_top')}</h2>
            <span className="text-[10px] leading-[1.4] text-sk-muted">
              {aiRunAt ? t('work.ai_updated').replace('{when}', fmtDate(aiRunAt.slice(0, 10))) : t('work.ai_none')}
            </span>
            <span className="ms-auto">
              <PrioritiesRefresh labels={{
                refresh: t('work.ai_refresh'),
                running: t('work.ai_running'),
                done: t('work.ai_done'),
                error: t('common.error_save'),
              }} />
            </span>
          </div>
          {topAcross.length > 0 && (
            <ol className="mt-2.5 space-y-1.5">
              {topAcross.map(({ task, ai, color, name }, i) => {
                const rendered = rankById?.has(task.id) ?? false;
                const href = rendered ? `#task-${task.id}` : `/work?view=all&task=${task.id}#task-${task.id}`;
                const chip = ai.urgency === 'now' ? 'bg-coral-soft text-coral'
                  : ai.urgency === 'high' ? 'bg-apricot-soft text-apricot'
                    : ai.urgency === 'medium' ? 'bg-mist-soft text-mist' : 'bg-inset text-ink3';
                return (
                  <li key={task.id}>
                    <Link href={href} className="flex min-h-11 items-center gap-3 rounded-[10px] border border-line bg-card px-3 py-2 hover:border-sage-line">
                      <span className="font-mono text-[12px] font-[650] text-sk-muted">{String(i + 1).padStart(2, '0')}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5">
                          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full" style={{ background: color.solid }} />
                          <span className="truncate text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: color.text }}>
                            {name ?? t('common.general')}
                          </span>
                        </span>
                        <span className="truncate text-[12px] font-[650] text-sk-ink">{task.title}</span>
                        {ai.reason && <span className="truncate text-[10px] leading-[1.4] text-sk-muted">{ai.reason}</span>}
                      </span>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${chip}`}>
                        {t(`work.urgency.${ai.urgency}`)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

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
        // Her .payment-run: collapsible aggregate with per-vendor rows
        // linking into Invoices — one payment task, full detail behind it.
        <details className="rounded-[10px] border border-sage-line bg-sk-green-soft-strong">
          {/* Spec §6: circular icon, name and metadata, then the amount in its
              own cell toward the end, expand control last. */}
          <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[36px_minmax(0,1fr)_auto_20px] items-center gap-3 p-4">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sage font-mono text-sm text-white">$</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-[650] text-sk-ink">{t('work.payment_run')}</span>
              <span className="mt-0.5 block text-[10px] leading-[1.4] text-sk-muted">
                {t('work.payment_run_sub')
                  .replace('{n}', String(approvedCount))
                  .replace('{total}', approvedTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))}
                {' · '}{t('work.payment_groups').replace('{n}', String(vendorGroups))}
              </span>
            </span>
            <b className="whitespace-nowrap font-mono text-[13px] font-[650] text-sk-ink">
              {t('work.payment_open_total').replace(
                '{total}',
                approvedTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
              )}
            </b>
            <span aria-hidden="true" className="justify-self-end text-[16px] font-[650] leading-none text-sage">+</span>
          </summary>
          <div className="space-y-1.5 border-t border-sage-line/50 p-3">
            {paymentGroups.map((g) => (
              <Link
                key={g.vendor}
                href={`/invoices?status=approved&vendor=${encodeURIComponent(g.vendor)}`}
                className="flex min-h-11 items-center gap-3 rounded-[10px] border border-line bg-card px-3 py-2 hover:border-sage-line"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{g.vendor}</span>
                  <span className="block text-[11px] text-ink3">
                    {t('invoices.open_total').replace('{n}', `⁨${g.count}⁩`)}
                  </span>
                </span>
                <span className="font-mono text-sm text-ink">
                  {g.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </span>
                <span aria-hidden="true" className="text-ink3 rtl:-scale-x-100">→</span>
              </Link>
            ))}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href="/invoices" className="inline-flex min-h-11 items-center px-1 text-xs text-mist hover:underline sm:min-h-0">
                {t('work.open_invoices')} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
              </Link>
              <Link href="/invoices?tab=payment_summary" className="inline-flex min-h-11 items-center px-1 text-xs text-mist hover:underline sm:min-h-0">
                {t('work.open_payment_summary')} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
              </Link>
            </div>
          </div>
        </details>
      )}

      {isEmpty ? (
        <p className="rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{t('work.empty')}</p>
      ) : view === 'completed' ? (
        // Noa request #3: the recovery list — recently closed records, newest
        // first, each with the way back. Flat (no project grouping): the
        // question here is "what closed lately", not "what does each project owe".
        <ul className="rounded-[10px] border border-line bg-sk-surface">
          {closedTasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line2 px-3 py-3 last:border-b-0">
              <span className={`whitespace-nowrap rounded-[6px] px-2 py-1 text-[9px] font-[650] uppercase tracking-[0.06em] leading-none ${
                task.status === 'done' ? 'bg-sage text-white' : 'bg-card2 text-ink3'
              }`}>
                {task.status === 'done' ? t('work.closed_done') : t('work.closed_dropped')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-[650] leading-[1.4] text-sk-ink">{task.title}</span>
                <span className="block text-[10px] text-sk-muted">
                  {task.project_id ? (projectNames.get(task.project_id) ?? t('common.general')) : t('common.general')}
                  {task.last_touched ? ` · ${fmtDate(task.last_touched)}` : ''}
                  {task.owner ? ` · ${task.owner}` : ''}
                </span>
              </span>
              <ReopenButton
                taskId={task.id}
                labels={{
                  reopen: t('work.reopen'),
                  reopened: t('work.reopened_msg'),
                  undo: t('work.undo'),
                  cancel: t('common.cancel'),
                  error: t('common.error_save'),
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {orderedGroups.map(renderGroupSection)}
          {/* Brief §2: administrative tasks get their own rectangles, apart
              from project work — visible on "all", alone on cat=admin,
              hidden (not deleted) on cat=project. */}
          {adminGroups.length > 0 && (
            <section className="rounded-[16px] border border-line bg-sk-surface-soft p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pb-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-sk-ink">{t('work.admin_section')}</h2>
                <span className="text-[10px] leading-[1.4] text-sk-muted">{t('work.admin_section_sub')}</span>
              </div>
              <div className="space-y-3">{adminGroups.map(renderGroupSection)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
