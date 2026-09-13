import { describe, expect, it } from 'vitest';
import { sanitizeReason, computePrioritizationInputHash, runPrioritization } from './prioritize-tasks.ts';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task } from '../lib/types';

// 0027 follow-up (live-caught 2026-09-11): the SYSTEM prompt forbids
// "committed"/"confirmed" language for a derived/unresolved due date, but a
// real production run reverted to it anyway on a re-run of the SAME task —
// prompt compliance is probabilistic, not guaranteed. sanitizeReason is the
// deterministic backstop; only its pure logic is unit-tested here (the LLM
// call itself, like every other agent in this codebase, is not).
describe('sanitizeReason', () => {
  it('leaves an explicit-provenance reason untouched, even with commitment language', () => {
    const reason = 'The lender confirmed the closing date; wire must go out today.';
    expect(sanitizeReason(reason, 'explicit')).toBe(reason);
  });

  it('leaves a legacy (null) provenance reason untouched — preserves today\'s behavior for every task before this feature', () => {
    const reason = 'Vendor committed to a Friday delivery.';
    expect(sanitizeReason(reason, null)).toBe(reason);
  });

  it('leaves a derived/unresolved reason untouched when it has no commitment language', () => {
    const reason = 'Greg expects to respond by end of week.';
    expect(sanitizeReason(reason, 'derived')).toBe(reason);
    expect(sanitizeReason(reason, 'unresolved')).toBe(reason);
  });

  it('does not flag an already-correctly-hedged negation ("not yet confirmed")', () => {
    const reason = 'Greg expects to respond by end of week — not yet confirmed by any source.';
    expect(sanitizeReason(reason, 'derived')).toBe(reason);
    expect(sanitizeReason(reason, 'unresolved')).toBe(reason);
  });

  it('flags "committed" for a derived due date', () => {
    const reason = 'Greg committed to revise and respond by end of this week.';
    const out = sanitizeReason(reason, 'derived');
    expect(out).toContain('Greg committed to revise');
    expect(out).toContain('(estimate only, not a confirmed date)');
  });

  it('flags "confirmed" for an unresolved due date', () => {
    const reason = 'The vendor confirmed the ship date already.';
    expect(sanitizeReason(reason, 'unresolved')).toContain('(estimate only, not a confirmed date)');
  });

  it('never produces a string longer than 300 chars, even from a long reason', () => {
    const longReason = `Greg committed to revise and respond by end of this week ${'x'.repeat(280)}`;
    const out = sanitizeReason(longReason, 'derived');
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain('(estimate only, not a confirmed date)');
  });
});

describe('computePrioritizationInputHash (Cost Controls Release 1, step 5)', () => {
  const task = (overrides: Partial<Task> = {}) => ({
    id: 't1', due: null, due_provenance: null, priority: 'normal', status: 'open',
    waiting_for: null, manual_priority: null, process_impact: null, ...overrides,
  }) as unknown as Task;
  const blocker = (overrides: Record<string, unknown> = {}) => ({
    project_id: 'p1', days_stuck: 5, kind: 'primary', ...overrides,
  }) as unknown as Pick<import('../lib/types').Blocker, 'project_id' | 'days_stuck' | 'kind'>;

  it('is stable for the same input', () => {
    const a = computePrioritizationInputHash([task()], [blocker()]);
    const b = computePrioritizationInputHash([task()], [blocker()]);
    expect(a).toBe(b);
  });

  it('is order-independent (DB row order must not affect the hash)', () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2', priority: 'critical' });
    const a = computePrioritizationInputHash([t1, t2], []);
    const b = computePrioritizationInputHash([t2, t1], []);
    expect(a).toBe(b);
  });

  it('changes when a scoring-relevant task field changes', () => {
    const base = computePrioritizationInputHash([task()], []);
    expect(computePrioritizationInputHash([task({ due: '2026-09-20' })], [])).not.toBe(base);
    expect(computePrioritizationInputHash([task({ priority: 'critical' })], [])).not.toBe(base);
    expect(computePrioritizationInputHash([task({ status: 'done' })], [])).not.toBe(base);
    expect(computePrioritizationInputHash([task({ waiting_for: 'Refael' })], [])).not.toBe(base);
    expect(computePrioritizationInputHash([task({ manual_priority: 1 })], [])).not.toBe(base);
    expect(computePrioritizationInputHash([task({ process_impact: 'primary_blocker' })], [])).not.toBe(base);
  });

  it('changes when a blocker field changes (days_stuck, kind)', () => {
    const base = computePrioritizationInputHash([task()], [blocker()]);
    expect(computePrioritizationInputHash([task()], [blocker({ days_stuck: 6 })])).not.toBe(base);
    expect(computePrioritizationInputHash([task()], [blocker({ kind: 'workstream' })])).not.toBe(base);
  });

  it('does NOT change when a non-scoring field changes (title/description are irrelevant to the hash)', () => {
    const base = computePrioritizationInputHash([task()], []);
    const withExtra = computePrioritizationInputHash(
      [{ ...task(), title: 'Totally different title', description: 'new text' } as unknown as Task],
      [],
    );
    expect(withExtra).toBe(base);
  });
});

describe('runPrioritization idempotency guard (Cost Controls Release 1, step 5)', () => {
  const openTask = {
    id: 't1', due: null, due_provenance: null, priority: 'normal', status: 'open',
    waiting_for: null, manual_priority: null, process_impact: null,
  };

  // A generic chainable fake — branches only on table name, for both the
  // priority_runs guard check and (in the "proceeds" test) the full
  // fetch -> agent -> persist path.
  function fakeAdmin(opts: { lastRunHash: string | null }): SupabaseClient {
    // Any chain method not explicitly named below (there are many across
    // selectOpenTasksExcludingTest / loadVerifiedNotes / etc.) just returns
    // the same chain — a Proxy avoids re-discovering each one by whack-a-mole.
    const make = (table: string) => {
      const base = {
        maybeSingle: async () => {
          if (table === 'priority_runs') {
            return { data: opts.lastRunHash ? { id: 'run-prev', input_hash: opts.lastRunHash, ranked: 3 } : null };
          }
          return { data: null };
        },
        single: async () => ({ data: { id: 'run-new' }, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === 'tasks') return resolve({ data: [openTask], error: null });
          return resolve({ data: [], error: null });
        },
      };
      const proxy: unknown = new Proxy(base, {
        get: (target, prop) => {
          if (prop in target) return (target as Record<string, unknown>)[prop as string];
          return () => proxy;
        },
      });
      return proxy;
    };
    const from = (table: string) => make(table);
    return { from } as unknown as SupabaseClient;
  }

  function fakeAnthropicPrioritizing(): Anthropic {
    return {
      messages: {
        create: async () => ({
          content: [{
            type: 'tool_use', id: 'tu1', name: 'report_priorities',
            input: { tasks: [{ id: 't1', score: 50, urgency: 'medium', reason: 'ok' }] },
          }],
        }),
      },
    } as unknown as Anthropic;
  }

  it('skips the model call when the input hash matches the most recent run', async () => {
    const hash = computePrioritizationInputHash([openTask as unknown as Task], []);
    const admin = fakeAdmin({ lastRunHash: hash });
    // No client passed: if the guard failed to short-circuit, this would
    // fall through to a real Anthropic call and hang/fail — proving the
    // skip happened before any model call was attempted.
    const result = await runPrioritization(admin, '2026-09-13');
    expect(result).toEqual({
      skipped: true, run_id: 'run-prev', ranked: 3,
      reason: expect.stringContaining('no relevant business data changed'),
    });
  });

  it('proceeds to a full run when there is no matching prior hash', async () => {
    const admin = fakeAdmin({ lastRunHash: 'some-other-hash' });
    const result = await runPrioritization(admin, '2026-09-13', fakeAnthropicPrioritizing());
    expect('skipped' in result).toBe(false);
    expect(result).toMatchObject({ run_id: 'run-new', ranked: 1 });
  });

  it('force:true re-runs even when the hash matches', async () => {
    const hash = computePrioritizationInputHash([openTask as unknown as Task], []);
    const admin = fakeAdmin({ lastRunHash: hash });
    const result = await runPrioritization(admin, '2026-09-13', fakeAnthropicPrioritizing(), { force: true });
    expect('skipped' in result).toBe(false);
    expect(result).toMatchObject({ run_id: 'run-new', ranked: 1 });
  });
});
