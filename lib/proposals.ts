// Routes extraction output: additive creates auto-apply; anything that changes
// or asserts existing truth becomes a pending proposal (client handoff §6, §8).
//
// Attribution is PER ITEM (iteration 1 of the transcript loop): one
// communication may cover several projects — the Aug 24 meeting summary
// covered four, and the old single-project contract silently discarded all
// eleven extracted tasks. Every item resolves its own project; an item with
// no resolvable project becomes a review proposal, NEVER a silent drop.
import { matchExistingTask } from './dedup.ts';
import type { ExtractResult, TaskOp } from '../agents/schemas.ts';
import type { ProposalType, Task } from './types.ts';

export interface ProposalDraft {
  type: ProposalType;
  /** Project this item belongs to — null means "needs human attribution". */
  project_id: string | null;
  payload: Record<string, unknown>;
  target_task_id: string | null;
  confidence: number;
  reasoning: string;
  /** Short human label for the review inbox list. */
  title?: string | null;
  /** Verbatim quote from the communication backing this claim — lands in
   *  agent_proposals.evidence_excerpt so the review inbox has something to
   *  judge (Noa round 3, agent bug #3: it was hardcoded null before). */
  evidence?: string | null;
}

export interface RoutedCreate {
  op: TaskOp;
  project_id: string;
}

export interface RouteContext {
  /** Exact-then-case-insensitive name→id lookup over the projects table. */
  resolveProject: (name: string | null | undefined) => string | null;
  /** Document-level project, when the whole communication is one project. */
  defaultProjectId?: string | null;
  openTasks: Task[];
}

/** In-batch duplicate key: same deliverable worded identically enough after
 *  normalization. Guards one communication producing two creates for the
 *  same thing (agent bug #2 — the LID item existed three times). Scoped per
 *  project: "Retain civil engineer" for San Marco and for Rinconia are two
 *  real, distinct work items (the Aug 24 meeting had exactly this pair). */
function createKey(projectId: string | null, title: string): string {
  return `${projectId ?? '∅'}|${title.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim()}`;
}

export function routeExtractResult(
  result: ExtractResult,
  ctx: RouteContext,
): { autoCreates: RoutedCreate[]; proposals: ProposalDraft[] } {
  const autoCreates: RoutedCreate[] = [];
  const proposals: ProposalDraft[] = [];
  const batchKeys = new Set<string>();
  const resolve = (name: string | null | undefined): string | null =>
    ctx.resolveProject(name) ?? ctx.defaultProjectId ?? null;

  for (const op of result.tasks) {
    const itemProject = resolve(op.project_name);
    // The model's existing_id is only trusted when it names a real open task —
    // a hallucinated id must not become a proposal against nothing.
    let matched: Task | null = op.op === 'update' && op.existing_id
      ? ctx.openTasks.find((t) => t.id === op.existing_id) ?? null
      : null;
    let confidence = 0.8;
    if (!matched) {
      const m = matchExistingTask(
        { title: op.title, project_id: itemProject, stage_key: op.stage_key ?? null },
        ctx.openTasks,
      );
      if (m) { matched = m; confidence = 0.6; }
    }
    if (matched) {
      proposals.push({
        type: op.status === 'done' ? 'task_done' : 'task_update',
        // The matched task's own project is authoritative — task identity
        // beats the model's attribution when they disagree.
        project_id: matched.project_id ?? itemProject,
        payload: op as unknown as Record<string, unknown>,
        target_task_id: matched.id,
        confidence,
        reasoning: op.op === 'update' && op.existing_id === matched.id
          ? 'model matched existing task'
          : 'fuzzy title match against open task',
        title: op.title,
      });
      continue;
    }
    if (op.op === 'update') {
      // The model claims this updates known work but nothing matches. Writing
      // a task from an update claim would fabricate state; dropping it would
      // hide it. A human sorts it out.
      proposals.push({
        type: 'task_create',
        project_id: itemProject,
        payload: op as unknown as Record<string, unknown>,
        target_task_id: null,
        confidence: 0.4,
        reasoning: 'model claimed an update but no open task matched',
        title: op.title,
      });
      continue;
    }
    // Agent bug #2: two creates for the same deliverable inside ONE
    // communication — the model was told not to, and the server no longer
    // trusts it to comply. First one wins; the rest are dropped.
    const key = createKey(itemProject, op.title);
    if (batchKeys.has(key)) continue;
    batchKeys.add(key);
    if (itemProject) {
      autoCreates.push({ op, project_id: itemProject });
    } else {
      // No property evidence for this item. It used to be discarded with the
      // whole document; now it waits in the review inbox for attribution.
      proposals.push({
        type: 'task_create',
        project_id: null,
        payload: op as unknown as Record<string, unknown>,
        target_task_id: null,
        confidence: 0.5,
        reasoning: 'no project evidence in the text — needs human attribution',
        title: op.title,
      });
    }
  }
  for (const b of result.blockers) {
    // Agent bug #3 guard: a claim with no substance never reaches the inbox.
    if (!b.what.trim() || !b.blocked_by.trim() || !b.evidence.trim()) continue;
    proposals.push({ type: 'blocker_create', project_id: resolve(b.project_name), payload: b, target_task_id: null, confidence: 0.7, reasoning: 'new blocker asserted by communication', title: b.what, evidence: b.evidence });
  }
  for (const d of result.decisions) {
    if (!d.title.trim()) continue;
    proposals.push({ type: 'decision_create', project_id: resolve(d.project_name), payload: d, target_task_id: null, confidence: 0.7, reasoning: 'decision asserted by communication', title: d.title, evidence: d.detail ?? null });
  }
  for (const du of result.deadline_updates) {
    if (!du.task_match.trim() || !du.evidence.trim()) continue;
    proposals.push({ type: 'deadline_update', project_id: resolve(du.project_name), payload: du, target_task_id: null, confidence: 0.6, reasoning: du.evidence, title: `${du.task_match} → ${du.new_due}`, evidence: du.evidence });
  }
  for (const rel of result.relationships) {
    if (!rel.from_match.trim() || !rel.to_match.trim() || !rel.evidence.trim()) continue;
    proposals.push({ type: 'relationship_create', project_id: resolve(rel.project_name), payload: rel, target_task_id: null, confidence: 0.5, reasoning: rel.reason, title: `${rel.from_match} ${rel.type} ${rel.to_match}`, evidence: rel.evidence });
  }
  return { autoCreates, proposals };
}
