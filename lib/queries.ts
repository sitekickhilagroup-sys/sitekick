import { supabaseServer } from './supabase/server.ts';
import { followUpAlerts, topActions } from './priority.ts';
import { laToday } from './date.ts';
import { selectBlockerView, type BlockerCounts } from './blockers.ts';
import { canonVendorName, vendorKey } from './invoice-rules.ts';
import type {
  Action, Blocker, BlockerKind, Decision, Invoice, Phase, Project, ProjectEvent, ProjectStage,
  Relationship, StageRequirement, SubstageCatalogRow, Task, Vendor, Workstream,
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
  /** Primary Blocker per the blocker audit — or, when none qualifies, the
   *  strongest external gate / workstream blocker. Read `primaryBlockerKind`
   *  before labelling it: a fallback must never be called project-wide. */
  mainBlocker: Blocker | null;
  /** What `mainBlocker` actually is, so the card can label it honestly. */
  primaryBlockerKind: BlockerKind | null;
  /** Second line on the card when a parallel workstream is independently
   *  blocked. Never the same record as `mainBlocker`. */
  technicalBlocker: Blocker | null;
  nextAction: Action | null;
  /** Second-ranked action — the card's "Then" line. */
  thenAction: Action | null;
  /** Confirmed blockers (primary + workstream) — the "N blocking" chip.
   *  External waits, urgent actions and Verify items are counted separately in
   *  `blockerCounts` and must not be folded into this number. */
  blockingCount: number;
  /** The full split: blocking / waiting / verify / futureGate / urgent. */
  blockerCounts: BlockerCounts;
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
  /** Consultants tab (client demo): open items waiting on each vendor + their open money. */
  consultants: { name: string; discipline: string | null; waitingCount: number; openUsd: number }[];
  /** Budget tab — derived from recorded invoices only (partial coverage, stated). */
  budget: { project: string; paid: number; total: number }[];
  today: string;
}

export async function getOverviewData(): Promise<OverviewData> {
  const supabase = await supabaseServer();
  const [
    projectsQ, stagesQ, reqsQ, eventsQ, tasksQ, blockersQ, decisionsQ, invoicesQ, catalogQ, relationshipsQ,
    phasesQ, workstreamsQ, pendingProposalsQ, vendorsQ,
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
    // Open money + Rowan queue + the Budget intelligence tab (needs paid
    // rows too) — all computed in memory from one fetch.
    supabase.from('invoices').select('project_id,status,amount_usd,vendor_id'),
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
    // Consultants intelligence: who open work waits on + their open money.
    supabase.from('vendors').select('id,name,discipline'),
  ]);

  const projects = (projectsQ.data ?? []) as Project[];
  const stages = (stagesQ.data ?? []) as ProjectStage[];
  const requirements = (reqsQ.data ?? []) as StageRequirement[];
  const events = ((eventsQ.data ?? []) as ProjectEvent[]).reverse();
  const tasks = (tasksQ.data ?? []) as Task[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const decisions = (decisionsQ.data ?? []) as Decision[];
  const invoices = (invoicesQ.data ?? []) as Pick<Invoice, 'project_id' | 'status' | 'amount_usd' | 'vendor_id'>[];
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
  const budgetByProject = new Map<string, { paid: number; total: number }>();
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
    // Budget tab: paid = cost to date; total = every recorded invoice.
    // Coverage is partial by definition — invoices only, stated in the UI.
    if (inv.project_id && inv.status !== 'on_hold') {
      const name = names.get(inv.project_id) ?? '?';
      const b = budgetByProject.get(name) ?? { paid: 0, total: 0 };
      b.total += Number(inv.amount_usd);
      if (inv.status === 'paid') b.paid += Number(inv.amount_usd);
      budgetByProject.set(name, b);
    }
  }
  const budget = [...budgetByProject.entries()]
    .map(([project, b]) => ({ project, ...b }))
    .sort((a, b) => b.total - a.total);

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
    // Blocker audit: only items that name the stage they prevent, carry
    // evidence, and are classified primary/workstream count as blocking.
    // External waits and unverified items get their own counts.
    const activeSubstages = (stagesByProject.get(p.id) ?? [])
      .filter((s) => s.substage && (s.status === 'current' || s.also_active))
      .map((s) => s.substage as string);
    const blockerView = selectBlockerView(
      blockers.filter((b) => b.project_id === p.id),
      { currentPhaseKey: p.current_phase_key, activeSubstages },
    );
    const blockingCount = blockerView.counts.blocking;
    const projectEvents = events.filter((e) => e.project_id === p.id);
    // Tracker imports left literal "—" placeholders in some event_date rows;
    // anything that is not a date must not win the max() or the card renders
    // "Last evidence —" with no date.
    const lastEvidence = projectEvents.reduce<string | null>(
      (max, e) => (e.event_date && /^\d{4}-\d{2}-\d{2}/.test(e.event_date) && (!max || e.event_date > max)
        ? e.event_date : max),
      null,
    );
    const hasWaiting = openTasks.some((t) => t.project_id === p.id && !!t.waiting_for);
    return {
      project: p,
      currentPhaseLabel: p.current_phase_key ? (phaseLabelByKey.get(p.current_phase_key) ?? null) : null,
      workstreams: projectWorkstreams,
      // allRanked is score-desc and uncapped — first match is that project's
      // genuine top-ranked action.
      mainBlocker: blockerView.primary,
      primaryBlockerKind: blockerView.primaryKind,
      technicalBlocker: blockerView.technical,
      nextAction: allRanked.find((a) => a.project === p.name) ?? null,
      thenAction: allRanked.filter((a) => a.project === p.name)[1] ?? null,
      blockingCount,
      blockerCounts: blockerView.counts,
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
  // Consultants: same waiting_for-substring match the directory uses, plus
  // open invoice totals per vendor. Only vendors with something live make the list.
  //
  // I5: grouped by the same canonical vendor identity /invoices uses
  // (vendorKey/canonVendorName, lib/invoice-rules.ts) — this used to group by
  // raw vendors.id instead, so a punctuation-only vendor split (e.g. "Acme
  // LLC" and "Acme" as two separate rows) read as one merged vendor with
  // combined open money on /invoices, and two separate consultants with
  // split money here. Grouping vendor rows by key first (rather than
  // grouping invoices by resolved name, /invoices's own approach) keeps the
  // waiting_for substring match — which is per raw vendor NAME, not per
  // invoice — correct for a group with more than one name in it.
  const vendorRows = (vendorsQ.data ?? []) as Pick<Vendor, 'id' | 'name' | 'discipline'>[];
  const vendorGroupsByKey = new Map<string, Pick<Vendor, 'id' | 'name' | 'discipline'>[]>();
  for (const v of vendorRows) {
    const k = vendorKey(v.name);
    const list = vendorGroupsByKey.get(k);
    if (list) list.push(v); else vendorGroupsByKey.set(k, [v]);
  }
  const consultants = [...vendorGroupsByKey.values()]
    .map((group) => {
      // First-seen name wins, same tie-break /invoices's own canonicalByKey
      // uses (both iterate vendorRows in the same fetched order).
      const name = canonVendorName(group[0].name);
      const discipline = group.find((v) => v.discipline)?.discipline ?? null;
      const ids = new Set(group.map((v) => v.id));
      const waitingCount = openTasks.filter(
        (t) => !!t.waiting_for && group.some((v) => v.name.toLowerCase().includes(t.waiting_for!.toLowerCase())),
      ).length;
      const openUsd = invoices
        .filter((inv) => inv.vendor_id && ids.has(inv.vendor_id) && openStatuses.has(inv.status))
        .reduce((s, inv) => s + Number(inv.amount_usd), 0);
      return { name, discipline, waitingCount, openUsd };
    })
    .filter((c) => c.waitingCount > 0 || c.openUsd > 0)
    .sort((a, b) => b.waitingCount - a.waitingCount || b.openUsd - a.openUsd)
    .slice(0, 8);

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
    consultants,
    budget,
    today,
  };
}
