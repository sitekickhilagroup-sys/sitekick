import { describe, expect, it } from 'vitest';
import { inferProjectPhase } from './infer-phase';
import { MODELS } from '../lib/claude';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

interface CannedAnswer {
  phase_key: string;
  confidence: number;
  evidence: string;
  reasoning: string;
}

// Records every request (model + messages) so tests can assert on model
// tiering and on the cached dataMessage block, without a real API call.
function fakeClientRecording(responses: CannedAnswer[]): {
  client: Anthropic;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
} {
  let i = 0;
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(params);
        const input = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return { content: [{ type: 'tool_use', id: `tu${i}`, name: 'report_phase', input }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

// Only the `projects`/`tasks`/`documents`/`phases`/`substage_templates`
// queries inferProjectPhase actually issues.
function fakeAdmin(opts: {
  project: Record<string, unknown> | null;
  tasks?: Record<string, unknown>[];
  docs?: Record<string, unknown>[];
}): SupabaseClient {
  const make = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: opts.project }),
      then: (resolve: (v: { data: unknown }) => void) => {
        const data = table === 'tasks' ? (opts.tasks ?? [{ title: 'Do the thing', stage_key: null, due: null }])
          : table === 'documents' ? (opts.docs ?? [])
          : [];
        resolve({ data });
      },
    };
    return chain;
  };
  return { from: make } as unknown as SupabaseClient;
}

describe('inferProjectPhase model tiering (Cost Controls Release 1, step 4)', () => {
  it('runs pass 1 and pass 2 on Sonnet (job: digest) and stops there when they agree', async () => {
    const { client, calls } = fakeClientRecording([
      { phase_key: 'planning', confidence: 0.9, evidence: 'e1', reasoning: 'r1' },
      { phase_key: 'planning', confidence: 0.85, evidence: 'e2', reasoning: 'r2' },
    ]);
    const admin = fakeAdmin({ project: { name: 'Test Project' } });
    const result = await inferProjectPhase(admin, 'proj-1', client);

    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe(MODELS.digest);
    expect(calls[1].model).toBe(MODELS.digest);
    expect(calls.every((c) => c.model !== MODELS.analyze)).toBe(true);
    expect(result).toMatchObject({ phase_key: 'planning' });
  });

  it('escalates to Opus (job: analyze) only for pass 3, and only when pass 1 and pass 2 disagree', async () => {
    const { client, calls } = fakeClientRecording([
      { phase_key: 'planning', confidence: 0.9, evidence: 'e1', reasoning: 'r1' },
      { phase_key: 'plan_check', confidence: 0.7, evidence: 'e2', reasoning: 'r2' },
      { phase_key: 'plan_check', confidence: 0.95, evidence: 'e3', reasoning: 'r3' },
    ]);
    const admin = fakeAdmin({ project: { name: 'Test Project' } });
    const result = await inferProjectPhase(admin, 'proj-1', client);

    expect(calls).toHaveLength(3);
    expect(calls[0].model).toBe(MODELS.digest);
    expect(calls[1].model).toBe(MODELS.digest);
    expect(calls[2].model).toBe(MODELS.analyze);
    expect(result).toMatchObject({ phase_key: 'plan_check', confidence: 0.95 });
  });

  it('marks the shared data payload as its own cache_control block, byte-identical across passes', async () => {
    const { client, calls } = fakeClientRecording([
      { phase_key: 'planning', confidence: 0.9, evidence: 'e1', reasoning: 'r1' },
      { phase_key: 'planning', confidence: 0.85, evidence: 'e2', reasoning: 'r2' },
    ]);
    const admin = fakeAdmin({ project: { name: 'Test Project' } });
    await inferProjectPhase(admin, 'proj-1', client);

    const block1 = (calls[0].messages[0].content as Anthropic.TextBlockParam[])[0];
    const block2 = (calls[1].messages[0].content as Anthropic.TextBlockParam[])[0];
    expect(block1.cache_control).toEqual({ type: 'ephemeral' });
    expect(block2.cache_control).toEqual({ type: 'ephemeral' });
    // Identical bytes is what makes this a cache HIT rather than a second
    // cache WRITE — any drift here (e.g. a timestamp) would silently disable
    // caching in production.
    expect(block2).toEqual(block1);

    // Pass 2's message carries exactly one more block (the pass-1 answer +
    // instruction) appended AFTER the cached block, never merged into it.
    expect((calls[1].messages[0].content as Anthropic.TextBlockParam[])).toHaveLength(2);
    expect((calls[0].messages[0].content as Anthropic.TextBlockParam[])).toHaveLength(1);
  });

  it('still skips (no model call at all) when the project has no open tasks or documents', async () => {
    const { client, calls } = fakeClientRecording([]);
    const admin = fakeAdmin({ project: { name: 'Test Project' }, tasks: [], docs: [] });
    const result = await inferProjectPhase(admin, 'proj-1', client);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ skipped: 'no open tasks or communications to infer from' });
  });
});
