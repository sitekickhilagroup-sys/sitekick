// Routes extraction output: additive creates auto-apply; anything that changes
// or asserts existing truth becomes a pending proposal (client handoff §6, §8).
import { matchExistingTask } from './dedup.ts';
import type { ExtractResult, TaskOp } from '../agents/schemas.ts';
import type { ProposalType, Task } from './types.ts';

export interface ProposalDraft {
  type: ProposalType;
  payload: Record<string, unknown>;
  target_task_id: string | null;
  confidence: number;
  reasoning: string;
}

export function routeExtractResult(
  result: ExtractResult,
  ctx: { projectId: string; openTasks: Task[] },
): { autoCreates: TaskOp[]; proposals: ProposalDraft[] } {
  const autoCreates: TaskOp[] = [];
  const proposals: ProposalDraft[] = [];

  for (const op of result.tasks) {
    let targetId = op.op === 'update' ? op.existing_id ?? null : null;
    let confidence = 0.8;
    if (!targetId) {
      const match = matchExistingTask(
        { title: op.title, project_id: ctx.projectId, stage_key: op.stage_key ?? null },
        ctx.openTasks,
      );
      if (match) { targetId = match.id; confidence = 0.6; }
    }
    if (!targetId) { autoCreates.push(op); continue; }
    proposals.push({
      type: op.status === 'done' ? 'task_done' : 'task_update',
      payload: op as unknown as Record<string, unknown>,
      target_task_id: targetId,
      confidence,
      reasoning: op.op === 'update' ? 'model matched existing task' : 'fuzzy title match against open task',
    });
  }
  for (const b of result.blockers) {
    proposals.push({ type: 'blocker_create', payload: b, target_task_id: null, confidence: 0.7, reasoning: 'new blocker asserted by communication' });
  }
  for (const d of result.decisions) {
    proposals.push({ type: 'decision_create', payload: d, target_task_id: null, confidence: 0.7, reasoning: 'decision asserted by communication' });
  }
  for (const du of result.deadline_updates) {
    proposals.push({ type: 'deadline_update', payload: du, target_task_id: null, confidence: 0.6, reasoning: du.evidence });
  }
  for (const rel of result.relationships) {
    proposals.push({ type: 'relationship_create', payload: rel, target_task_id: null, confidence: 0.5, reasoning: rel.reason });
  }
  return { autoCreates, proposals };
}
