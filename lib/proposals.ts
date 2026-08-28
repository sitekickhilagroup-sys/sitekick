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
  /** Verbatim quote from the communication backing this claim — lands in
   *  agent_proposals.evidence_excerpt so the review inbox has something to
   *  judge (Noa round 3, agent bug #3: it was hardcoded null before). */
  evidence?: string | null;
}

/** In-batch duplicate key: same deliverable worded identically enough after
 *  normalization. Guards one communication producing two creates for the
 *  same thing (agent bug #2 — the LID item existed three times). */
function createKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim();
}

export function routeExtractResult(
  result: ExtractResult,
  ctx: { projectId: string; openTasks: Task[] },
): { autoCreates: TaskOp[]; proposals: ProposalDraft[] } {
  const autoCreates: TaskOp[] = [];
  const proposals: ProposalDraft[] = [];
  const batchKeys = new Set<string>();

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
    if (!targetId) {
      // Agent bug #2: two creates for the same deliverable inside ONE
      // communication — the model was told not to, and the server no longer
      // trusts it to comply. First one wins; the rest are dropped.
      const key = createKey(op.title);
      if (batchKeys.has(key)) continue;
      batchKeys.add(key);
      autoCreates.push(op);
      continue;
    }
    proposals.push({
      type: op.status === 'done' ? 'task_done' : 'task_update',
      payload: op as unknown as Record<string, unknown>,
      target_task_id: targetId,
      confidence,
      reasoning: op.op === 'update' ? 'model matched existing task' : 'fuzzy title match against open task',
    });
  }
  for (const b of result.blockers) {
    // Agent bug #3 guard: a claim with no substance never reaches the inbox.
    if (!b.what.trim() || !b.blocked_by.trim() || !b.evidence.trim()) continue;
    proposals.push({ type: 'blocker_create', payload: b, target_task_id: null, confidence: 0.7, reasoning: 'new blocker asserted by communication', evidence: b.evidence });
  }
  for (const d of result.decisions) {
    if (!d.title.trim()) continue;
    proposals.push({ type: 'decision_create', payload: d, target_task_id: null, confidence: 0.7, reasoning: 'decision asserted by communication', evidence: d.detail ?? null });
  }
  for (const du of result.deadline_updates) {
    if (!du.task_match.trim() || !du.evidence.trim()) continue;
    proposals.push({ type: 'deadline_update', payload: du, target_task_id: null, confidence: 0.6, reasoning: du.evidence, evidence: du.evidence });
  }
  for (const rel of result.relationships) {
    if (!rel.from_match.trim() || !rel.to_match.trim() || !rel.evidence.trim()) continue;
    proposals.push({ type: 'relationship_create', payload: rel, target_task_id: null, confidence: 0.5, reasoning: rel.reason, evidence: rel.evidence });
  }
  return { autoCreates, proposals };
}
