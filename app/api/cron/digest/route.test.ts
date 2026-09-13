import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// Demo Safety Gate hardening: proves the cron route returns the skip BEFORE
// touching supabaseAdmin()/buildDigest/runPrioritization at all — not just
// that a skip object is possible. Real Supabase/Anthropic credentials are
// never stubbed in here on purpose: if the gate regressed and execution fell
// through to the real work, this test process has no valid Supabase config,
// so the call would throw loudly instead of silently reaching a real
// Anthropic request — the safest possible failure mode for this test.
function fakeCronRequest(): NextRequest {
  // No Authorization header and no CRON_SECRET stubbed: assertCron's own
  // dev-convenience bypass (NODE_ENV !== 'production') is what lets this
  // through to the code under test, exactly like local/test runs always do.
  return new NextRequest('http://localhost/api/cron/digest');
}

describe('GET /api/cron/digest (Demo Safety Gate — cron cannot reach the model)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns {skipped: demo_manual_mode} and never calls the model when manual mode is ON (the default)', async () => {
    vi.stubEnv('DEMO_MANUAL_MODE', undefined as unknown as string);
    const res = await GET(fakeCronRequest());
    const json = await res.json();
    expect(json).toEqual({ ok: true, skipped: 'demo_manual_mode' });
  });
});
