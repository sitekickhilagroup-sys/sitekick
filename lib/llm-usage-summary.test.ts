import { describe, expect, it } from 'vitest';
import { summarizeLlmUsage, type LlmUsageRow } from './llm-usage-summary';

const now = new Date('2026-09-13T12:00:00Z');

function row(overrides: Partial<LlmUsageRow> = {}): LlmUsageRow {
  return {
    created_at: now.toISOString(),
    job: 'extract', action_type: 'extract-comms', model: 'claude-sonnet-5',
    attempt: 1, success: true, input_tokens: 100, output_tokens: 50,
    estimated_cost_usd: 0.0007,
    ...overrides,
  };
}

describe('summarizeLlmUsage', () => {
  it('returns an all-zero summary for no rows', () => {
    const s = summarizeLlmUsage([], now);
    expect(s).toEqual({
      cost_today_usd: 0, cost_week_usd: 0, cost_month_usd: 0,
      input_tokens_month: 0, output_tokens_month: 0,
      calls_month: 0, successes_month: 0, failures_month: 0,
      by_job_model: [], recent: [], last_run_at: null,
    });
  });

  it('buckets cost into today/week/month by created_at age', () => {
    const rows = [
      row({ created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(), estimated_cost_usd: 1 }), // 1h ago
      row({ created_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), estimated_cost_usd: 2 }), // 3d ago
      row({ created_at: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(), estimated_cost_usd: 4 }), // 20d ago
    ];
    const s = summarizeLlmUsage(rows, now);
    expect(s.cost_today_usd).toBeCloseTo(1, 6);
    expect(s.cost_week_usd).toBeCloseTo(3, 6); // 1h + 3d
    expect(s.cost_month_usd).toBeCloseTo(7, 6); // all three
  });

  it('treats a null estimated_cost_usd (unpriced model) as zero, not a crash', () => {
    const s = summarizeLlmUsage([row({ estimated_cost_usd: null })], now);
    expect(s.cost_today_usd).toBe(0);
    expect(s.cost_month_usd).toBe(0);
  });

  it('counts successes and failures separately', () => {
    const s = summarizeLlmUsage([row({ success: true }), row({ success: false }), row({ success: false })], now);
    expect(s.calls_month).toBe(3);
    expect(s.successes_month).toBe(1);
    expect(s.failures_month).toBe(2);
  });

  it('groups by job+model, summing calls/tokens/cost, sorted by cost desc', () => {
    const rows = [
      row({ job: 'extract', model: 'claude-sonnet-5', input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 }),
      row({ job: 'extract', model: 'claude-sonnet-5', input_tokens: 200, output_tokens: 60, estimated_cost_usd: 0.002 }),
      row({ job: 'analyze', model: 'claude-opus-5', input_tokens: 500, output_tokens: 300, estimated_cost_usd: 0.01 }),
    ];
    const s = summarizeLlmUsage(rows, now);
    expect(s.by_job_model).toEqual([
      { job: 'analyze', model: 'claude-opus-5', calls: 1, input_tokens: 500, output_tokens: 300, cost_usd: 0.01 },
      { job: 'extract', model: 'claude-sonnet-5', calls: 2, input_tokens: 300, output_tokens: 110, cost_usd: expect.closeTo(0.003, 6) },
    ]);
  });

  it('returns at most the 20 most recent rows, newest first', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ created_at: new Date(now.getTime() - i * 60 * 1000).toISOString(), action_type: `a${i}` }));
    const s = summarizeLlmUsage(rows, now);
    expect(s.recent).toHaveLength(20);
    expect(s.recent[0].action_type).toBe('a0'); // newest
    expect(s.recent[19].action_type).toBe('a19');
  });

  it('reports last_run_at as the max created_at regardless of row order', () => {
    const rows = [
      row({ created_at: new Date(now.getTime() - 10 * 60 * 1000).toISOString() }),
      row({ created_at: now.toISOString() }),
      row({ created_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString() }),
    ];
    const s = summarizeLlmUsage(rows, now);
    expect(s.last_run_at).toBe(now.toISOString());
  });
});
