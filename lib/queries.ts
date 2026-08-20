import { supabaseServer } from './supabase/server.ts';
import { followUpAlerts, topActions } from './priority.ts';
import type {
  Action, Blocker, Decision, Invoice, Project, ProjectEvent, ProjectStage,
  StageRequirement, SubstageCatalogRow, Task,
} from './types.ts';

export interface ProjectView extends Project {
  stages: (ProjectStage & { requirements: StageRequirement[] })[];
  events: ProjectEvent[];
}

export interface OverviewData {
  projects: ProjectView[];
  tasks: Task[];
  blockers: Blocker[];
  decisions: Decision[];
  actions: Action[];
  followUps: Task[];
  substages: Record<string, string[]>;
  openMoney: { project: string; open_usd: number }[];
  rowanQueue: { count: number; total_usd: number };
  today: string;
}

export async function getOverviewData(): Promise<OverviewData> {
  const supabase = await supabaseServer();
  const [projectsQ, stagesQ, reqsQ, eventsQ, tasksQ, blockersQ, decisionsQ, invoicesQ, catalogQ] =
    await Promise.all([
      supabase.from('projects').select('*').order('name'),
      supabase.from('project_stages').select('*').order('position'),
      supabase.from('stage_requirements').select('*').order('position'),
      supabase.from('project_events').select('*').order('created_at'),
      supabase.from('tasks').select('*').order('created_at'),
      supabase.from('blockers').select('*').eq('status', 'active').order('days_stuck', { ascending: false }),
      supabase.from('decisions').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('invoices').select('*'),
      supabase.from('substage_catalog').select('*').order('position'),
    ]);

  const projects = (projectsQ.data ?? []) as Project[];
  const stages = (stagesQ.data ?? []) as ProjectStage[];
  const requirements = (reqsQ.data ?? []) as StageRequirement[];
  const events = (eventsQ.data ?? []) as ProjectEvent[];
  const tasks = (tasksQ.data ?? []) as Task[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const decisions = (decisionsQ.data ?? []) as Decision[];
  const invoices = (invoicesQ.data ?? []) as Invoice[];
  const catalog = (catalogQ.data ?? []) as SubstageCatalogRow[];

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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

  const openTasks = tasks.filter((t) => t.status === 'open');
  const actions = topActions(openTasks, blockers, stagesByProject, names, { today, limit: 8 });
  const followUps = followUpAlerts(openTasks, today);

  const openStatuses = new Set(['received', 'for_rowan_approval', 'approved']);
  const moneyByProject = new Map<string, number>();
  let rowanCount = 0;
  let rowanTotal = 0;
  for (const inv of invoices) {
    if (openStatuses.has(inv.status)) {
      const name = inv.project_id ? (names.get(inv.project_id) ?? '?') : 'All';
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
    today,
  };
}
