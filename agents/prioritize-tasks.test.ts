import { describe, expect, it } from 'vitest';
import { sanitizeReason } from './prioritize-tasks.ts';

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
