import { NextRequest, NextResponse } from 'next/server';

// Vercel cron requests carry Authorization: Bearer CRON_SECRET when set.
export function assertCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // not configured -> allow (pre-prod)
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return null;
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
