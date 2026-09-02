import { describe, expect, it } from 'vitest';
import { routeExtractResult, filterDuplicateProposals, proposalKey, type ProposalDraft, type RouteContext } from './proposals.ts';
import type { Task } from './types.ts';

const openTask = {
  id: 't1', project_id: 'p1', title: 'Retain civil engineer', status: 'open',
} as unknown as Task;

// Two known projects — the Aug 24 meeting summary covered four at once, which
// is the scenario this router exists for.
const NAMES: Record<string, string> = { 'san marco': 'p1', 'rinconia': 'p2' };
const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  resolveProject: (name) => (name ? NAMES[name.toLowerCase()] ?? null : null),
  defaultProjectId: null,
  openTasks: [openTask],
  ...over,
});

const base = { project_name: null, tasks: [], blockers: [], decisions: [], drafts: [], vendor_hours: [], deadline_updates: [], relationships: [] };

describe('routeExtractResult', () => {
  it('new unmatched create goes to autoCreates under its own project', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'Order tree report', priority: 'normal' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(1);
    expect(r.autoCreates[0]).toMatchObject({ project_id: 'p1', op: { title: 'Order tree report' } });
    expect(r.proposals).toHaveLength(0);
  });
  it('untrusted source (allowAutoCreate:false) routes a new create to review, not autoCreates', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'Order tree report', priority: 'normal' }] },
      ctx({ allowAutoCreate: false }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({
      type: 'task_create', project_id: 'p1', target_task_id: null,
      reasoning: 'new task from an untrusted source — needs review',
    });
  });
  it('update with existing_id becomes task_update proposal at 0.8, project taken from the matched task', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, category: null, project_name: null, title: 'Retain civil engineer', priority: 'normal', owner: 'Noa' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.8, project_id: 'p1' });
  });
  it('status done becomes task_done proposal', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, category: null, project_name: 'San Marco', title: 'Retain civil engineer', priority: 'normal', status: 'done' }] },
      ctx(),
    );
    expect(r.proposals[0].type).toBe('task_done');
  });
  it('create that fuzzy-matches an open task becomes a 0.6 proposal, not a duplicate', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'retain the civil engineer', priority: 'normal' }] },
      ctx(),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('multi-project batch: each item routes to its own project (the Aug 24 failure mode)', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'Respond to Hold Letter', priority: 'normal' },
          { op: 'create', stage_key: null, category: null, project_name: 'Rinconia', title: 'Pay City intake invoice', priority: 'critical' },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates.map((c) => c.project_id)).toEqual(['p1', 'p2']);
  });
  it('same deliverable title on TWO projects creates both — dedup key is project-scoped', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'Retain replacement civil engineer', priority: 'normal' },
          { op: 'create', stage_key: null, category: null, project_name: 'Rinconia', title: 'Retain replacement civil engineer', priority: 'normal' },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(2);
  });
  it('create with NO resolvable project becomes a task_create proposal — never silently dropped', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: null, title: 'Pay all outstanding invoices', priority: 'normal' }] },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: null, confidence: 0.5 });
  });
  it('existing_id living on ANOTHER project is rejected — the Landscape SM↔Rinconia bait', () => {
    // Model attributed the item to Rinconia but handed San Marco's task id.
    // The id must not be trusted; with no same-project match it becomes a
    // task_create proposal for review instead of an update on the wrong board.
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', stage_key: null, category: null, project_name: 'Rinconia', title: 'Retain landscape consultant', priority: 'normal' }] },
      ctx(),
    );
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: 'p2', target_task_id: null, confidence: 0.4 });
  });
  it('hallucinated existing_id falls back to fuzzy match instead of proposing against nothing', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 'no-such-task', stage_key: null, category: null, project_name: 'San Marco', title: 'Retain civil engineer', priority: 'normal' }] },
      ctx(),
    );
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('update claim with no match at all becomes a task_create proposal for review', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', stage_key: null, category: null, project_name: 'San Marco', title: 'Completely unknown deliverable', priority: 'normal' }] },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_create', project_id: 'p1', confidence: 0.4 });
  });
  it('document-level default project catches items that name none (single-project email)', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: null, title: 'Order tree report', priority: 'normal' }] },
      ctx({ defaultProjectId: 'p2', openTasks: [] }),
    );
    expect(r.autoCreates[0]).toMatchObject({ project_id: 'p2' });
  });
  it('blockers, decisions and deadline updates become proposals carrying evidence and their own project', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ project_name: 'San Marco', blocks_phase: null, what: 'CE not retained', blocked_by: 'Noa decision', evidence: 'we cannot proceed until the CE is retained' }],
        decisions: [{ project_name: 'Rinconia', title: 'Go with waiver', evidence: 'we will go with the waiver' }],
        deadline_updates: [{ project_name: 'San Marco', task_match: 'Retain civil engineer', new_due: '2026-09-01', evidence: 'email says so' }],
      },
      ctx(),
    );
    expect(r.proposals.map((p) => p.type).sort()).toEqual(['blocker_create', 'deadline_update', 'decision_create'].sort());
    // Agent bug #3: the quote must reach evidence_excerpt, not be dropped.
    expect(r.proposals.find((p) => p.type === 'blocker_create')).toMatchObject({ evidence: 'we cannot proceed until the CE is retained', project_id: 'p1' });
    expect(r.proposals.find((p) => p.type === 'decision_create')?.project_id).toBe('p2');
    expect(r.proposals.find((p) => p.type === 'deadline_update')?.evidence).toBe('email says so');
  });
  it('relationships become relationship_create proposals at 0.5 confidence, evidence carried', () => {
    const rel = { project_name: 'San Marco', from_match: 'Retain civil engineer', to_match: 'Grading plan', type: 'blocks' as const, reason: 'CE must be retained before grading scope', evidence: 'grading scope depends on the CE contract' };
    const r = routeExtractResult(
      { ...base, relationships: [rel] },
      ctx(),
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ type: 'relationship_create', payload: rel, confidence: 0.5, reasoning: rel.reason, evidence: rel.evidence, project_id: 'p1' });
  });
  it('empty claims never reach the inbox (agent bug #3): whitespace what/evidence/matches are dropped', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ project_name: null, blocks_phase: null, what: '  ', blocked_by: 'Noa', evidence: 'q' }],
        deadline_updates: [{ project_name: null, task_match: 'x', new_due: '2026-09-01', evidence: '  ' }],
        relationships: [{ project_name: null, from_match: ' ', to_match: 'y', type: 'blocks' as const, reason: 'r', evidence: 'q' }],
        // title present but evidence whitespace — the new decision evidence gate drops it.
        decisions: [{ project_name: null, title: 'Adopt not-to-exceed clause', evidence: '  ' }],
      },
      ctx(),
    );
    expect(r.proposals).toHaveLength(0);
  });
  it('re-asserted claims are skipped against the existing inbox; changed facts pass (re-upload scenario)', () => {
    const draft = (over: Partial<ProposalDraft>): ProposalDraft => ({
      type: 'blocker_create', project_id: 'p1', payload: {}, target_task_id: null,
      confidence: 0.7, reasoning: 'r', ...over,
    });
    const drafts: ProposalDraft[] = [
      draft({ type: 'blocker_create', payload: { what: 'No civil engineer retained', blocked_by: 'MSA refusal' } }),
      draft({ type: 'decision_create', payload: { title: 'Scope split between surveyor and civil' } }),
      draft({ type: 'deadline_update', payload: { task_match: 'PC Extension', new_due: '2026-09-01' } }),
      // Same task_match but the date MOVED — new fact, must pass.
      draft({ type: 'deadline_update', payload: { task_match: 'PC Extension', new_due: '2026-09-15' } }),
      draft({ type: 'task_update', target_task_id: 't1', payload: { title: 'Retain civil engineer', status: 'open' } }),
      // Same target but new content (done) — must pass.
      draft({ type: 'task_done', target_task_id: 't1', payload: { title: 'Retain civil engineer', status: 'done' } }),
      draft({ type: 'task_create', project_id: null, payload: { title: 'Pay all outstanding invoices' } }),
    ];
    const existing = [
      { type: 'blocker_create', project_id: 'p1', target_task_id: null, payload: { what: 'No civil  engineer retained!' } },
      { type: 'decision_create', project_id: 'p1', target_task_id: null, payload: { title: 'Scope split between surveyor and civil' } },
      { type: 'deadline_update', project_id: 'p1', target_task_id: null, payload: { task_match: 'PC Extension', new_due: '2026-09-01' } },
      { type: 'task_update', project_id: 'p1', target_task_id: 't1', payload: { title: 'Retain civil engineer', status: 'open' } },
      { type: 'task_create', project_id: null, target_task_id: null, payload: { title: 'Pay all outstanding invoices' } },
    ];
    const { kept, skipped } = filterDuplicateProposals(drafts, existing);
    expect(skipped).toBe(5);
    expect(kept.map((k) => k.type)).toEqual(['deadline_update', 'task_done']);
    expect((kept[0].payload as { new_due: string }).new_due).toBe('2026-09-15');
  });
  it('REPHRASED claims are fuzzy-skipped; changed deadline facts still pass (LLM re-run wording)', () => {
    const d = (type: string, payload: Record<string, unknown>): ProposalDraft => ({
      type: type as ProposalDraft['type'], project_id: 'p1', payload, target_task_id: null, confidence: 0.5, reasoning: 'r',
    });
    const existing = [
      { type: 'blocker_create', project_id: 'p1', target_task_id: null, payload: { what: 'No civil engineer retained for grading plan and Hold Letter response' } },
      { type: 'decision_create', project_id: 'p1', target_task_id: null, payload: { title: 'Scope split between surveyor and civil engineer' } },
      { type: 'relationship_create', project_id: 'p1', target_task_id: null, payload: { from_match: 'Pay Quality Mapping invoice', to_match: 'Neighbor notices before hearing', type: 'blocks' } },
      { type: 'deadline_update', project_id: 'p1', target_task_id: null, payload: { task_match: 'PC Extension', new_due: '2026-09-01' } },
    ];
    const { kept, skipped } = filterDuplicateProposals(
      [
        d('blocker_create', { what: 'Grading plan and Hold Letter response cannot proceed' }),
        d('decision_create', { title: 'Surveyor and civil engineer scope split' }),
        d('relationship_create', { from_match: 'Quality Mapping invoice payment', to_match: 'neighbor notices / hearing', type: 'blocks' }),
        // Same task but a MOVED date — real information, must pass.
        d('deadline_update', { task_match: 'PC Extension', new_due: '2026-09-15' }),
        // Same wording on ANOTHER project — must pass.
        { type: 'blocker_create', project_id: 'p2', payload: { what: 'Grading plan and Hold Letter response cannot proceed' }, target_task_id: null, confidence: 0.5, reasoning: 'r' },
      ],
      existing,
    );
    expect(skipped).toBe(3);
    expect(kept.map((k) => k.type)).toEqual(['deadline_update', 'blocker_create']);
  });
  it('reworded task_update on the same target skips when hard facts match; a changed fact passes', () => {
    const d = (payload: Record<string, unknown>, type = 'task_update'): ProposalDraft => ({
      type: type as ProposalDraft['type'], project_id: 'p1', payload, target_task_id: 't1', confidence: 0.8, reasoning: 'r',
    });
    const existing = [{
      type: 'task_update', project_id: 'p1', target_task_id: 't1',
      payload: { title: 'Retain replacement civil engineer', description: 'Rowan sourcing alternative engineers after MSA refusal', waiting_for: 'Rowan' },
    }];
    const { kept, skipped } = filterDuplicateProposals(
      [
        // Same facts, reworded — skip.
        d({ title: 'Retain replacement civil engineer', description: 'Alternative engineers being sourced by Rowan; MSA was refused', waiting_for: 'Rowan' }),
        // New due date — real change, keep.
        d({ title: 'Retain replacement civil engineer', description: 'Rowan sourcing alternative engineers after MSA refusal', waiting_for: 'Rowan', due: '2026-09-05' }),
        // Marked done — real change, keep.
        d({ title: 'Retain replacement civil engineer', description: 'Engineer retained', status: 'done' }, 'task_done'),
      ],
      existing,
    );
    expect(skipped).toBe(1);
    expect(kept).toHaveLength(2);
  });
  it('a create loosely matching an open task becomes a 0.5 task_update proposal, never a duplicate task', () => {
    const open = {
      id: 't9', project_id: 'p1', title: 'Retain Civil Engineer for Grading Plan & B Permit - 2 quotes was received', status: 'open',
    } as unknown as Task;
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', stage_key: null, category: null, project_name: 'San Marco', title: 'Retain civil engineer for grading at San Marco', priority: 'normal' }] },
      ctx({ openTasks: [open] }),
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't9', confidence: 0.5 });
  });
  it('the same claim twice in ONE batch also collapses; unknown types are never skipped', () => {
    const d = (type: string, payload: Record<string, unknown>): ProposalDraft => ({
      type: type as ProposalDraft['type'], project_id: 'p1', payload, target_task_id: null, confidence: 0.5, reasoning: 'r',
    });
    const { kept, skipped } = filterDuplicateProposals(
      [
        d('relationship_create', { from_match: 'A', to_match: 'B', type: 'blocks' }),
        d('relationship_create', { from_match: 'a', to_match: 'b', type: 'blocks' }),
        d('phase_set', { phase_key: 'planning' }),
        d('phase_set', { phase_key: 'planning' }),
      ],
      [],
    );
    expect(skipped).toBe(1);
    expect(kept).toHaveLength(3);
    expect(proposalKey({ type: 'phase_set', project_id: 'p1', target_task_id: null, payload: {} })).toBeNull();
  });
  it('two creates for the same deliverable in ONE batch collapse to one (agent bug #2 — the triple LID)', () => {
    const r = routeExtractResult(
      {
        ...base,
        tasks: [
          { op: 'create' as const, stage_key: null, category: null, project_name: 'San Marco', title: 'Submit LID clearance package', priority: 'normal' as const },
          { op: 'create' as const, stage_key: null, category: null, project_name: 'San Marco', title: 'Submit LID  clearance package!', priority: 'normal' as const },
          { op: 'create' as const, stage_key: null, category: null, project_name: 'San Marco', title: 'Order tree report', priority: 'normal' as const },
        ],
      },
      ctx({ openTasks: [] }),
    );
    expect(r.autoCreates.map((c) => c.op.title)).toEqual(['Submit LID clearance package', 'Order tree report']);
  });
});
