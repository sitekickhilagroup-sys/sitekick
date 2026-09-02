// Routes extraction output: additive creates auto-apply; anything that changes
// or asserts existing truth becomes a pending proposal (client handoff §6, §8).
//
// Attribution is PER ITEM (iteration 1 of the transcript loop): one
// communication may cover several projects — the Aug 24 meeting summary
// covered four, and the old single-project contract silently discarded all
// eleven extracted tasks. Every item resolves its own project; an item with
// no resolvable project becomes a review proposal, NEVER a silent drop.
import { matchExistingTask, tokenize } from './dedup.ts';
import type { ExtractResult, TaskOp } from '../agents/schemas.ts';
import type { ProposalType, Task } from './types.ts';

/** Containment of the smaller token set in the larger — how much of the
 *  shorter phrase the longer one covers. LLM re-runs rephrase the same claim
 *  ("Grading plan cannot proceed" vs "No civil engineer retained for grading
 *  plan"), so exact keys alone let re-uploads double the review queue. */
function overlapScore(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (!small.size) return 0;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size;
}

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
  /** Whether a brand-new task may be written directly (autoCreates) or must go
   *  to the review queue. False for untrusted sources — forwarded/polled email,
   *  whose body is attacker-controllable — so injected "create" ops become
   *  proposals a human sees, never silent live tasks. Defaults true (trusted
   *  staff uploads/transcripts keep the existing one-step create). */
  allowAutoCreate?: boolean;
}

function norm(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ').trim() : '';
}

/** In-batch duplicate key: same deliverable worded identically enough after
 *  normalization. Guards one communication producing two creates for the
 *  same thing (agent bug #2 — the LID item existed three times). Scoped per
 *  project: "Retain civil engineer" for San Marco and for Rinconia are two
 *  real, distinct work items (the Aug 24 meeting had exactly this pair). */
function createKey(projectId: string | null, title: string): string {
  return `${projectId ?? '∅'}|${norm(title)}`;
}

/** The identity of a proposal for cross-document dedup. Re-uploading the
 *  same communication (renamed, or extended with additions) re-asserts the
 *  same blockers/decisions/relationships — without this every re-run doubled
 *  them in Noa's review inbox. A changed FACT changes the key (a deadline
 *  moved to a new date, an update with different content), so genuinely new
 *  information still comes through. */
export interface ProposalIdentity {
  type: string;
  project_id: string | null;
  target_task_id: string | null;
  payload: Record<string, unknown>;
}

export function proposalKey(p: ProposalIdentity): string | null {
  const proj = p.project_id ?? '∅';
  const pay = p.payload ?? {};
  switch (p.type) {
    case 'blocker_create':
      return `b|${proj}|${norm(pay.what)}`;
    case 'decision_create':
      return `d|${proj}|${norm(pay.title)}`;
    case 'relationship_create':
      return `r|${proj}|${norm(pay.from_match)}|${pay.type ?? ''}|${norm(pay.to_match)}`;
    case 'deadline_update':
      return `dl|${proj}|${norm(pay.task_match)}|${pay.new_due ?? ''}`;
    case 'task_create':
      return `tc|${proj}|${norm(pay.title)}`;
    case 'task_update':
    case 'task_done':
      // Same target + same asserted content = same proposal. Any changed
      // field (a new owner, new due, different status) makes a new key.
      return `tu|${p.target_task_id ?? ''}|${norm(pay.title)}|${norm(pay.description)}|${pay.due ?? ''}|${pay.status ?? ''}|${norm(pay.waiting_for)}|${norm(pay.owner)}`;
    default:
      return null; // unknown types are never silently skipped
  }
}

/** Claim text per type for the fuzzy pass. task_update/task_done/deadline
 *  stay exact-key only — their payload deltas (a moved date, a done status)
 *  ARE the information, and fuzzy matching would eat real changes. */
function fuzzyFields(p: ProposalIdentity): { bucket: string; a: string; b?: string } | null {
  const pay = p.payload ?? {};
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (p.type) {
    case 'blocker_create': return { bucket: `b|${p.project_id ?? '∅'}`, a: s(pay.what) };
    case 'decision_create': return { bucket: `d|${p.project_id ?? '∅'}`, a: s(pay.title) };
    case 'task_create': return { bucket: `tc|${p.project_id ?? '∅'}`, a: s(pay.title) };
    case 'relationship_create':
      return { bucket: `r|${p.project_id ?? '∅'}|${s(pay.type)}`, a: s(pay.from_match), b: s(pay.to_match) };
    default: return null;
  }
}

const FUZZY_AT = 0.6;

export function filterDuplicateProposals(
  drafts: ProposalDraft[],
  existing: ProposalIdentity[],
): { kept: ProposalDraft[]; skipped: number } {
  const seen = new Set<string>();
  const fuzzySeen: Array<{ bucket: string; a: string; b?: string }> = [];
  const admit = (p: ProposalIdentity) => {
    const k = proposalKey(p);
    if (k) seen.add(k);
    const f = fuzzyFields(p);
    if (f && f.a) fuzzySeen.push(f);
  };
  for (const e of existing) admit(e);

  // task_update/task_done: an LLM re-run rewords the same assertion every
  // time, so exact keys never collapse them. Skip ONLY when every hard fact
  // matches an existing proposal on the same target (due, status, owner,
  // waiting_for) AND the text substantially overlaps — any changed fact
  // passes untouched.
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // Empty-vs-set is not a conflict for people fields (a re-run randomly
  // dropping or adding the same owner is wording noise, not information);
  // two DIFFERENT non-empty values are a real change and pass.
  const peopleConflict = (a: unknown, b: unknown) => s(a) !== '' && s(b) !== '' && s(a) !== s(b);
  const updSeen = existing
    .filter((e) => e.type === 'task_update' || e.type === 'task_done')
    .map((e) => ({ target: e.target_task_id, pay: e.payload ?? {} }));
  const sameUpdate = (d: ProposalDraft): boolean => {
    const pay = d.payload ?? {};
    return updSeen.some((e) =>
      e.target === d.target_task_id
      && s(e.pay.due) === s(pay.due)
      && (s(e.pay.status) || 'open') === (s(pay.status) || 'open')
      && !peopleConflict(e.pay.owner, pay.owner)
      && !peopleConflict(e.pay.waiting_for, pay.waiting_for)
      && overlapScore(
        `${s(e.pay.title)} ${s(e.pay.description)}`,
        `${s(pay.title)} ${s(pay.description)}`,
      ) >= FUZZY_AT);
  };

  const kept: ProposalDraft[] = [];
  let skipped = 0;
  for (const d of drafts) {
    const identity: ProposalIdentity = { type: d.type, project_id: d.project_id, target_task_id: d.target_task_id, payload: d.payload };
    const k = proposalKey(identity);
    if (k && seen.has(k)) { skipped++; continue; }
    const f = fuzzyFields(identity);
    if (f && f.a && fuzzySeen.some((e) =>
      e.bucket === f.bucket
      && overlapScore(e.a, f.a) >= FUZZY_AT
      && (f.b === undefined || overlapScore(e.b ?? '', f.b) >= FUZZY_AT),
    )) { skipped++; continue; }
    if ((d.type === 'task_update' || d.type === 'task_done') && sameUpdate(d)) { skipped++; continue; }
    admit(identity);
    if (d.type === 'task_update' || d.type === 'task_done') {
      updSeen.push({ target: d.target_task_id, pay: d.payload ?? {} });
    }
    kept.push(d);
  }
  return { kept, skipped };
}

export function routeExtractResult(
  result: ExtractResult,
  ctx: RouteContext,
): { autoCreates: RoutedCreate[]; proposals: ProposalDraft[] } {
  const autoCreates: RoutedCreate[] = [];
  const proposals: ProposalDraft[] = [];
  const batchKeys = new Set<string>();
  const allowAutoCreate = ctx.allowAutoCreate ?? true;
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
    // Cross-project id (Aug-3 bundle: "Landscape for Rinconia" arrived with
    // San Marco's landscape task id, "ID for Alta Mesa" with Rinconia's
    // designer task id — the exact near-twin pairs Noa already ruled apart).
    // An id living on ANOTHER project than the item's own attribution is not
    // a match; fall through to a same-project fuzzy search instead.
    if (matched && itemProject && matched.project_id && matched.project_id !== itemProject) {
      matched = null;
    }
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
    // Second chance before auto-creating: a loose same-project containment
    // ("Retain civil engineer for grading at San Marco" vs the open "Retain
    // Civil Engineer for Grading Plan & B Permit" scored 0.47 and became a
    // duplicate task). Looser than matchExistingTask, so it only gets to
    // PROPOSE an update — never to write one.
    if (itemProject) {
      const loose = ctx.openTasks.find((t) =>
        t.project_id === itemProject && overlapScore(t.title, op.title) >= 0.65);
      if (loose) {
        proposals.push({
          type: 'task_update',
          project_id: itemProject,
          payload: op as unknown as Record<string, unknown>,
          target_task_id: loose.id,
          confidence: 0.5,
          reasoning: 'loose title match against open task — possible duplicate, review',
          title: op.title,
        });
        continue;
      }
    }
    if (itemProject && allowAutoCreate) {
      autoCreates.push({ op, project_id: itemProject });
    } else if (itemProject) {
      // Attributed, but from an untrusted source (forwarded/polled email): the
      // create keeps its project but lands in the review queue instead of
      // writing a live task. Closes the "injected email → silent task" path;
      // auto-triage may still auto-apply it, but only via a learned class.
      proposals.push({
        type: 'task_create',
        project_id: itemProject,
        payload: op as unknown as Record<string, unknown>,
        target_task_id: null,
        confidence: 0.5,
        reasoning: 'new task from an untrusted source — needs review',
        title: op.title,
      });
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
    // Same evidence gate as blockers/deadlines/relationships: a decision with
    // no verbatim quote never reaches the queue (and the schema now requires
    // one). The quote itself is the evidence, not the model's free-text detail.
    if (!d.title.trim() || !d.evidence.trim()) continue;
    proposals.push({ type: 'decision_create', project_id: resolve(d.project_name), payload: d, target_task_id: null, confidence: 0.7, reasoning: 'decision asserted by communication', title: d.title, evidence: d.evidence });
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
