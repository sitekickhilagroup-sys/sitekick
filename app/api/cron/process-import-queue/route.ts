import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processImportBatch } from '@/lib/import-queue';

export const maxDuration = 300;

// Drains the documents backlog a bounded batch at a time — resumable by
// construction (see lib/import-queue.ts), so each scheduled tick just picks
// up wherever the last one left off. Batch size kept modest relative to
// maxDuration since processDocument does an LLM pass per document.
const BATCH_SIZE = 15;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const admin = supabaseAdmin();
    const result = await processImportBatch(admin, BATCH_SIZE);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
