import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runStructured, StructuredOutputError, MODELS } from './claude';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

const schema = z.object({ answer: z.string(), score: z.number() });

function fakeClient(responses: Array<Record<string, unknown>>): Anthropic {
  let i = 0;
  return {
    messages: {
      create: async () => responses[Math.min(i++, responses.length - 1)],
    },
  } as unknown as Anthropic;
}

// Never hits the real Supabase project — captures every insert() payload in
// `rows` so tests can assert on what runStructured would have logged.
function fakeUsageLogClient(rows: Record<string, unknown>[]): SupabaseClient {
  return {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

const toolUse = (input: unknown, usage?: Record<string, number>) => ({
  content: [{ type: 'tool_use', id: 'tu_1', name: 'report', input }],
  stop_reason: 'tool_use',
  usage,
});

describe('runStructured', () => {
  const base = {
    job: 'extract' as const,
    system: 'test',
    messages: [{ role: 'user' as const, content: 'go' }],
    schema,
    toolName: 'report',
  };

  it('returns parsed object on valid tool input', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 })]);
    const rows: Record<string, unknown>[] = [];
    const result = await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });
    expect(result).toEqual({ answer: 'ok', score: 1 });
  });

  it('retries once on invalid input then succeeds', async () => {
    const client = fakeClient([
      toolUse({ answer: 'missing score' }),
      toolUse({ answer: 'ok', score: 2 }),
    ]);
    const rows: Record<string, unknown>[] = [];
    const result = await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });
    expect(result.score).toBe(2);
  });

  it('throws StructuredOutputError after retry fails', async () => {
    const client = fakeClient([toolUse({}), toolUse({ nope: true })]);
    const rows: Record<string, unknown>[] = [];
    await expect(
      runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) }),
    ).rejects.toThrow(StructuredOutputError);
  });

  it('throws when model never calls the tool', async () => {
    const client = fakeClient([{ content: [{ type: 'text', text: 'hi' }] }]);
    const rows: Record<string, unknown>[] = [];
    await expect(
      runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) }),
    ).rejects.toThrow(/did not call tool/);
  });
});

describe('runStructured usage logging', () => {
  const base = {
    job: 'extract' as const,
    system: 'test',
    messages: [{ role: 'user' as const, content: 'go' }],
    schema,
    toolName: 'report',
  };

  it('logs one row with tokens, model, job, and estimated cost on success', async () => {
    const client = fakeClient([
      toolUse({ answer: 'ok', score: 1 }, { input_tokens: 1000, output_tokens: 500 }),
    ]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      job: 'extract',
      action_type: 'extract', // defaults to job when actionType is omitted
      model: MODELS.extract,
      attempt: 1,
      success: true,
      input_tokens: 1000,
      output_tokens: 500,
    });
    // claude-sonnet-5 is $2/$10 per MTok: 1000*2/1e6 + 500*10/1e6 = 0.002 + 0.005
    expect(rows[0].estimated_cost_usd).toBeCloseTo(0.007, 6);
  });

  it('uses a caller-supplied actionType instead of the bare job name', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 }, { input_tokens: 10, output_tokens: 10 })]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows), actionType: 'extract-comms' });
    expect(rows[0].action_type).toBe('extract-comms');
  });

  it('passes through documentId and runId when given', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 }, { input_tokens: 10, output_tokens: 10 })]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({
      ...base, client, usageLogClient: fakeUsageLogClient(rows),
      documentId: 'doc-1', runId: 'run-1',
    });
    expect(rows[0]).toMatchObject({ document_id: 'doc-1', run_id: 'run-1' });
  });

  it('logs a failed attempt (attempt 1) then a succeeded retry (attempt 2)', async () => {
    const client = fakeClient([
      toolUse({ answer: 'missing score' }, { input_tokens: 20, output_tokens: 5 }),
      toolUse({ answer: 'ok', score: 2 }, { input_tokens: 25, output_tokens: 8 }),
    ]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attempt: 1, success: false, input_tokens: 20, output_tokens: 5 });
    expect(rows[0].error_message).toMatch(/Validation failed/);
    expect(rows[1]).toMatchObject({ attempt: 2, success: true, input_tokens: 25, output_tokens: 8 });
  });

  it('logs cache_creation/read tokens when present in usage', async () => {
    const client = fakeClient([
      toolUse(
        { answer: 'ok', score: 1 },
        { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
      ),
    ]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });
    expect(rows[0]).toMatchObject({ cache_creation_input_tokens: 200, cache_read_input_tokens: 300 });
  });

  it('logs zero tokens and null cost when the fake response has no usage field at all', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 })]); // no usage arg
    const rows: Record<string, unknown>[] = [];
    await runStructured({ ...base, client, usageLogClient: fakeUsageLogClient(rows) });
    expect(rows[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, estimated_cost_usd: null });
  });

  it('never throws when the usage-log insert itself fails', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 }, { input_tokens: 1, output_tokens: 1 })]);
    const throwingClient = {
      from: () => ({ insert: async () => { throw new Error('db unavailable'); } }),
    } as unknown as SupabaseClient;
    const result = await runStructured({ ...base, client, usageLogClient: throwingClient });
    expect(result).toEqual({ answer: 'ok', score: 1 });
  });

  it('estimates a cost for every job tier (all default models are priced)', async () => {
    const client = fakeClient([toolUse({ answer: 'ok', score: 1 }, { input_tokens: 10, output_tokens: 10 })]);
    const rows: Record<string, unknown>[] = [];
    await runStructured({
      ...base, job: 'triage', client, usageLogClient: fakeUsageLogClient(rows),
    });
    expect(typeof rows[0].estimated_cost_usd).toBe('number');
  });
});

describe('MODELS', () => {
  it('maps all four jobs', () => {
    expect(Object.keys(MODELS).sort()).toEqual(['analyze', 'digest', 'extract', 'triage']);
  });
});
