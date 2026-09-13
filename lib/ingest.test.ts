import { describe, expect, it } from 'vitest';
import { ingestDocument, processDocument } from './ingest';
import { EXTRACT_COMMS_PROMPT_VERSION } from '../agents/extract-comms';
import { MODELS } from './claude';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeAdmin(existing: { id: string; processed_at?: string | null } | null) {
  const inserted: unknown[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: existing }) }),
      }),
      insert: (payload: unknown) => {
        inserted.push(payload);
        return { select: () => ({ single: async () => ({ data: { id: 'new-doc' }, error: null }) }) };
      },
    }),
  } as unknown as SupabaseClient;
  return { admin, inserted };
}

describe('ingestDocument', () => {
  it('dedups on external_id, and reports the existing row as unprocessed when it never finished', async () => {
    const { admin, inserted } = fakeAdmin({ id: 'doc-existing', processed_at: null });
    const result = await ingestDocument(admin, {
      kind: 'email', source: 'forward', external_id: 'msg-1', raw_text: 'x',
    });
    expect(result).toEqual({ documentId: 'doc-existing', deduped: true, processed: false });
    expect(inserted).toHaveLength(0);
  });

  it('dedups on external_id and reports the existing row as processed once it has processed_at', async () => {
    const { admin, inserted } = fakeAdmin({ id: 'doc-existing', processed_at: '2026-08-20T00:00:00Z' });
    const result = await ingestDocument(admin, {
      kind: 'email', source: 'forward', external_id: 'msg-1', raw_text: 'x',
    });
    expect(result).toEqual({ documentId: 'doc-existing', deduped: true, processed: true });
    expect(inserted).toHaveLength(0);
  });

  it('inserts new document when unseen', async () => {
    const { admin, inserted } = fakeAdmin(null);
    const result = await ingestDocument(admin, {
      kind: 'email', source: 'forward', external_id: 'msg-2', raw_text: 'x',
    });
    expect(result).toEqual({ documentId: 'new-doc', deduped: false, processed: false });
    expect(inserted).toHaveLength(1);
  });
});

describe('processDocument idempotency guard (Cost Controls Release 1, step 2)', () => {
  // Only stubs the `documents` table lookup the guard itself performs. Any
  // access past the guard (projects/tasks/vendors, on the way to calling the
  // model) hits this marker instead — proving the guard did NOT short-circuit,
  // without ever reaching extractComms/runStructured (no real API call).
  function fakeAdminForGuard(existing: Record<string, unknown> | null) {
    return {
      from: (table: string) => {
        if (table === 'documents') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) };
        }
        throw new Error(`PAST_GUARD:${table}`);
      },
    } as unknown as SupabaseClient;
  }

  it('skips when the document already succeeded under the current prompt_version and model', async () => {
    const admin = fakeAdminForGuard({
      processed_at: '2026-09-01T00:00:00Z',
      prompt_version: EXTRACT_COMMS_PROMPT_VERSION,
      extract_model: MODELS.extract,
    });
    const result = await processDocument(admin, { id: 'doc-1', kind: 'email', raw_text: 'x' });
    expect(result).toEqual({ skipped: true, reason: expect.stringContaining('already succeeded') });
  });

  it('proceeds past the guard when the document was never processed', async () => {
    const admin = fakeAdminForGuard({ processed_at: null, prompt_version: null, extract_model: null });
    await expect(processDocument(admin, { id: 'doc-1', kind: 'email', raw_text: 'x' }))
      .rejects.toThrow(/PAST_GUARD:projects/);
  });

  it('proceeds past the guard when processed_at is set but prompt_version is stale', async () => {
    const admin = fakeAdminForGuard({
      processed_at: '2026-01-01T00:00:00Z', prompt_version: 'an-older-version', extract_model: MODELS.extract,
    });
    await expect(processDocument(admin, { id: 'doc-1', kind: 'email', raw_text: 'x' }))
      .rejects.toThrow(/PAST_GUARD:projects/);
  });

  it('proceeds past the guard when processed_at is set but extract_model differs', async () => {
    const admin = fakeAdminForGuard({
      processed_at: '2026-01-01T00:00:00Z', prompt_version: EXTRACT_COMMS_PROMPT_VERSION, extract_model: 'claude-opus-5',
    });
    await expect(processDocument(admin, { id: 'doc-1', kind: 'email', raw_text: 'x' }))
      .rejects.toThrow(/PAST_GUARD:projects/);
  });

  it('force:true bypasses the guard even when the document already matches', async () => {
    const admin = fakeAdminForGuard({
      processed_at: '2026-09-01T00:00:00Z', prompt_version: EXTRACT_COMMS_PROMPT_VERSION, extract_model: MODELS.extract,
    });
    await expect(processDocument(admin, { id: 'doc-1', kind: 'email', raw_text: 'x', force: true }))
      .rejects.toThrow(/PAST_GUARD:projects/);
  });

  it('invoice_pdf documents never consult the guard (parse-invoice has no prompt_version yet)', async () => {
    const admin = fakeAdminForGuard(null);
    await expect(processDocument(admin, { id: 'doc-1', kind: 'invoice_pdf', pdf_base64: 'abc' }))
      .rejects.toThrow(/PAST_GUARD:projects/);
  });
});
