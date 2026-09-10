// Continuous import processing — drains the backlog of stored-but-unprocessed
// `documents` rows (app/api/upload/route.ts stores every extracted email but
// only ever processes the first 10 per upload; nothing has ever revisited the
// rest). Resumable by construction: "waiting" is just `processed_at is null`,
// so re-running this after a stop or a deploy naturally picks up where the
// last run left off — no separate progress table needed.
//
// Retries are controlled via activity_log rather than a new documents column
// (no migration needed): a failed attempt logs entity_type='document',
// action='ingest:failed' instead of setting processed_at, so the SAME
// document is picked up again next batch. A document is treated as
// permanently failed (stops being retried) once it has MAX_ATTEMPTS such
// rows — still counted separately from "waiting", never silently dropped.
import type { SupabaseClient } from '@supabase/supabase-js';
import { processDocument } from './ingest.ts';
import { logActivity } from './state-writer.ts';
import type { DocKind } from './types.ts';

export const MAX_ATTEMPTS = 3;
const STORAGE_BUCKET = 'documents';

/** Pure: how many failed-ingest activity_log rows exist per document. */
export function countFailuresByDocument(rows: { entity_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1);
  return counts;
}

/** Pure: which document ids have hit the retry cap and stop being retried. */
export function selectPermanentlyFailed(failureCounts: Map<string, number>, maxAttempts: number): Set<string> {
  const failed = new Set<string>();
  for (const [id, n] of failureCounts) if (n >= maxAttempts) failed.add(id);
  return failed;
}

/**
 * Pure: from a page of waiting-document candidates (already ordered oldest
 * first), drops the permanently-failed ones and takes the next `batchSize` —
 * over-fetching by more than that in the caller's query keeps a run of
 * failed ids at the front from starving a whole batch down to zero real
 * attempts.
 */
export function selectBatch<T extends { id: string }>(
  candidates: T[], permanentlyFailedIds: Set<string>, batchSize: number,
): { batch: T[]; more: boolean } {
  const eligible = candidates.filter((c) => !permanentlyFailedIds.has(c.id));
  return { batch: eligible.slice(0, batchSize), more: eligible.length > batchSize };
}

export interface ImportQueueStats {
  stored: number;
  processed: number;
  /** Unprocessed and still under the retry cap — will be picked up by the
   *  next batch. */
  waiting: number;
  /** Unprocessed but at MAX_ATTEMPTS failed tries — no longer retried
   *  automatically; needs a human look, not silently invisible. */
  failed: number;
}

async function loadPermanentlyFailedIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin
    .from('activity_log')
    .select('entity_id')
    .eq('entity_type', 'document')
    .eq('action', 'ingest:failed');
  return selectPermanentlyFailed(countFailuresByDocument((data ?? []) as { entity_id: string }[]), MAX_ATTEMPTS);
}

export async function getImportQueueStats(admin: SupabaseClient): Promise<ImportQueueStats> {
  const [{ count: stored }, { count: processed }, permanentlyFailed] = await Promise.all([
    admin.from('documents').select('id', { count: 'exact', head: true }),
    admin.from('documents').select('id', { count: 'exact', head: true }).not('processed_at', 'is', null),
    loadPermanentlyFailedIds(admin),
  ]);
  const { count: unprocessed } = await admin
    .from('documents').select('id', { count: 'exact', head: true }).is('processed_at', null);
  const failed = permanentlyFailed.size;
  return {
    stored: stored ?? 0,
    processed: processed ?? 0,
    waiting: Math.max(0, (unprocessed ?? 0) - failed),
    failed,
  };
}

export interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** True when there were more eligible documents than batchSize — the
   *  caller (or the next scheduled cron tick) should run again. */
  more: boolean;
}

/**
 * Processes up to `batchSize` waiting documents, oldest first. Never
 * re-uploads or re-inserts anything — it only calls the SAME processDocument
 * every upload path already uses, against rows that already exist. A
 * document reaching MAX_ATTEMPTS failures is skipped from here on (still
 * visible via getImportQueueStats' `failed` count, never silently dropped).
 *
 * Ingestion still only ever produces agent_proposals (or, for staff-authored
 * transcripts/notes, an auto-created task via the existing kind !== 'email'
 * rule already in processDocument) — nothing here writes to a task directly
 * for email content. Reprocessing never re-decides anything a human already
 * reviewed.
 */
export async function processImportBatch(admin: SupabaseClient, batchSize: number): Promise<BatchResult> {
  const permanentlyFailed = await loadPermanentlyFailedIds(admin);

  // Over-fetch a bit so a run of permanently-failed ids at the front of the
  // queue doesn't starve a whole batch down to zero real attempts.
  const { data: candidates } = await admin
    .from('documents')
    .select('id, kind, raw_text, storage_path')
    .is('processed_at', null)
    .order('received_at', { ascending: true })
    .limit(batchSize + permanentlyFailed.size + 1);
  const rows = (candidates ?? []) as {
    id: string; kind: DocKind; raw_text: string | null; storage_path: string | null;
  }[];
  const { batch, more } = selectBatch(rows, permanentlyFailed, batchSize);

  let succeeded = 0;
  let failed = 0;
  for (const doc of batch) {
    try {
      if (doc.kind === 'invoice_pdf' && !doc.raw_text) {
        if (!doc.storage_path) throw new Error('invoice_pdf has neither raw_text nor storage_path');
        const { data: file, error: dlError } = await admin.storage.from(STORAGE_BUCKET).download(doc.storage_path);
        if (dlError || !file) throw new Error(`storage download failed: ${dlError?.message ?? 'no file'}`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await processDocument(admin, { id: doc.id, kind: doc.kind, pdf_base64: buffer.toString('base64') });
      } else {
        await processDocument(admin, { id: doc.id, kind: doc.kind, raw_text: doc.raw_text });
      }
      await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', doc.id);
      succeeded++;
    } catch (e) {
      failed++;
      await logActivity(admin, {
        entity_type: 'document', entity_id: doc.id, actor: 'system:import-queue',
        action: 'ingest:failed', after: { error: e instanceof Error ? e.message : String(e) },
      });
      console.error('[import-queue] processDocument failed (will retry, up to MAX_ATTEMPTS)', { documentId: doc.id, error: e });
    }
  }
  return { attempted: batch.length, succeeded, failed, more };
}
