import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildDigest } from '@/agents/daily-digest';
import { runPrioritization } from '@/agents/prioritize-tasks';
import { laToday } from '@/lib/date';
import { isDemoManualMode, DEMO_MANUAL_MODE_SKIP } from '@/lib/demo-mode';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  // Demo Safety Gate hardening: both buildDigest (job:'digest', Sonnet) and
  // runPrioritization (job:'digest', Sonnet) reach runStructured — skip
  // BEFORE either is called, not after, while manual mode is on.
  if (isDemoManualMode()) return NextResponse.json({ ok: true, skipped: DEMO_MANUAL_MODE_SKIP });
  try {
    const laDate = laToday();
    const admin = supabaseAdmin();
    const { top_actions } = await buildDigest(admin, laDate);
    // Daily prioritization rides the same schedule (Vercel cron slots are
    // scarce). A ranking failure must not kill the digest that already ran.
    let ranked: number | null = null;
    try {
      const run = await runPrioritization(admin, laDate);
      if ('error' in run) console.error('[cron/digest] prioritization failed:', run.error);
      else ranked = run.ranked;
    } catch (e) {
      console.error('[cron/digest] prioritization crashed:', e);
    }
    return NextResponse.json({ ok: true, for_date: laDate, actions: top_actions.length, ranked });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
