import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildDigest } from '@/agents/daily-digest';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const laDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    const { top_actions } = await buildDigest(supabaseAdmin(), laDate);
    return NextResponse.json({ ok: true, for_date: laDate, actions: top_actions.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
