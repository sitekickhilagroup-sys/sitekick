import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runIssueTriage } from '@/agents/triage-issues';
import { isDemoManualMode, DEMO_MANUAL_MODE_SKIP } from '@/lib/demo-mode';

export const maxDuration = 120;

// Daily pass over "Report a problem" notes (Notes Assistant's 4th intent).
// Once/day, not twice — Vercel's Hobby plan rejects any cron scheduled more
// often than once daily (deployment fails outright, not silently). Writes
// ONLY time_estimate/significance/triaged_at onto the
// comments it processes — never touches code, never deploys, never acts on
// anything. The prioritized list itself is read on demand (see
// app/actions/comments.ts's listIssueBacklog), not pushed anywhere.
export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  // Demo Safety Gate hardening: runIssueTriage reaches runStructured
  // (job:'triage', Haiku) — skip before it's called, not after.
  if (isDemoManualMode()) return NextResponse.json({ ok: true, skipped: DEMO_MANUAL_MODE_SKIP });
  try {
    const admin = supabaseAdmin();
    const result = await runIssueTriage(admin);
    if ('error' in result) return NextResponse.json({ ok: false, error: result.error });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
