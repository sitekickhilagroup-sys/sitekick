import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractComms, applyExtractResult } from './extract-comms';
import { ExtractResultSchema } from './schemas';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task } from '../lib/types';

const canned = {
  project_name: '2361-2367 San Marco',
  tasks: [
    { op: 'update', existing_id: 'task-1', title: 'Retain Surveyor (Updated Survey / Topo)', waiting_for: 'Refael', priority: 'critical' },
    { op: 'create', title: 'Order soils report addendum', owner: 'Noa', due: '2026-08-28', priority: 'normal' },
  ],
  blockers: [
    // evidence is required as of Noa round 3 (agent bug #3) — a blocker claim
    // must quote the communication it came from.
    { what: 'Grading plan has no engineer', blocked_by: 'Mid-Cities MSA refusal', downstream: ['plan_check'], evidence: 'Mid-Cities declined the MSA, so the grading plan has no engineer' },
  ],
  decisions: [{ title: 'Proceed with Crest for entitlements' }],
  drafts: [{ subject: 'MSA decision needed', body: 'Refael — decision needed this week.', re_blocker_index: 0 }],
  vendor_hours: [{ vendor_name: 'KGS Structural', hours: 12, rate: 180 }],
  deadline_updates: [],
  relationships: [],
};

function fakeAnthropicWith(input: unknown): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'tool_use', id: 'tu1', name: 'report_extraction', input }],
      }),
    },
  } as unknown as Anthropic;
}

// Chainable capturing fake for the supabase admin client.
function fakeAdmin(calls: Array<{ table: string; op: string; payload?: unknown }>): SupabaseClient {
  const make = (table: string) => {
    const chain = {
      insert: (payload: unknown) => { calls.push({ table, op: 'insert', payload }); return chain; },
      update: (payload: unknown) => { calls.push({ table, op: 'update', payload }); return chain; },
      upsert: (payload: unknown) => { calls.push({ table, op: 'upsert', payload }); return chain; },
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { id: 'row-1' }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data: { id: 'row-1' }, error: null }),
    };
    return chain;
  };
  return { from: make } as unknown as SupabaseClient;
}

describe('ExtractResultSchema', () => {
  it('accepts the canned result', () => {
    expect(() => ExtractResultSchema.parse(canned)).not.toThrow();
  });
  it('rejects a task op without title', () => {
    const bad = { ...canned, tasks: [{ op: 'create' }] };
    expect(ExtractResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe('extractComms', () => {
  it('returns validated result from forced tool call', async () => {
    const result = await extractComms(
      { id: 'doc1', raw_text: readFileSync('fixtures/transcript-weekly.txt', 'utf8') },
      { projects: [{ id: 'p1', name: '2361-2367 San Marco' }], openTasks: [], client: fakeAnthropicWith(canned) },
    );
    expect(result.project_name).toBe('2361-2367 San Marco');
    expect(result.tasks).toHaveLength(2);
  });
});

describe('applyExtractResult', () => {
  it('auto-creates unmatched tasks directly; routes matched tasks, blockers, decisions to agent_proposals', async () => {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const admin = fakeAdmin(calls);
    const openTasks = [
      { id: 'task-1', project_id: 'p1', title: 'Retain Surveyor (Updated Survey / Topo)', status: 'open', stage_key: null } as Task,
    ];
    const summary = await applyExtractResult(admin, 'doc1', ExtractResultSchema.parse(canned), {
      projects: [{ id: 'p1', name: '2361-2367 San Marco' }],
      openTasks,
      today: '2026-08-20',
    });
    // Direct-write counters stay at 0 now — those writes flow through proposals instead.
    expect(summary.tasks_updated).toBe(0);
    expect(summary.blockers).toBe(0);
    expect(summary.decisions).toBe(0);
    // Only the genuinely-new, unmatched task auto-creates.
    expect(summary.tasks_created).toBe(1);
    expect(summary.drafts).toBe(1);
    expect(summary.vendor_hours).toBe(1);
    expect(summary.proposals).toBe(3);

    const taskUpdates = calls.filter((c) => c.table === 'tasks' && c.op === 'update');
    expect(taskUpdates).toHaveLength(0);
    const taskInserts = calls.filter((c) => c.table === 'tasks' && c.op === 'insert');
    expect(taskInserts).toHaveLength(1);
    expect((taskInserts[0].payload as { title: string }).title).toBe('Order soils report addendum');

    const proposalInserts = calls.filter((c) => c.table === 'agent_proposals' && c.op === 'insert');
    expect(proposalInserts).toHaveLength(3);
    expect(proposalInserts.map((c) => (c.payload as { type: string }).type).sort())
      .toEqual(['blocker_create', 'decision_create', 'task_update'].sort());
    const taskUpdateProposal = proposalInserts.find((c) => (c.payload as { type: string }).type === 'task_update');
    expect(taskUpdateProposal?.payload).toMatchObject({ target_task_id: 'task-1', confidence: 0.8, state: 'pending' });
    // Agent bug #3: the blocker's quote reaches evidence_excerpt — it was
    // hardcoded null before, which is exactly what produced the empty
    // review-inbox proposals Noa reported.
    const blockerProposal = proposalInserts.find((c) => (c.payload as { type: string }).type === 'blocker_create');
    expect((blockerProposal?.payload as { evidence_excerpt: string }).evidence_excerpt)
      .toBe('Mid-Cities declined the MSA, so the grading plan has no engineer');

    // Blockers no longer insert directly (they're proposals now), so a draft's
    // re_blocker_index can't resolve to a real row yet — it lands unlinked.
    const draftInserts = calls.filter((c) => c.table === 'drafts' && c.op === 'insert');
    expect(draftInserts).toHaveLength(1);
    expect((draftInserts[0].payload as { blocker_id: string | null }).blocker_id).toBeNull();
  });

  it('reconciles create into a task_update proposal at 0.6 confidence when matcher finds same work, not a duplicate create', async () => {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const admin = fakeAdmin(calls);
    const result = ExtractResultSchema.parse({
      ...canned,
      tasks: [{ op: 'create', title: 'Retain surveyor updated survey topo', priority: 'normal' }],
      blockers: [], decisions: [], drafts: [], vendor_hours: [],
    });
    const openTasks = [
      { id: 'task-9', project_id: 'p1', title: 'Retain Surveyor (Updated Survey / Topo)', status: 'open', stage_key: null } as Task,
    ];
    const summary = await applyExtractResult(admin, 'doc1', result, {
      projects: [{ id: 'p1', name: '2361-2367 San Marco' }],
      openTasks,
      today: '2026-08-20',
    });
    expect(summary.tasks_created).toBe(0);
    expect(summary.tasks_updated).toBe(0);
    expect(summary.proposals).toBe(1);

    const taskWrites = calls.filter((c) => c.table === 'tasks');
    expect(taskWrites).toHaveLength(0);
    const proposalInserts = calls.filter((c) => c.table === 'agent_proposals' && c.op === 'insert');
    expect(proposalInserts).toHaveLength(1);
    expect(proposalInserts[0].payload).toMatchObject({ type: 'task_update', target_task_id: 'task-9', confidence: 0.6 });
  });

  it('stamps the document processed even when no project matches, instead of leaving it looking never-run', async () => {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const admin = fakeAdmin(calls);
    // project_name from the model matches nothing in the supplied project list.
    const result = ExtractResultSchema.parse({ ...canned, project_name: 'Some Unlisted Project' });
    const summary = await applyExtractResult(admin, 'doc1', result, {
      projects: [{ id: 'p1', name: '2361-2367 San Marco' }],
      openTasks: [],
      today: '2026-08-20',
    });
    expect(summary.project_id).toBeNull();
    // Nothing is created or proposed without a resolved project.
    expect(calls.filter((c) => c.table === 'tasks')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'agent_proposals')).toHaveLength(0);
    // But the agent genuinely ran, so the document is still stamped processed —
    // otherwise a later dedup hit on the same file reports it as never processed
    // (lib/ingest.ts's `processed`) even though this ran to completion.
    const docUpdates = calls.filter((c) => c.table === 'documents' && c.op === 'update');
    expect(docUpdates).toHaveLength(1);
    expect(docUpdates[0].payload).toMatchObject({ processed_at: expect.any(String) });
  });
});
