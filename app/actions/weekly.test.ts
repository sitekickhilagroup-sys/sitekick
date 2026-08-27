import { describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setItemStatusForAdmin } from './weekly';

// Chainable capturing fake for the supabase admin client — same pattern
// agents/extract-comms.test.ts's fakeAdmin and lib/ingest.test.ts's
// fakeAdmin already use (table-routed reads, a `calls` array capturing
// writes), extended just enough to also capture WHICH id an .eq() targeted,
// since that id is exactly what this fix is about.
interface FakeItem {
  id: string;
  task_id: string;
  weekly_review_id: string;
  status_snapshot: string;
}

interface Call {
  table: string;
  op: 'update' | 'insert';
  eqCol?: string;
  eqVal?: string;
  payload?: unknown;
}

function fakeAdmin(opts: { item: FakeItem; reviewStatus: string }): { admin: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => {
        if (table === 'weekly_review_items') return { data: opts.item, error: null };
        if (table === 'weekly_reviews') return { data: { status: opts.reviewStatus }, error: null };
        return { data: null, error: null };
      },
      update: (payload: unknown) => ({
        eq: async (eqCol: string, eqVal: string) => {
          calls.push({ table, op: 'update', eqCol, eqVal, payload });
          return { error: null };
        },
      }),
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', payload });
        return { select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }) };
      },
    };
    return chain;
  };
  return { admin: { from } as unknown as SupabaseClient, calls };
}

const EDITABLE_ITEM: FakeItem = {
  id: 'item-1', task_id: 'real-task-1', weekly_review_id: 'review-1', status_snapshot: 'open',
};

describe('setItemStatusForAdmin — authorization', () => {
  test('writes to the gated item\'s own task_id, never the client-supplied one, when they differ', async () => {
    const { admin, calls } = fakeAdmin({ item: EDITABLE_ITEM, reviewStatus: 'preparing' });

    // A caller passes itemId (real, on an editable review) paired with a
    // taskId that does NOT belong to that item — exactly the shape a
    // signed-in browser could send to mark an unrelated task done.
    const res = await setItemStatusForAdmin(admin, 'noa@example.com', 'item-1', 'attacker-supplied-task-id', 'completed');

    expect(res).toEqual({ ok: true });
    const taskUpdate = calls.find((c) => c.table === 'tasks' && c.op === 'update');
    expect(taskUpdate?.eqVal).toBe('real-task-1');
    expect(taskUpdate?.eqVal).not.toBe('attacker-supplied-task-id');

    // The audit row must name the same, real task — an entry attributing
    // the change to the supplied id would be just as wrong as the write
    // itself would have been.
    const auditInsert = calls.find((c) => c.table === 'activity_log' && c.op === 'insert');
    expect((auditInsert?.payload as { entity_id: string }).entity_id).toBe('real-task-1');

    // The review item's own status_snapshot still updates by itemId — that
    // part was never in question, only which TASK got written.
    const itemUpdate = calls.find((c) => c.table === 'weekly_review_items' && c.op === 'update');
    expect(itemUpdate?.eqVal).toBe('item-1');
  });

  test('a matching taskId writes the same task — the common, non-adversarial case is unaffected', async () => {
    const { admin, calls } = fakeAdmin({ item: EDITABLE_ITEM, reviewStatus: 'preparing' });
    const res = await setItemStatusForAdmin(admin, 'noa@example.com', 'item-1', 'real-task-1', 'not_applicable');
    expect(res).toEqual({ ok: true });
    const taskUpdate = calls.find((c) => c.table === 'tasks' && c.op === 'update');
    expect(taskUpdate?.eqVal).toBe('real-task-1');
  });

  test('a finalized review still refuses the write, regardless of which taskId was supplied', async () => {
    const { admin, calls } = fakeAdmin({ item: EDITABLE_ITEM, reviewStatus: 'final' });
    const res = await setItemStatusForAdmin(admin, 'noa@example.com', 'item-1', 'real-task-1', 'completed');
    expect('error' in res).toBe(true);
    expect(calls.filter((c) => c.table === 'tasks')).toHaveLength(0);
  });
});
