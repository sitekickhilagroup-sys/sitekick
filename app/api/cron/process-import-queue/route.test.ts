import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// See app/api/cron/digest/route.test.ts for the full rationale. This route
// is also removed from vercel.json's cron schedule entirely (belt +
// suspenders) — this test covers the "hit the URL directly" defense layer.
function fakeCronRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/process-import-queue');
}

describe('GET /api/cron/process-import-queue (Demo Safety Gate — cannot auto-process without selection)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns {skipped: demo_manual_mode} and never calls processImportBatch when manual mode is ON (the default)', async () => {
    vi.stubEnv('DEMO_MANUAL_MODE', undefined as unknown as string);
    const res = await GET(fakeCronRequest());
    const json = await res.json();
    expect(json).toEqual({ ok: true, skipped: 'demo_manual_mode' });
  });
});
