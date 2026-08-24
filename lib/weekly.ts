// Weekly review helpers. nextMonday is date arithmetic on an LA-calendar
// string (not a new "today" source — callers pass laToday()).
import type { Task, WeeklyReviewItem } from './types.ts';

export function nextMonday(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const add = (8 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export interface ReviewItemDraft {
  task_id: string;
  project_id: string | null;
  subtopic: string | null;
  status_snapshot: string;
  weekly_note: string | null;
  sequence: number;
  carried_from: string | null;
}

export function buildReviewItems(input: {
  openTasks: Task[]; doneSinceTasks: Task[]; priorItems: WeeklyReviewItem[]; stageLabels: Map<string, string>;
}): ReviewItemDraft[] {
  const current = new Map<string, Task>();
  for (const t of [...input.openTasks, ...input.doneSinceTasks]) current.set(t.id, t);
  const closedThisWeek = new Set(input.doneSinceTasks.map((t) => t.id));
  const out: ReviewItemDraft[] = [];
  const seen = new Set<string>();
  let seq = 0;

  const subtopicFor = (task: Task | undefined, fallback: string | null) =>
    (task?.stage_key ? input.stageLabels.get(task.stage_key) : undefined) ?? fallback;

  for (const prior of [...input.priorItems].sort((a, b) => a.sequence - b.sequence)) {
    const task = current.get(prior.task_id);
    const status = task?.status ?? prior.status_snapshot;
    // Only open work carries. Something closed in an earlier review stays in
    // that review's history rather than following the team forward every week
    // — but work closed *since* the last review belongs in this one, shown as
    // completed, which is the half that was missing entirely.
    if (status !== 'open' && !closedThisWeek.has(prior.task_id)) continue;

    seen.add(prior.task_id);
    out.push({
      task_id: prior.task_id,
      project_id: task?.project_id ?? prior.project_id,
      subtopic: subtopicFor(task, prior.subtopic),
      status_snapshot: status,
      // Last week's note is the context the meeting runs on. It was being
      // dropped on every carry.
      weekly_note: prior.weekly_note,
      sequence: ++seq,
      carried_from: prior.id,
    });
  }

  // New open work, then anything completed since the last review that was never
  // on it — this loop covered openTasks only, so those completions vanished.
  for (const t of [...input.openTasks, ...input.doneSinceTasks]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      task_id: t.id,
      project_id: t.project_id,
      subtopic: subtopicFor(t, null),
      status_snapshot: t.status,
      weekly_note: null,
      sequence: ++seq,
      carried_from: null,
    });
  }
  return out;
}
