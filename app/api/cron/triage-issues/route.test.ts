import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// See app/api/cron/digest/route.test.ts for the full rationale: no
// Supabase/Anthropic credentials are stubbed here on purpose — if the gate
// ever regressed, the real work (runIssueTriage, Haiku) would throw loudly
// in this environment rather than silently making a real API call.
function fakeCronRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/triage-issues');
}

describe('GET /api/cron/triage-issues (Demo Safety Gate — cron cannot reach the model)', () => {
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
