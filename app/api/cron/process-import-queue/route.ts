import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processImportBatch } from '@/lib/import-queue';
import { isDemoManualMode, DEMO_MANUAL_MODE_SKIP } from '@/lib/demo-mode';

export const maxDuration = 300;

// Drains the documents backlog a bounded batch at a time — resumable by
// construction (see lib/import-queue.ts), so each scheduled tick just picks
// up wherever the last one left off. Batch size kept modest relative to
// maxDuration since processDocument does an LLM pass per document.
//
// Demo Safety Gate hardening (Rotem, 2026-09-13): this is EXACTLY the
// automatic, no-selection processing the gate exists to prevent — removed
// from vercel.json's cron schedule entirely, AND gated here so hitting this
// URL directly (manually, or if it's ever re-added to vercel.json without
// noticing this comment) still can't auto-process anything while manual
// mode is on.
const BATCH_SIZE = 15;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  if (isDemoManualMode()) return NextResponse.json({ ok: true, skipped: DEMO_MANUAL_MODE_SKIP });
  try {
    const admin = supabaseAdmin();
    const result = await processImportBatch(admin, BATCH_SIZE);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
