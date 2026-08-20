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
    { what: 'Grading plan has no engineer', blocked_by: 'Mid-Cities MSA refusal', downstream: ['plan_check'] },
  ],
  decisions: [{ title: 'Proceed with Crest for entitlements' }],
  drafts: [{ subject: 'MSA decision needed', body: 'Refael — decision needed this week.', re_blocker_index: 0 }],
  vendor_hours: [{ vendor_name: 'KGS Structural', hours: 12, rate: 180 }],
  deadline_updates: [],
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
  it('updates matched tasks, inserts new ones, links blocker drafts', async () => {
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
    expect(summary.tasks_updated).toBe(1);
    expect(summary.tasks_created).toBe(1);
    expect(summary.blockers).toBe(1);
    expect(summary.drafts).toBe(1);
    expect(summary.vendor_hours).toBe(1);
    const taskUpdates = calls.filter((c) => c.table === 'tasks' && c.op === 'update');
    expect(taskUpdates).toHaveLength(1);
    const taskInserts = calls.filter((c) => c.table === 'tasks' && c.op === 'insert');
    expect(taskInserts).toHaveLength(1);
  });

  it('reconciles create into update when matcher finds same work', async () => {
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
    expect(summary.tasks_updated).toBe(1);
    expect(summary.tasks_created).toBe(0);
  });
});
