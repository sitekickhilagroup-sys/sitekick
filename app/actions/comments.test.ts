import { describe, expect, test, vi, beforeEach } from 'vitest';

// retargetComment/correctCommentIntent both call supabaseAdmin()/requireUser()
// internally (no dependency injection, unlike setItemStatusForAdmin in
// weekly.ts) — mock the modules they import instead of passing a fake client.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => fakeAdmin() }));
vi.mock('@/lib/auth', () => ({ requireUser: async () => ({ id: 'u1', email: 'noa@example.com' }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

// In-memory fake covering exactly the calls comments.ts's action functions
// make: comments/entity-table reads for validation, comments updates, and
// activity_log inserts. Table-routed like agents/extract-comms.test.ts's
// fakeAdmin, minimal enough to stay obviously correct.
let comment: { id: string; entity_type: string; entity_id: string | null; intent: string };
const validEntityIds: Record<string, Set<string>> = {
  tasks: new Set(['task-1']),
  projects: new Set(['project-1']),
  blockers: new Set(),
  invoices: new Set(),
};
const activityLog: { entity_type: string; entity_id: string; action: string; before_json: unknown; after_json: unknown }[] = [];

function fakeAdmin() {
  return {
    from(table: string) {
      return {
        select: (cols: string) => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              if (table === 'comments') {
                if (val !== comment.id) return { data: null, error: null };
                if (cols === 'entity_type,entity_id') {
                  return { data: { entity_type: comment.entity_type, entity_id: comment.entity_id }, error: null };
                }
                if (cols === 'intent') return { data: { intent: comment.intent }, error: null };
                return { data: comment, error: null };
              }
              const ids = validEntityIds[table];
              if (ids?.has(val)) return { data: { id: val }, error: null };
              return { data: null, error: null };
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async (_col: string, val: string) => {
            if (table === 'comments' && val === comment.id) Object.assign(comment, payload);
            return { error: null };
          },
        }),
        insert: (payload: { entity_type: string; entity_id: string; action: string; before_json: unknown; after_json: unknown }) => ({
          select: () => ({
            single: async () => {
              if (table === 'activity_log') activityLog.push(payload);
              return { data: { id: 'log-1' }, error: null };
            },
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  comment = { id: 'c1', entity_type: 'general', entity_id: null, intent: 'fact' };
  activityLog.length = 0;
});

// The exact bug 5b106cd fixed: Notes Center's save() calls retargetComment
// (association only, no intent field) and, only when the "We read this as…"
// select differs from the comment's current intent, ALSO calls
// correctCommentIntent — before the fix it called only the former, so a
// changed interpretation was silently discarded. This reproduces both calls
// in sequence, the way notes-center-board.tsx's save() does, and asserts
// neither write is lost — not live-UI-verifiable today since Notes Center
// deliberately excludes every is_test comment/task (see notes-center/page.tsx),
// so there is no QA-safe note to click-test against; this closes the same gap
// at the server-action level instead.
describe('Notes Center reinterpretation save (retargetComment + correctCommentIntent)', () => {
  test('retargeting to a task and changing intent both persist', async () => {
    const { retargetComment, correctCommentIntent } = await import('./comments');

    const retarget = await retargetComment('c1', 'task', 'task-1');
    expect(retarget).toEqual({ ok: true });
    expect(comment.entity_type).toBe('task');
    expect(comment.entity_id).toBe('task-1');
    // Intent must be untouched by retargetComment alone — it has no intent field.
    expect(comment.intent).toBe('fact');

    const reinterpret = await correctCommentIntent('c1', 'issue');
    expect(reinterpret).toEqual({ ok: true });
    // Both the association AND the corrected intent survive together — the
    // exact combination that was silently dropped before 5b106cd.
    expect(comment).toEqual({ id: 'c1', entity_type: 'task', entity_id: 'task-1', intent: 'issue' });

    const actions = activityLog.map((a) => a.action);
    expect(actions).toEqual(['comment:retarget', 'comment:reinterpret']);
  });

  test('retargeting to an unknown task is rejected and the comment is left unchanged', async () => {
    const { retargetComment } = await import('./comments');
    const res = await retargetComment('c1', 'task', 'does-not-exist');
    expect(res).toEqual({ error: 'task not found' });
    expect(comment).toEqual({ id: 'c1', entity_type: 'general', entity_id: null, intent: 'fact' });
  });

  test('correcting to an invalid intent is rejected', async () => {
    const { correctCommentIntent } = await import('./comments');
    const res = await correctCommentIntent('c1', 'not-a-real-intent');
    expect(res).toEqual({ error: 'invalid intent' });
    expect(comment.intent).toBe('fact');
  });

  test('marking general clears the entity association', async () => {
    comment = { id: 'c1', entity_type: 'task', entity_id: 'task-1', intent: 'fact' };
    const { retargetComment } = await import('./comments');
    const res = await retargetComment('c1', 'general');
    expect(res).toEqual({ ok: true });
    expect(comment.entity_type).toBe('general');
    expect(comment.entity_id).toBeNull();
  });
});
