import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDemoManualMode, DEMO_MANUAL_MODE_SKIP } from './demo-mode';

describe('isDemoManualMode (Demo Safety Gate — cron gating)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to true (manual mode ON) when DEMO_MANUAL_MODE is unset', () => {
    vi.stubEnv('DEMO_MANUAL_MODE', undefined as unknown as string);
    expect(isDemoManualMode()).toBe(true);
  });

  it('is false ONLY when explicitly set to the literal string "0"', () => {
    vi.stubEnv('DEMO_MANUAL_MODE', '0');
    expect(isDemoManualMode()).toBe(false);
  });

  it('stays ON for any other value — only an exact "0" turns it off', () => {
    for (const v of ['1', 'true', 'false', 'off', '', ' ']) {
      vi.stubEnv('DEMO_MANUAL_MODE', v);
      expect(isDemoManualMode()).toBe(true);
    }
  });

  it('exports the exact skip marker every gated cron route returns', () => {
    expect(DEMO_MANUAL_MODE_SKIP).toBe('demo_manual_mode');
  });
});
