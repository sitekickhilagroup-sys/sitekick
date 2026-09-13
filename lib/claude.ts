import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase/admin';

export type JobName = 'triage' | 'extract' | 'digest' | 'analyze';

// Cost switches per job (POC decision, kept): triage on Haiku,
// extraction/digest on Sonnet, weekly analysis on Opus.
export const MODELS: Record<JobName, string> = {
  triage: process.env.SITEKICK_MODEL_TRIAGE ?? 'claude-haiku-4-5',
  extract: process.env.SITEKICK_MODEL_EXTRACT ?? 'claude-sonnet-5',
  digest: process.env.SITEKICK_MODEL_DIGEST ?? 'claude-sonnet-5',
  analyze: process.env.SITEKICK_MODEL_ANALYZE ?? 'claude-opus-5',
};

// $ per million tokens. Used only to compute an estimated_cost_usd for
// llm_usage_log — never sent to the model, never affects behavior. Update
// when Anthropic pricing changes; an unknown model logs with cost = null
// rather than guessing.
const PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-4-5': { input: 1.00, output: 5.00, cacheWrite: 1.25, cacheRead: 0.10 },
  'claude-sonnet-5': { input: 2.00, output: 10.00, cacheWrite: 2.50, cacheRead: 0.20 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-5': { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-8': { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-7': { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6': { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
};

function estimateCostUsd(model: string, usage: {
  input_tokens?: number; output_tokens?: number;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
}): number | null {
  const price = PRICING_PER_MTOK[model];
  if (!price) return null;
  const inputTok = usage.input_tokens ?? 0;
  const outputTok = usage.output_tokens ?? 0;
  const cacheWriteTok = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTok = usage.cache_read_input_tokens ?? 0;
  return (
    (inputTok * price.input
      + outputTok * price.output
      + cacheWriteTok * price.cacheWrite
      + cacheReadTok * price.cacheRead) / 1_000_000
  );
}

interface UsageLogInput {
  job: JobName;
  actionType: string;
  model: string;
  attempt: number;
  success: boolean;
  errorMessage?: string;
  usage?: {
    input_tokens?: number; output_tokens?: number;
    cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
  };
  documentId?: string;
  runId?: string;
}

// Best-effort, fire-and-forget-shaped but awaited: a logging failure must
// NEVER surface as a runStructured failure (mirrors recordPriorityFeedback in
// lib/collect-priority-feedback.ts). Never throws. `admin` is injectable so
// unit tests (fake Anthropic client, no real API calls) never touch the real
// Supabase project — see lib/claude.test.ts.
async function logUsage(admin: SupabaseClient, entry: UsageLogInput): Promise<void> {
  try {
    await admin.from('llm_usage_log').insert({
      job: entry.job,
      action_type: entry.actionType,
      model: entry.model,
      attempt: entry.attempt,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
      input_tokens: entry.usage?.input_tokens ?? 0,
      output_tokens: entry.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: entry.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: entry.usage?.cache_read_input_tokens ?? 0,
      estimated_cost_usd: entry.usage ? estimateCostUsd(entry.model, entry.usage) : null,
      document_id: entry.documentId ?? null,
      run_id: entry.runId ?? null,
    });
  } catch (e) {
    console.error('[llm-usage] log failed (non-fatal)', { job: entry.job, actionType: entry.actionType, error: e });
  }
}

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
  // Usage-logging metadata (all optional, all additive — no existing call
  // site needs to change). actionType defaults to `job` when omitted; pass a
  // more specific label (e.g. 'extract-comms', 'infer-phase-pass1') so
  // llm_usage_log can distinguish call sites that share a job/model.
  actionType?: string;
  documentId?: string;
  runId?: string;
  usageLogClient?: SupabaseClient; // injectable for tests; defaults to supabaseAdmin()
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
  const model = MODELS[opts.job];
  const actionType = opts.actionType ?? opts.job;
  // Resolving the admin client can itself throw (missing env vars in a local
  // dev/test setup); that must degrade to "skip logging", never break the
  // actual extraction the caller is waiting on. Under Vitest, only log when a
  // test explicitly injects usageLogClient — every agent (extract-comms,
  // parse-invoice, infer-phase, ...) calls runStructured without one, and
  // without this guard every one of those unit tests would silently attempt
  // a real write to the production llm_usage_log table.
  let usageLogClient: SupabaseClient | null = null;
  if (opts.usageLogClient) {
    usageLogClient = opts.usageLogClient;
  } else if (!process.env.VITEST) {
    try {
      usageLogClient = supabaseAdmin();
    } catch (e) {
      console.error('[llm-usage] admin client unavailable (non-fatal)', e);
    }
  }
  const logAttempt = (attempt: number, success: boolean, usage: Anthropic.Usage | undefined, errorMessage?: string) => {
    if (!usageLogClient) return Promise.resolve();
    return logUsage(usageLogClient, {
      job: opts.job, actionType, model, attempt: attempt + 1, success, errorMessage,
      usage, documentId: opts.documentId, runId: opts.runId,
    });
  };

  let messages = [...opts.messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages,
      tools: [tool],
      tool_choice: { type: 'tool', name: opts.toolName },
    };
    // Large max_tokens budgets make the SDK refuse non-streaming calls
    // ("Streaming is required for operations that may take longer than 10
    // minutes" — this silently killed the first prioritization cron run).
    // Stream when the client supports it; the plain create path stays for
    // test fakes that only implement messages.create.
    const streamFn = (client.messages as unknown as { stream?: unknown }).stream;
    const response = typeof streamFn === 'function'
      ? await client.messages.stream(params).finalMessage()
      : await client.messages.create(params);
    // response.usage is never discarded past this point — every attempt,
    // success or failure, gets a llm_usage_log row (Cost Controls Release 1).
    const usage = response.usage as Anthropic.Usage | undefined;

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.toolName,
    );
    if (!toolUse) {
      await logAttempt(attempt, false, usage, `Model did not call tool ${opts.toolName}`);
      throw new StructuredOutputError(`Model did not call tool ${opts.toolName}`);
    }
    const parsed = opts.schema.safeParse(toolUse.input);
    if (parsed.success) {
      await logAttempt(attempt, true, usage);
      return parsed.data;
    }

    if (attempt === 0) {
      await logAttempt(attempt, false, usage, `Validation failed: ${parsed.error.message}`);
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
    await logAttempt(attempt, false, usage, `Validation failed after retry: ${parsed.error.message}`);
    throw new StructuredOutputError(
      `Validation failed after retry: ${parsed.error.message}`,
      toolUse.input,
    );
  }
  throw new StructuredOutputError('unreachable');
}
