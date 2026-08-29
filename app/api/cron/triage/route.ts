import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runFullTriage } from '@/lib/auto-triage';
import { laToday } from '@/lib/date';

// Sweep the pending review backlog through the deterministic + learned
// triage rules (no LLM judgment — provable no-ops, duplicates, and classes
// the humans' own decisions have qualified). Not on a Vercel cron schedule
// (slots are scarce) — triggered by the inbox "Auto-triage" button's server
// action, by ops with the CRON_SECRET, and schedulable later without code
// changes.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const summary = await runFullTriage(supabaseAdmin(), { today: laToday() });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
