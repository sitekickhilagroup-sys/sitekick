import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processSelectedDocuments, getDataInboxTriage, PILOT_MAX_DOCS, PILOT_BUDGET_USD } from './data-inbox';

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

  it('stops at the pilot budget cap and marks the rest budget_blocked, never attempting them', async () => {
    // Sized so each call's pre-check estimate is large enough that a small
    // number of them crosses PILOT_BUDGET_USD within PILOT_MAX_DOCS docs —
    // see estimateCallCostUsd: chars/4 * $2/MTok (Sonnet input) + 16000 *
    // $10/MTok (fixed max_tokens output ceiling) per call.
    const bigText = 'x'.repeat(1_000_000); // ~$0.66/call at Sonnet rates
    const docs = Array.from({ length: PILOT_MAX_DOCS }, (_, i) => doc({ id: `doc-${i}`, raw_text: bigText }));
    const admin = fakeAdmin({ documents: docs });
    const result = await processSelectedDocuments(admin, docs.map((d) => d.id as string));

    expect(result.attempted).toBe(PILOT_MAX_DOCS);
    // Every attempted doc either really tried (failed via PAST_ENTRY) or was
    // budget_blocked — never silently skipped, and once budget_blocked
    // starts, nothing after it is a real attempt.
    const outcomes = result.perDocument.map((d) => d.outcome);
    const firstBlockedIdx = outcomes.indexOf('budget_blocked');
    expect(firstBlockedIdx).toBeGreaterThan(-1);
    expect(outcomes.slice(firstBlockedIdx).every((o) => o === 'budget_blocked')).toBe(true);
    expect(result.perDocument[firstBlockedIdx].detail).toMatch(/pilot cap|pilot budget/);
  });
});

describe('getDataInboxTriage (Demo Safety Gate item 2 — filtering, not a decision)', () => {
  const projects = [{ id: 'p1', name: '2361-2367 San Marco', city_case: null, address: null }];

  it('groups documents into exactly the three buckets, derived purely from preflight', async () => {
    const admin = fakeAdmin({
      projects,
      documents: [
        doc({ id: 'd-dup', kind: 'transcript', raw_text: null, storage_path: 'recordings/x.mp4' }), // no text -> do_not_process
        doc({ id: 'd-ambiguous', raw_text: 'random text with no property evidence' }), // no project signal -> needs_selection
        doc({ id: 'd-candidate', raw_text: 'From: a@b.com\n\nSan Marco update this week' }), // candidate
      ],
    });
    const triage = await getDataInboxTriage(admin);
    expect(triage.do_not_process.map((d) => d.id)).toEqual(['d-dup']);
    expect(triage.needs_selection.map((d) => d.id)).toEqual(['d-ambiguous']);
    expect(triage.candidate.map((d) => d.id)).toEqual(['d-candidate']);
  });

  it('returns an empty triage for zero documents, without throwing', async () => {
    const triage = await getDataInboxTriage(fakeAdmin({ projects, documents: [] }));
    expect(triage).toEqual({ do_not_process: [], needs_selection: [], candidate: [] });
  });
});

describe('PILOT_BUDGET_USD', () => {
  it('defaults to $2 unless DEMO_PILOT_BUDGET_USD is set', () => {
    expect(PILOT_BUDGET_USD).toBe(2);
  });
});
