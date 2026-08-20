import type { Action, Blocker, ProjectStage, Task } from './types.ts';

// Deterministic priority engine — no LLM. Drives Top Actions + digest.

export interface ScoreContext {
  today: string; // YYYY-MM-DD
  currentStageKey?: string | null;
}

function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z').getTime();
  const t = new Date(today + 'T00:00:00Z').getTime();
  return Math.round((d - t) / 86400000);
}

export function scoreTask(t: Task, ctx: ScoreContext): number {
  let score = 0;
  if (t.priority === 'critical') score += 40;
  else if (t.priority === 'high') score += 20;

  const due = daysUntil(t.due, ctx.today);
  if (due !== null) {
    if (due < 0) score += 35;
    else if (due <= 2) score += 25;
    else if (due <= 7) score += 12;
  }

  const fu = daysUntil(t.follow_up_date, ctx.today);
  const cb = daysUntil(t.check_back_on, ctx.today);
  if ((fu !== null && fu <= 0) || (cb !== null && cb <= 0)) score += 18;

  if (t.stage_key && ctx.currentStageKey && t.stage_key === ctx.currentStageKey) score += 25;
  if (t.waiting_for) score += 6;

  const touched = daysUntil(t.last_touched, ctx.today);
  if (touched !== null && touched < -14) score += 8;

  return score;
}

export function scoreBlocker(b: Blocker): number {
  return 50 + Math.min(b.days_stuck, 30) + (b.downstream.length >= 2 ? 15 : 0);
}

export function followUpAlerts(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => {
    if (t.status !== 'open') return false;
    const fu = daysUntil(t.follow_up_date, today);
    const cb = daysUntil(t.check_back_on, today);
    return (fu !== null && fu <= 0) || (cb !== null && cb <= 0);
  });
}

export interface TopActionsOptions {
  today: string;
  limit?: number;
}

export function topActions(
  tasks: Task[],
  blockers: Blocker[],
  stagesByProject: Map<string, ProjectStage[]>,
  projectNames: Map<string, string>, // project_id -> name
  opts: TopActionsOptions,
): Action[] {
  const currentByProject = new Map<string, string | null>();
  for (const [pid, stages] of stagesByProject) {
    currentByProject.set(pid, stages.find((s) => s.status === 'current')?.stage_key ?? null);
  }

  const taskActions: Action[] = tasks
    .filter((t) => t.status === 'open')
    .map((t) => {
      const score = scoreTask(t, {
        today: opts.today,
        currentStageKey: t.project_id ? currentByProject.get(t.project_id) : null,
      });
      const why = [
        t.priority === 'critical' ? 'critical' : null,
        t.due ? `due ${t.due}` : null,
        t.waiting_for ? `waiting: ${t.waiting_for}` : null,
      ].filter(Boolean).join(' · ');
      return {
        kind: 'task' as const,
        id: t.id,
        project: (t.project_id ? projectNames.get(t.project_id) : null) ?? 'All',
        title: t.title,
        why,
        score,
        source: t.source,
        waiting_for: t.waiting_for,
      };
    });

  const blockerActions: Action[] = blockers
    .filter((b) => b.status === 'active')
    .map((b) => ({
      kind: 'blocker' as const,
      id: b.id,
      project: projectNames.get(b.project_id) ?? '',
      title: b.what,
      why: `stuck ${b.days_stuck}d · blocked by ${b.blocked_by.slice(0, 60)}`,
      score: scoreBlocker(b),
      source: null,
      waiting_for: b.blocked_by,
    }));

  return [...taskActions, ...blockerActions]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8);
}
