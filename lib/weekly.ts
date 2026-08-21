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
  const out: ReviewItemDraft[] = [];
  const seen = new Set<string>();
  let seq = 0;

  for (const prior of [...input.priorItems].sort((a, b) => a.sequence - b.sequence)) {
    const task = current.get(prior.task_id);
    seen.add(prior.task_id);
    out.push({
      task_id: prior.task_id,
      project_id: task?.project_id ?? prior.project_id,
      subtopic: (task?.stage_key ? input.stageLabels.get(task.stage_key) : undefined) ?? prior.subtopic,
      status_snapshot: task?.status ?? prior.status_snapshot,
      weekly_note: null,
      sequence: ++seq,
      carried_from: prior.id,
    });
  }
  for (const t of input.openTasks) {
    if (seen.has(t.id)) continue;
    out.push({
      task_id: t.id,
      project_id: t.project_id,
      subtopic: (t.stage_key ? input.stageLabels.get(t.stage_key) : undefined) ?? null,
      status_snapshot: t.status,
      weekly_note: null,
      sequence: ++seq,
      carried_from: null,
    });
  }
  return out;
}
