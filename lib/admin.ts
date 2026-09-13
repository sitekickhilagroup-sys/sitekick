import 'server-only';

// Admin-only gate shared across server actions (app/actions/users.ts,
// app/actions/llm-usage.ts). Lives outside any 'use server' file — a
// synchronous helper exported from a Server Actions module fails the build
// ("Server Actions must be async functions"); this file has no such
// restriction, but stays server-only since it reads ADMIN_EMAILS.
//
// Unset ADMIN_EMAILS = POC fallback: every signed-in user counts as admin —
// set it in Vercel env before giving logins to anyone outside the founding
// team.
export function isAdminEmail(email: string | null): boolean {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return true;
  if (!email) return false;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
