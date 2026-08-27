import { describe, expect, it } from 'vitest';
import { ingestDocument } from './ingest';
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
