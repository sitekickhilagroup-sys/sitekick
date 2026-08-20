import { NextRequest, NextResponse } from 'next/server';
import { assertCron } from '@/lib/cron';
import { supabaseAdmin } from '@/lib/supabase/admin';
import * as outlook from '@/lib/mail/outlook';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  try {
    const result = await outlook.run(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
