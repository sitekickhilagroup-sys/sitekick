import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runAutoTriage } from '@/lib/auto-triage';
import { laToday } from '@/lib/date';
import type { AgentProposal } from '@/lib/types';

// Sweep the pending review backlog through auto-triage. Not on a Vercel cron
// schedule (slots are scarce) — triggered by the inbox "Auto-triage" button's
// server action, by ops with the CRON_SECRET, and available for a schedule
// later without code changes.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const admin = supabaseAdmin();
    const { data } = await admin.from('agent_proposals')
      .select('*').eq('state', 'pending')
      .order('created_at', { ascending: true }).limit(500);
    const pending = (data ?? []) as AgentProposal[];
    const summary = await runAutoTriage(admin, pending, { today: laToday() });
    return NextResponse.json({ ok: true, pending: pending.length, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
