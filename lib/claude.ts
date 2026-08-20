import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export type JobName = 'triage' | 'extract' | 'digest' | 'analyze';

// Cost switches per job (POC decision, kept): triage on Haiku,
// extraction/digest on Sonnet, weekly analysis on Opus.
export const MODELS: Record<JobName, string> = {
  triage: process.env.SITEKICK_MODEL_TRIAGE ?? 'claude-haiku-4-5',
  extract: process.env.SITEKICK_MODEL_EXTRACT ?? 'claude-sonnet-5',
  digest: process.env.SITEKICK_MODEL_DIGEST ?? 'claude-sonnet-5',
  analyze: process.env.SITEKICK_MODEL_ANALYZE ?? 'claude-opus-5',
};

export class StructuredOutputError extends Error {
  readonly lastRaw?: unknown;

  constructor(message: string, lastRaw?: unknown) {
    super(message);
    this.name = 'StructuredOutputError';
    this.lastRaw = lastRaw;
  }
}

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic();
  return singleton;
}

export interface RunStructuredOptions<T> {
  job: JobName;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription?: string;
  maxTokens?: number;
  client?: Anthropic; // injectable for tests
}

function toInputSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  return { ...json, additionalProperties: false };
}

// Forced-tool JSON: Claude must call the tool; input is Zod-validated.
// One retry feeding the validation error back, then StructuredOutputError.
export async function runStructured<T>(opts: RunStructuredOptions<T>): Promise<T> {
  const client = opts.client ?? defaultClient();
  const inputSchema = toInputSchema(opts.schema);
  const tool = {
    name: opts.toolName,
    description: opts.toolDescription ?? `Report the ${opts.toolName} result.`,
    input_schema: inputSchema as Anthropic.Tool.InputSchema,
  };

  let messages = [...opts.messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODELS[opts.job],
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages,
      tools: [tool],
      tool_choice: { type: 'tool', name: opts.toolName },
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.toolName,
    );
    if (!toolUse) {
      throw new StructuredOutputError(`Model did not call tool ${opts.toolName}`);
    }
    const parsed = opts.schema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data;

    if (attempt === 0) {
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              is_error: true,
              content: `Validation failed, call ${opts.toolName} again with corrected input: ${parsed.error.message}`,
            },
          ],
        },
      ];
      continue;
    }
    throw new StructuredOutputError(
      `Validation failed after retry: ${parsed.error.message}`,
      toolUse.input,
    );
  }
  throw new StructuredOutputError('unreachable');
}
