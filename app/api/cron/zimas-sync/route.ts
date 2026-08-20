import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import * as zimas from '@/lib/sync/zimas';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const result = await zimas.run(supabaseAdmin());
    return NextResponse.json({ ok: true, processed: result.processed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
