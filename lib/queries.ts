import { supabaseServer } from './supabase/server.ts';
import { followUpAlerts, topActions } from './priority.ts';
import { laToday } from './date.ts';
import type {
  Action, Blocker, Decision, Invoice, Phase, Project, ProjectEvent, ProjectStage,
  Relationship, StageRequirement, SubstageCatalogRow, Task, Workstream,
} from './types.ts';

export interface ProjectView extends Project {
  stages: (ProjectStage & { requirements: StageRequirement[] })[];
  events: ProjectEvent[];
}

// One portfolio card's worth of "where does this project stand" — Sprint C
// Task 5. mainBlocker reuses the already-fetched blockers array (no extra
// query/re-scoring); nextAction comes from an uncapped topActions() pass so
// it isn't starved by the global top-8 cut used for `actions`/Top Actions.
export interface PortfolioEntry {
  project: Project;
  currentPhaseLabel: string | null;
  workstreams: Workstream[];
  mainBlocker: Blocker | null;
  nextAction: Action | null;
  /** Second-ranked action — the card's "Then" line. */
  thenAction: Action | null;
  /** Active blockers on this project — the "N blocking" chip. */
  blockingCount: number;
  /** Latest evidence date we hold for this project (newest event), or null. */
  lastEvidence: string | null;
  /** Phase keys lit by active parallel workstreams (rail coloring). */
  parallelPhaseKeys: string[];
  /** Honest derived state: on_hold > at_risk (blockers) > waiting > on_track. */
  riskState: 'on_hold' | 'at_risk' | 'waiting' | 'on_track';
}

export interface OverviewData {
  projects: ProjectView[];
  tasks: Task[];
  blockers: Blocker[];
  decisions: Decision[];
  actions: Action[];
  followUps: Task[];
  substages: Record<string, string[]>;
  openMoney: { project: string | null; open_usd: number }[];
  rowanQueue: { count: number; total_usd: number };
  pendingProposals: number;
  portfolio: PortfolioEntry[];
  /** Portfolio-intelligence insight cards — derived, never fabricated. */
  insights: {
    timeLost: { project: string; text: string; days: number } | null;
    staleWait: { project: string; title: string; who: string; days: number } | null;
  };
  today: string;
}

export async function getOverviewData(): Promise<OverviewData> {
  const supabase = await supabaseServer();
  const [
    projectsQ, stagesQ, reqsQ, eventsQ, tasksQ, blockersQ, decisionsQ, invoicesQ, catalogQ, relationshipsQ,
    phasesQ, workstreamsQ, pendingProposalsQ,
  ] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    supabase.from('project_stages').select('*').order('position'),
    supabase.from('stage_requirements').select('*').order('position'),
    // Newest 400 only — this table grows with every ingested email/import,
    // and the overview payload must not grow with it. Reversed below so the
    // rails timeline still renders oldest -> newest.
    supabase.from('project_events').select('*').order('created_at', { ascending: false }).limit(400),
    // Only open tasks are ever rendered/scored — don't ship done/dropped history.
    supabase.from('tasks').select('*').eq('status', 'open').order('created_at'),
    supabase.from('blockers').select('*').eq('status', 'active').order('days_stuck', { ascending: false }),
    supabase.from('decisions').select('*').order('created_at', { ascending: false }).limit(30),
    // Overview only charts open money + the Rowan queue.
    supabase.from('invoices').select('project_id,status,amount_usd').in('status', ['received', 'for_rowan_approval', 'approved']),
    supabase.from('substage_catalog').select('*').order('position'),
    // Feeds the priority engine's "unlocks" bonus — only blocking edges matter there.
    supabase.from('relationships').select('*').eq('type', 'blocks'),
    // Portfolio cards (Sprint C, Task 5): phase catalog for currentPhaseLabel
    // + only the active parallel workstreams (done ones don't belong on a
    // live status card).
    supabase.from('phases').select('*'),
    supabase.from('workstreams').select('*').eq('status', 'active').order('name'),
    // Head count only — the inbox banner just needs "is there anything to review".
    supabase.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('state', 'pending'),
  ]);

  const projects = (projectsQ.data ?? []) as Project[];
  const stages = (stagesQ.data ?? []) as ProjectStage[];
  const requirements = (reqsQ.data ?? []) as StageRequirement[];
  const events = ((eventsQ.data ?? []) as ProjectEvent[]).reverse();
  const tasks = (tasksQ.data ?? []) as Task[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const decisions = (decisionsQ.data ?? []) as Decision[];
  const invoices = (invoicesQ.data ?? []) as Pick<Invoice, 'project_id' | 'status' | 'amount_usd'>[];
  const catalog = (catalogQ.data ?? []) as SubstageCatalogRow[];
  const relationships = (relationshipsQ.data ?? []) as Relationship[];
  const phases = (phasesQ.data ?? []) as Phase[];
  const workstreams = (workstreamsQ.data ?? []) as Workstream[];
  const pendingProposals = pendingProposalsQ.count ?? 0;

  const reqsByStage = new Map<string, StageRequirement[]>();
  for (const r of requirements) {
    const list = reqsByStage.get(r.project_stage_id) ?? [];
    list.push(r);
    reqsByStage.set(r.project_stage_id, list);
  }

  const projectViews: ProjectView[] = projects.map((p) => ({
    ...p,
    stages: stages
      .filter((s) => s.project_id === p.id)
      .map((s) => ({ ...s, requirements: reqsByStage.get(s.id) ?? [] })),
    events: events.filter((e) => e.project_id === p.id),
  }));

  const stagesByProject = new Map<string, ProjectStage[]>();
  for (const s of stages) {
    const list = stagesByProject.get(s.project_id) ?? [];
    list.push(s);
    stagesByProject.set(s.project_id, list);
  }
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const today = laToday();

  const openTasks = tasks.filter((t) => t.status === 'open');
  const actions = topActions(openTasks, blockers, stagesByProject, names, { today, limit: 8 }, relationships);
  // Portfolio's nextAction (below) needs each project's own best action, not
  // just whichever ones survive the global top-8 cut used for `actions`/Top
  // Actions — so it gets its own uncapped pass over the same inputs/scoring.
  const allRanked = topActions(
    openTasks, blockers, stagesByProject, names,
    { today, limit: openTasks.length + blockers.length }, relationships,
  );
  const followUps = followUpAlerts(openTasks, today);

  const openStatuses = new Set(['received', 'for_rowan_approval', 'approved']);
  // null project key = "everything / no specific project" — translated at render.
  const moneyByProject = new Map<string | null, number>();
  let rowanCount = 0;
  let rowanTotal = 0;
  for (const inv of invoices) {
    if (openStatuses.has(inv.status)) {
      const name = inv.project_id ? (names.get(inv.project_id) ?? '?') : null;
      moneyByProject.set(name, (moneyByProject.get(name) ?? 0) + Number(inv.amount_usd));
    }
    if (inv.status === 'for_rowan_approval') {
      rowanCount++;
      rowanTotal += Number(inv.amount_usd);
    }
  }

  const substages: Record<string, string[]> = {};
  for (const row of catalog) {
    (substages[row.stage_key] ??= []).push(row.name);
  }

  // Portfolio cards (Sprint C, Task 5) — mainBlocker reuses the already-
  // fetched blockers array (no extra query/re-scoring); nextAction reuses
  // allRanked (the uncapped pass above) so a project isn't starved just
  // because it lost the global top-8 cut used for `actions`.
  const phaseLabelByKey = new Map(phases.map((ph) => [ph.key, ph.label]));
  const workstreamsByProject = new Map<string, Workstream[]>();
  for (const w of workstreams) {
    const list = workstreamsByProject.get(w.project_id) ?? [];
    list.push(w);
    workstreamsByProject.set(w.project_id, list);
  }
  const portfolio: PortfolioEntry[] = projects.map((p) => {
    const projectWorkstreams = workstreamsByProject.get(p.id) ?? [];
    const blockingCount = blockers.filter((b) => b.project_id === p.id).length;
    const projectEvents = events.filter((e) => e.project_id === p.id);
    const lastEvidence = projectEvents.reduce<string | null>(
      (max, e) => (e.event_date && (!max || e.event_date > max) ? e.event_date : max), null,
    );
    const hasWaiting = openTasks.some((t) => t.project_id === p.id && !!t.waiting_for);
    return {
      project: p,
      currentPhaseLabel: p.current_phase_key ? (phaseLabelByKey.get(p.current_phase_key) ?? null) : null,
      workstreams: projectWorkstreams,
      // blockers is already active-only, sorted by days_stuck desc — first
      // match per project is that project's max. allRanked is score-desc and
      // uncapped — first match is that project's genuine top-ranked action.
      mainBlocker: blockers.find((b) => b.project_id === p.id) ?? null,
      nextAction: allRanked.find((a) => a.project === p.name) ?? null,
      thenAction: allRanked.filter((a) => a.project === p.name)[1] ?? null,
      blockingCount,
      lastEvidence,
      parallelPhaseKeys: [...new Set(projectWorkstreams.map((w) => w.phase_key))],
      riskState: p.city_on_hold ? 'on_hold' : blockingCount > 0 ? 'at_risk' : hasWaiting ? 'waiting' : 'on_track',
    };
  });

  // Insight cards: worst live blocker + the oldest external wait. Both come
  // straight from records — no scoring, no guesswork.
  const worstBlocker = blockers[0] ?? null; // already sorted days_stuck desc
  const waitingTasks = openTasks
    .filter((t) => !!t.waiting_for)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const oldestWait = waitingTasks[0] ?? null;
  const daysSince = (iso: string) =>
    Math.max(0, Math.floor((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86400000));
  const insights = {
    timeLost: worstBlocker
      ? {
          project: names.get(worstBlocker.project_id) ?? '',
          text: worstBlocker.what,
          days: worstBlocker.days_stuck,
        }
      : null,
    staleWait: oldestWait
      ? {
          project: oldestWait.project_id ? (names.get(oldestWait.project_id) ?? '') : '',
          title: oldestWait.title,
          who: oldestWait.waiting_for ?? '',
          days: daysSince(oldestWait.created_at),
        }
      : null,
  };

  return {
    projects: projectViews,
    tasks,
    blockers,
    decisions,
    actions,
    followUps,
    substages,
    openMoney: [...moneyByProject.entries()]
      .map(([project, open_usd]) => ({ project, open_usd }))
      .sort((a, b) => b.open_usd - a.open_usd),
    rowanQueue: { count: rowanCount, total_usd: rowanTotal },
    pendingProposals,
    portfolio,
    insights,
    today,
  };
}
