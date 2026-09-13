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

// Demo Safety Gate: a PRE-call, worst-case cost estimate — no tokenizer call
// (that would itself cost money/a request), just chars/4 as the standard
// rough proxy for input tokens, and the request's own max_tokens as the
// output ceiling (the model provably cannot emit more than that, so using it
// as the estimate can only overstate cost, never understate it — the
// conservative direction for a budget gate). Exported so callers that want
// their OWN tighter, scoped budget (e.g. the Data Inbox pilot batch) can use
// the exact same estimator runStructured's global gate uses below.
export function estimateCallCostUsd(model: string, inputChars: number, maxOutputTokens: number): number | null {
  const price = PRICING_PER_MTOK[model];
  if (!price) return null;
  const estInputTokens = inputChars / 4;
  return (estInputTokens * price.input + maxOutputTokens * price.output) / 1_000_000;
}

function estimateInputChars(system: string, messages: Anthropic.MessageParam[]): number {
  return system.length + messages.reduce((sum, m) => {
    const c = m.content;
    return sum + (typeof c === 'string' ? c.length : JSON.stringify(c).length);
  }, 0);
}

// Demo Safety Gate: a hard, unconditional cumulative cap on total Anthropic
// spend, enforced HERE — the single chokepoint every agent (extract-comms,
// parse-invoice, infer-phase, prioritize-tasks, digest, triage) already goes
// through — so no caller, cron, retry, or "Process all now" can bypass it by
// construction. $20 leaves a $10 margin under the demo's real $30 account
// budget. Measured as the all-time sum of llm_usage_log.estimated_cost_usd
// (that table starts at zero rows, so the sum starts counting from exactly
// when this gate shipped).
export const DEMO_BUDGET_USD = Number(process.env.DEMO_BUDGET_USD ?? 20);

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly estimatedCallUsd: number,
    readonly capUsd: number,
  ) {
    super(`Demo budget: $${spentUsd.toFixed(4)} already spent + ~$${estimatedCallUsd.toFixed(4)} estimated for this call > $${capUsd} cap — call blocked before it was made.`);
    this.name = 'BudgetExceededError';
  }
}

/** Fail-CLOSED variant (Rotem, hardening round, 2026-09-13): thrown when
 *  current spend cannot be verified at all (the usage-log client couldn't be
 *  resolved, or the spend query itself failed) — a hard $30-account demo
 *  must never let a call through on "couldn't check, so assume it's fine."
 *  Distinct from BudgetExceededError (verified spend that's actually over
 *  cap) so callers/logs can tell "we know it's too expensive" apart from
 *  "we don't know and won't guess." */
export class BudgetUnverifiableError extends Error {
  constructor(reason: string) {
    super(`Demo budget cannot be verified (${reason}) — call blocked rather than risk unmetered spend.`);
    this.name = 'BudgetUnverifiableError';
  }
}

/** Real, current all-time spend — client-side sum over llm_usage_log rather
 *  than a DB-side aggregate, so this needs no new SQL function and stays
 *  simple to fake in tests. Fine at demo scale (dozens-hundreds of rows over
 *  two weeks); the 20000 cap is just a sanity ceiling, not an expected size. */
async function currentSpentUsd(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('llm_usage_log').select('estimated_cost_usd').limit(20000);
  return (data ?? []).reduce((sum: number, r: { estimated_cost_usd: number | null }) => sum + (r.estimated_cost_usd ?? 0), 0);
}

/**
 * A tighter, scoped sub-budget layered on top of the global DEMO_BUDGET_USD
 * cap — e.g. the Data Inbox pilot run's $2 ceiling across up to 5 documents.
 * `spentUsd` is mutated by runStructured itself after every REAL attempt
 * (whether it succeeded, failed, or is about to retry) using the ACTUAL
 * response.usage-derived cost, not the pre-call estimate — so a caller
 * threading the same scope object through multiple runStructured calls
 * (possibly several documents, each possibly retrying once) gets true
 * enforcement against the full real payload and every attempt, not a guess
 * from raw_text length alone. Pass the SAME object by reference across every
 * call in the scope; a fresh object starts a fresh $0 baseline.
 */
export interface BudgetScope {
  capUsd: number;
  spentUsd: number;
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
  // A tighter sub-budget layered on top of the global DEMO_BUDGET_USD cap
  // (e.g. the Data Inbox pilot run's $2 across up to 5 documents) — pass the
  // SAME object across every runStructured call in the scope; this function
  // mutates its spentUsd with the REAL post-call cost after every attempt.
  budgetScope?: BudgetScope;
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
  // dev/test setup). Under Vitest with no injected usageLogClient, that's a
  // test scenario with no real spend to protect — logging AND the budget
  // check both skip (every agent's own fake-Anthropic-client test relies on
  // this; forcing them all to inject a usageLogClient just to keep passing
  // would be a much bigger, unrelated change). Outside Vitest, unresolvable
  // is a REAL problem — see the fail-closed budget check below, which
  // treats "no usageLogClient" as "cannot verify spend" rather than
  // silently skipping.
  let usageLogClient: SupabaseClient | null = null;
  if (opts.usageLogClient) {
    usageLogClient = opts.usageLogClient;
  } else if (!process.env.VITEST) {
    try {
      usageLogClient = supabaseAdmin();
    } catch (e) {
      console.error('[llm-usage] admin client unavailable', e);
    }
  }
  const mustVerifyBudget = !!usageLogClient || !process.env.VITEST;
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
    // Demo Safety Gate (hardened, 2026-09-13): stop BEFORE a call expected to
    // push spend past a cap — never after. Re-checked on the validation
    // retry too (attempt 1), since that is also a real, separately-billed
    // call. FAIL CLOSED: if spend cannot be verified at all — the client is
    // unavailable, or the query itself fails — the call is BLOCKED, not
    // allowed through on "couldn't check, so assume it's fine." A hard
    // $30-account demo must never spend blind.
    const estThisCall = estimateCallCostUsd(model, estimateInputChars(opts.system, messages), opts.maxTokens ?? 16000) ?? 0;
    if (mustVerifyBudget) {
      if (!usageLogClient) {
        await logAttempt(attempt, false, undefined, 'budget_unverifiable: usage log client unavailable');
        throw new BudgetUnverifiableError('usage log client unavailable');
      }
      let spent: number;
      try {
        spent = await currentSpentUsd(usageLogClient);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        await logAttempt(attempt, false, undefined, `budget_unverifiable: ${reason}`);
        throw new BudgetUnverifiableError(reason);
      }
      if (spent + estThisCall > DEMO_BUDGET_USD) {
        await logAttempt(
          attempt, false, undefined,
          `budget_exceeded: spent $${spent.toFixed(4)} + est $${estThisCall.toFixed(4)} > cap $${DEMO_BUDGET_USD}`,
        );
        throw new BudgetExceededError(spent, estThisCall, DEMO_BUDGET_USD);
      }
      // A tighter caller-scoped cap (e.g. the pilot's $2 across up to 5
      // documents) — its spentUsd tracks REAL post-call cost (below), so
      // this is true enforcement against the actual payload and every
      // attempt, not an upfront guess from raw_text length alone.
      if (opts.budgetScope && opts.budgetScope.spentUsd + estThisCall > opts.budgetScope.capUsd) {
        await logAttempt(
          attempt, false, undefined,
          `budget_exceeded: scope spent $${opts.budgetScope.spentUsd.toFixed(4)} + est $${estThisCall.toFixed(4)} > scope cap $${opts.budgetScope.capUsd}`,
        );
        throw new BudgetExceededError(opts.budgetScope.spentUsd, estThisCall, opts.budgetScope.capUsd);
      }
    }
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
    // A real, billed call just happened — count its ACTUAL cost against the
    // scope immediately, regardless of what happens next (success, retry, or
    // final failure), so a caller looping over several documents/attempts
    // sees true accumulated spend, not just estimates.
    if (opts.budgetScope) {
      opts.budgetScope.spentUsd += (usage ? estimateCostUsd(model, usage) : null) ?? 0;
    }

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
