import type { Action, Blocker, BlockerKind, ProjectStage, Relationship, Task } from './types.ts';

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
  if (t.manual_priority != null) return 1000 + t.manual_priority;
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

/**
 * Weight by classification, not just by existence.
 *
 * This was a flat +50 for every active blocker, so an external wait or an
 * unverified claim outranked real work — the audit's point that "an urgent task
 * that does not stop a stage is not a Main Blocker" applies to ranking too.
 * Only primary and workstream items are genuine blockers; the rest still
 * surface, lower down.
 */
const KIND_WEIGHT: Record<BlockerKind, number> = {
  primary: 50,
  workstream: 35,
  external_gate: 15,   // someone else owes us a response; chasing is an action
  future_gate: 5,      // will matter later, does not stop today
  urgent_action: 20,   // needs attention, prevents no stage
  verify: 10,          // a claim without evidence should not outrank proven work
  information_only: 0,
};

export function scoreBlocker(b: Blocker): number {
  const base = KIND_WEIGHT[b.kind] ?? 10;
  if (base === 0) return 0;
  return base + Math.min(b.days_stuck, 30) + (b.downstream.length >= 2 ? 15 : 0);
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
  relationships: Relationship[] = [],
): Action[] {
  // Snoozed tasks are still "open" and remain valid unlock targets — capture
  // the open-id set before the snooze filter below drops them from `tasks`.
  const openIds = new Set(tasks.filter((t) => t.status === 'open').map((t) => t.id));
  tasks = tasks.filter((t) => !t.snoozed_until || t.snoozed_until <= opts.today);
  const currentByProject = new Map<string, string | null>();
  for (const [pid, stages] of stagesByProject) {
    currentByProject.set(pid, stages.find((s) => s.status === 'current')?.stage_key ?? null);
  }

  const taskActions: Action[] = tasks
    .filter((t) => t.status === 'open')
    .map((t) => {
      let score = scoreTask(t, {
        today: opts.today,
        currentStageKey: t.project_id ? currentByProject.get(t.project_id) : null,
      });
      // "Unlocks" bonus: only relationships confirmed (verified or manually
      // overridden) count — unverified LLM-proposed links stay silent. Also
      // require the target task to still be open, so edges left dangling by
      // a completed/deleted downstream task don't keep inflating the score.
      const unlocks = relationships.filter(
        (r) =>
          r.from_task_id === t.id &&
          r.type === 'blocks' &&
          (r.verified_by || r.manual_override) &&
          openIds.has(r.to_task_id),
      ).length;
      score += unlocks * 18;
      return {
        kind: 'task' as const,
        id: t.id,
        project: (t.project_id ? projectNames.get(t.project_id) : null) ?? null,
        title: t.title,
        why: {
          critical: t.priority === 'critical' || undefined,
          due: t.due,
          waiting: t.waiting_for,
          unlocks: unlocks || undefined,
        },
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
      project: projectNames.get(b.project_id) ?? null,
      title: b.what,
      why: { stuck_days: b.days_stuck, blocked_by: b.blocked_by.slice(0, 60) },
      score: scoreBlocker(b),
      source: null,
      waiting_for: b.blocked_by,
    }));

  return [...taskActions, ...blockerActions]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8);
}
