// Pure aggregation over llm_usage_log rows — Cost Controls Release 1's admin
// cost view. Lives outside app/actions/llm-usage.ts (a 'use server' file)
// because a synchronous export there fails the build ("Server Actions must
// be async functions"); this module has no such restriction and is
// unit-tested directly (see lib/llm-usage-summary.test.ts).

export interface LlmUsageRow {
  created_at: string;
  job: string;
  action_type: string;
  model: string;
  attempt: number;
  success: boolean;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number | null;
}

export interface LlmUsageBreakdownRow {
  job: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface LlmUsageSummary {
  cost_today_usd: number;
  cost_week_usd: number;
  cost_month_usd: number;
  input_tokens_month: number;
  output_tokens_month: number;
  calls_month: number;
  successes_month: number;
  failures_month: number;
  by_job_model: LlmUsageBreakdownRow[];
  recent: LlmUsageRow[];
  last_run_at: string | null;
}

function emptySummary(): LlmUsageSummary {
  return {
    cost_today_usd: 0, cost_week_usd: 0, cost_month_usd: 0,
    input_tokens_month: 0, output_tokens_month: 0,
    calls_month: 0, successes_month: 0, failures_month: 0,
    by_job_model: [], recent: [], last_run_at: null,
  };
}

/** Pure aggregation over an already-fetched (last 30 days) row set — kept
 *  separate from the DB call so it's unit-testable without Supabase. */
export function summarizeLlmUsage(rows: LlmUsageRow[], now: Date = new Date()): LlmUsageSummary {
  if (!rows.length) return emptySummary();
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const byJobModel = new Map<string, LlmUsageBreakdownRow>();
  let costToday = 0; let costWeek = 0; let costMonth = 0;
  let inputMonth = 0; let outputMonth = 0;
  let successes = 0; let failures = 0;
  let lastRunAt: string | null = null;

  for (const r of rows) {
    const t = Date.parse(r.created_at);
    const cost = r.estimated_cost_usd ?? 0;
    costMonth += cost;
    inputMonth += r.input_tokens;
    outputMonth += r.output_tokens;
    if (r.success) successes++; else failures++;
    if (t >= weekAgo) costWeek += cost;
    if (t >= dayAgo) costToday += cost;
    if (!lastRunAt || t > Date.parse(lastRunAt)) lastRunAt = r.created_at;

    const key = `${r.job}::${r.model}`;
    const row = byJobModel.get(key) ?? { job: r.job, model: r.model, calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    row.calls++;
    row.input_tokens += r.input_tokens;
    row.output_tokens += r.output_tokens;
    row.cost_usd += cost;
    byJobModel.set(key, row);
  }

  return {
    cost_today_usd: costToday, cost_week_usd: costWeek, cost_month_usd: costMonth,
    input_tokens_month: inputMonth, output_tokens_month: outputMonth,
    calls_month: rows.length, successes_month: successes, failures_month: failures,
    by_job_model: [...byJobModel.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    recent: [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 20),
    last_run_at: lastRunAt,
  };
}
