'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { getImportQueueStats, processImportBatch, drainPending, type BatchResult, type DrainResult, type ImportQueueStats } from '@/lib/import-queue';

export async function fetchImportQueueStats(): Promise<ImportQueueStats> {
  await requireUser();
  return getImportQueueStats(supabaseAdmin());
}

/** Manual trigger for the same batch the cron runs (app/api/cron/process-import-queue) —
 *  lets a human drain the backlog on demand from /upload rather than only on
 *  the schedule, and gives this session something to click and verify live. */
export async function runImportBatch(batchSize: number): Promise<BatchResult> {
  await requireUser();
  const result = await processImportBatch(supabaseAdmin(), batchSize);
  revalidatePath('/upload');
  return result;
}

/**
 * "Process all now" (Data Inbox, Track 3): the once-daily cron only ever
 * drains 15/day (Vercel Hobby plan doesn't allow a more frequent one), so a
 * large backlog — a big .zip/.olm import especially — can sit for over a
 * week. Loops runImportBatch via lib/import-queue.ts's drainPending until
 * either the queue empties or the time budget (under /upload's own
 * maxDuration=300) runs out, so one click can drain everything eligible
 * right now instead of waiting on the schedule.
 */
export async function processAllPending(): Promise<DrainResult> {
  await requireUser();
  const admin = supabaseAdmin();
  const result = await drainPending((batchSize) => processImportBatch(admin, batchSize));
  revalidatePath('/upload');
  return result;
}
