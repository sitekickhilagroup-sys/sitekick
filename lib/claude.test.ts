import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runStructured, StructuredOutputError, MODELS } from './claude';
import type Anthropic from '@anthropic-ai/sdk';

const schema = z.object({ answer: z.string(), score: z.number() });

function fakeClient(responses: Array<Record<string, unknown>>): Anthropic {
  let i = 0;
  return {
    messages: {
      create: async () => responses[Math.min(i++, responses.length - 1)],
    },
  } as unknown as Anthropic;
}

const toolUse = (input: unknown) => ({
  content: [{ type: 'tool_use', id: 'tu_1', name: 'report', input }],
  stop_reason: 'tool_use',
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
    const result = await runStructured({ ...base, client });
    expect(result).toEqual({ answer: 'ok', score: 1 });
  });

  it('retries once on invalid input then succeeds', async () => {
    const client = fakeClient([
      toolUse({ answer: 'missing score' }),
      toolUse({ answer: 'ok', score: 2 }),
    ]);
    const result = await runStructured({ ...base, client });
    expect(result.score).toBe(2);
  });

  it('throws StructuredOutputError after retry fails', async () => {
    const client = fakeClient([toolUse({}), toolUse({ nope: true })]);
    await expect(runStructured({ ...base, client })).rejects.toThrow(StructuredOutputError);
  });

  it('throws when model never calls the tool', async () => {
    const client = fakeClient([{ content: [{ type: 'text', text: 'hi' }] }]);
    await expect(runStructured({ ...base, client })).rejects.toThrow(/did not call tool/);
  });
});

describe('MODELS', () => {
  it('maps all four jobs', () => {
    expect(Object.keys(MODELS).sort()).toEqual(['analyze', 'digest', 'extract', 'triage']);
  });
});
