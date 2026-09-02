import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Vercel cron requests carry Authorization: Bearer CRON_SECRET.
// Fails closed in production: an unset secret must never expose the endpoints.
export function assertCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null; // local dev convenience
    return NextResponse.json({ error: 'cron secret not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (safeEqual(auth, `Bearer ${secret}`)) return null;
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
