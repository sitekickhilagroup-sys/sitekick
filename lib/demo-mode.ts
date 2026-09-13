import 'server-only';

// Demo Safety Gate hardening (Rotem, 2026-09-13): manual mode is the
// DEFAULT, safe posture. Every cron (or any other path) that could reach
// runStructured checks this FIRST and skips without calling the model at
// all — no Sonnet, Haiku, or Opus runs automatically until a human selects
// a specific document (Data Inbox). Flip DEMO_MANUAL_MODE=0 in env only
// when ready to go live for real, after the $30 load and the first
// verified pilot run.
export function isDemoManualMode(): boolean {
  return process.env.DEMO_MANUAL_MODE !== '0';
}

export const DEMO_MANUAL_MODE_SKIP = 'demo_manual_mode' as const;
