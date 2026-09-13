import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processSelectedDocuments, getDataInboxTriage, PILOT_MAX_DOCS, PILOT_BUDGET_USD } from './data-inbox';
import { BudgetExceededError, BudgetUnverifiableError } from './claude';

// A generic chainable fake — branches only on table name. Any table
// processDocument reaches AFTER the idempotency guard (projects/tasks/
// vendors, on the way to actually calling the model) throws a marker
// instead — proving the loop attempted real processing for that document
// WITHOUT ever reaching a real Anthropic call, the same technique
// lib/ingest.test.ts's processDocument-guard tests already use.
function fakeAdmin(opts: {
  documents?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
} = {}): SupabaseClient {
  const make = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      // processDocument's idempotency guard (Cost Controls Release 1, step
      // 2) always checks documents.maybeSingle() first, before anything
      // else — every one of these fake documents is fresh (processed_at
      // null in the `doc()` builder), so the guard sees "never processed"
      // and proceeds, exactly like a real unprocessed row would.
      maybeSingle: async () => {
        if (table === 'documents') return { data: opts.documents?.[0] ?? null };
        throw new Error(`PAST_ENTRY:${table}`);
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (table === 'documents') return resolve({ data: opts.documents ?? [], error: null });
        if (table === 'projects') return resolve({ data: opts.projects ?? [], error: null });
        throw new Error(`PAST_ENTRY:${table}`);
      },
    };
    return chain;
  };
  return { from: make } as unknown as SupabaseClient;
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1', kind: 'email', raw_text: 'From: a@b.com\n\nsome text', storage_path: null,
    received_at: '2026-09-13T00:00:00Z', processed_at: null,
    ...overrides,
  };
}

describe('processSelectedDocuments (Demo Safety Gate, manual selection only)', () => {
  it('returns an immediate zero result for an empty selection', async () => {
    const result = await processSelectedDocuments(fakeAdmin(), []);
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0, budgetBlocked: 0, perDocument: [] });
  });

  it('rejects a selection larger than PILOT_MAX_DOCS', async () => {
    const ids = Array.from({ length: PILOT_MAX_DOCS + 1 }, (_, i) => `doc-${i}`);
    await expect(processSelectedDocuments(fakeAdmin(), ids)).rejects.toThrow(new RegExp(`capped at ${PILOT_MAX_DOCS}`));
  });

  it('marks a requested id not found in the DB as failed, without attempting to process it', async () => {
    const admin = fakeAdmin({ documents: [] }); // the id below isn't among the returned rows
    const result = await processSelectedDocuments(admin, ['missing-doc']);
    expect(result).toEqual({
      attempted: 1, succeeded: 0, failed: 1, budgetBlocked: 0,
      perDocument: [{ documentId: 'missing-doc', outcome: 'failed', detail: 'document not found' }],
    });
  });

  it('marks an already-processed document as failed, without attempting to reprocess it', async () => {
    const admin = fakeAdmin({ documents: [doc({ processed_at: '2026-09-01T00:00:00Z' })] });
    const result = await processSelectedDocuments(admin, ['doc-1']);
    expect(result.perDocument).toEqual([{ documentId: 'doc-1', outcome: 'failed', detail: 'already processed' }]);
  });

  it('attempts real processing for an eligible document (reaches processDocument, proven by the PAST_ENTRY marker)', async () => {
    const admin = fakeAdmin({ documents: [doc()] });
    const result = await processSelectedDocuments(admin, ['doc-1']);
    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1); // processDocument threw PAST_ENTRY:projects — a real attempt, not a skip
    expect(result.perDocument[0]).toMatchObject({ documentId: 'doc-1', outcome: 'failed' });
    // processDocument fetches projects/tasks/vendors in parallel (Promise.all)
    // — any of the three can "win" and throw first.
    expect(result.perDocument[0].detail).toMatch(/PAST_ENTRY:(projects|tasks|vendors)/);
  });

  it('rejects a document in the do_not_process group even when its id is passed directly (never trusts the caller)', async () => {
    // No text at all -> preflight puts it in do_not_process — must be
    // refused here regardless of how the id arrived, not just hidden by the
    // UI's own (disabled) checkbox.
    const admin = fakeAdmin({ documents: [doc({ raw_text: '', storage_path: null })] });
    const result = await processSelectedDocuments(admin, ['doc-1']);
    expect(result.perDocument).toEqual([{
      documentId: 'doc-1', outcome: 'failed',
      detail: expect.stringContaining('do-not-process'),
    }]);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  // A real end-to-end trip of the $2 cap (actual payload size vs. real
  // Sonnet pricing) is covered by lib/claude.test.ts's BudgetScope suite —
  // that's where the estimator and the accumulation logic actually live.
  // Here, processDocument's own agent call is unreachable without a real
  // Anthropic client (same limitation as every other processDocument test in
  // this codebase — see lib/ingest.test.ts) — so these tests simulate "the
  // agent call itself decided to block" by having a table processDocument
  // queries throw the SAME error class runStructured would, and verify this
  // module's own orchestration: is it classified as budget_blocked, and does
  // it stop trying further documents once tripped.
  function fakeAdminThrowing(errorFactory: () => Error, documents: Record<string, unknown>[]): { admin: SupabaseClient; calls: number[] } {
    const calls: number[] = [];
    let n = 0;
    const make = (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === 'documents') return { data: documents[0] ?? null };
          throw new Error(`unexpected:${table}`);
        },
        then: (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === 'documents') return resolve({ data: documents, error: null });
          if (table === 'projects') return resolve({ data: [], error: null });
          if (table === 'tasks') return resolve({ data: [], error: null });
          if (table === 'vendors') { n += 1; calls.push(n); throw errorFactory(); }
          throw new Error(`unexpected:${table}`);
        },
      };
      return chain;
    };
    return { admin: { from: make } as unknown as SupabaseClient, calls };
  }

  it('treats a thrown BudgetExceededError as budget_blocked and stops attempting further documents', async () => {
    const docs = Array.from({ length: 3 }, (_, i) => doc({ id: `doc-${i}` }));
    const { admin, calls } = fakeAdminThrowing(() => new BudgetExceededError(2, 0.5, 2), docs);
    const result = await processSelectedDocuments(admin, docs.map((d) => d.id as string));

    expect(result.perDocument.map((d) => d.outcome)).toEqual(['budget_blocked', 'budget_blocked', 'budget_blocked']);
    expect(result.budgetBlocked).toBe(3);
    // Only the FIRST document actually reached the (throwing) vendors query
    // — once tripped, the remaining two are skipped without a real attempt.
    expect(calls).toEqual([1]);
  });

  it('treats a thrown BudgetUnverifiableError the same way as BudgetExceededError (fail closed, stop the run)', async () => {
    const docs = Array.from({ length: 2 }, (_, i) => doc({ id: `doc-${i}` }));
    const { admin, calls } = fakeAdminThrowing(() => new BudgetUnverifiableError('usage log client unavailable'), docs);
    const result = await processSelectedDocuments(admin, docs.map((d) => d.id as string));

    expect(result.perDocument.map((d) => d.outcome)).toEqual(['budget_blocked', 'budget_blocked']);
    expect(calls).toEqual([1]);
  });

  it('rejects a selected document that shares a content_hash with ANOTHER document, even if that one independently reads as a candidate', async () => {
    const shared = doc({ id: 'doc-a', content_hash: 'same-hash' });
    const other = doc({ id: 'doc-b', content_hash: 'same-hash' });
    const admin = fakeAdmin({ documents: [shared, other] });
    const result = await processSelectedDocuments(admin, ['doc-a']);
    expect(result.perDocument).toEqual([{
      documentId: 'doc-a', outcome: 'failed',
      detail: expect.stringContaining('duplicate of document doc-b'),
    }]);
    expect(result.failed).toBe(1);
  });

  it('does not reject a selected document whose content_hash is unique among the fetched rows', async () => {
    const admin = fakeAdmin({ documents: [doc({ id: 'doc-1', content_hash: 'unique-hash' })] });
    const result = await processSelectedDocuments(admin, ['doc-1']);
    // Proceeds past the duplicate check and reaches processDocument for
    // real (proven by the PAST_ENTRY marker, same as the other "attempts
    // real processing" test) — never rejected as a duplicate.
    expect(result.perDocument[0].outcome).toBe('failed');
    expect(result.perDocument[0].detail).toMatch(/PAST_ENTRY:(projects|tasks|vendors)/);
  });
});

describe('getDataInboxTriage (Demo Safety Gate item 2 — filtering, not a decision)', () => {
  const projects = [{ id: 'p1', name: '2361-2367 San Marco', city_case: null, address: null }];

  it('groups documents into exactly the three buckets, derived purely from preflight', async () => {
    const admin = fakeAdmin({
      projects,
      documents: [
        doc({ id: 'd-no-text', kind: 'transcript', raw_text: null, storage_path: 'recordings/x.mp4' }), // no text -> do_not_process
        doc({ id: 'd-ambiguous', raw_text: 'random text with no property evidence' }), // no project signal -> needs_selection
        doc({ id: 'd-candidate', raw_text: 'From: a@b.com\n\nSan Marco update this week' }), // candidate
      ],
    });
    const triage = await getDataInboxTriage(admin);
    expect(triage.do_not_process.map((d) => d.id)).toEqual(['d-no-text']);
    expect(triage.needs_selection.map((d) => d.id)).toEqual(['d-ambiguous']);
    expect(triage.candidate.map((d) => d.id)).toEqual(['d-candidate']);
  });

  it('returns an empty triage for zero documents, without throwing', async () => {
    const triage = await getDataInboxTriage(fakeAdmin({ projects, documents: [] }));
    expect(triage).toEqual({
      do_not_process: [], needs_selection: [], candidate: [],
      totalUnprocessed: 0, shown: 0, offset: 0,
    });
  });

  it('reports totalUnprocessed/shown/offset for pagination (defaults to docs.length when the fake has no real count)', async () => {
    const triage = await getDataInboxTriage(fakeAdmin({
      projects, documents: [doc({ id: 'd1' }), doc({ id: 'd2' })],
    }));
    expect(triage.shown).toBe(2);
    expect(triage.offset).toBe(0);
  });

  it('reports a totalUnprocessed larger than shown when the backlog exceeds one page (nothing silently invisible)', async () => {
    // Two separate 'documents' queries happen in the same Promise.all — the
    // row fetch (returns this page only) and the head-count (returns the
    // TRUE total). A real Supabase response distinguishes them by `count`
    // being set only on the head query; this fake does the same.
    const pageDocs = [doc({ id: 'd1' })];
    const admin = {
      from: (table: string) => {
        const chain = {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (table === 'documents' && opts?.head) {
              return { is: () => ({ then: (resolve: (v: { count: number }) => void) => resolve({ count: 450 }) }) };
            }
            return chain;
          },
          eq: () => chain,
          is: () => chain,
          order: () => chain,
          range: () => chain,
          then: (resolve: (v: { data: unknown; error: null }) => void) => {
            if (table === 'documents') return resolve({ data: pageDocs, error: null });
            if (table === 'projects') return resolve({ data: projects, error: null });
            throw new Error(`unexpected:${table}`);
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    const triage = await getDataInboxTriage(admin);
    expect(triage.shown).toBe(1);
    expect(triage.totalUnprocessed).toBe(450);
  });

  it('flags a content-hash duplicate as do_not_process even though its own signals would otherwise read as a candidate', async () => {
    // Both would independently classify as `candidate` (clean single-project
    // signal) — the duplicate override must win over that.
    const admin = fakeAdmin({
      projects,
      documents: [
        // newest first, matching the real query order
        doc({ id: 'd-newer', raw_text: 'From: a@b.com\n\nSan Marco update', content_hash: 'same-hash', received_at: '2026-09-13T00:00:00Z' }),
        doc({ id: 'd-older', raw_text: 'From: a@b.com\n\nSan Marco update', content_hash: 'same-hash', received_at: '2026-09-01T00:00:00Z' }),
      ],
    });
    const triage = await getDataInboxTriage(admin);
    expect(triage.candidate.map((d) => d.id)).toEqual(['d-older']);
    expect(triage.do_not_process).toHaveLength(1);
    expect(triage.do_not_process[0]).toMatchObject({ id: 'd-newer', duplicateOfId: 'd-older' });
    expect(triage.do_not_process[0].preflight.reasons).toEqual(['duplicate']);
  });
});

describe('PILOT_BUDGET_USD', () => {
  it('defaults to $2 unless DEMO_PILOT_BUDGET_USD is set', () => {
    expect(PILOT_BUDGET_USD).toBe(2);
  });
});
