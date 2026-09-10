'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { getImportQueueStats, processImportBatch, type BatchResult, type ImportQueueStats } from '@/lib/import-queue';

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
