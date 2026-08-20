# Sitekick

AI-agent operations platform for Hilla Group's LA real-estate development projects.
Ingests email / transcripts / invoices / trackers → Claude agents extract tasks, blockers,
decisions, invoices, stage progress → dashboard answers: **where does every project stand,
what's stuck, what do we do today.**

Spec: `docs/superpowers/specs/2026-08-20-sitekick-platform-design.md`
Plan: `docs/superpowers/plans/2026-08-20-sitekick-platform.md`

## Stack

Next.js 16 (App Router, `proxy.ts`) · TypeScript strict · Tailwind v4 · Supabase
(Postgres + Auth email/password + Storage) · `@anthropic-ai/sdk` (Haiku triage /
Sonnet extract / Opus analyze) · Vitest · EN/HE i18n with RTL.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill values (see Env matrix)
npm run dev                  # http://localhost:3000
npm run check                # typecheck + lint + tests
```

## Env matrix

| Var | Needed for | Where |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | everything | Supabase → Settings → API |
| SUPABASE_SERVICE_ROLE_KEY | writes, agents, seed | same page (keep secret) |
| ANTHROPIC_API_KEY | agents (extract, invoice, digest) | console.anthropic.com |
| INGEST_SECRET | `/api/ingest-email` guard | generate any long random |
| CRON_SECRET | cron route guard | set same value in Vercel |
| GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/USER | Gmail poll (optional) | Google Cloud OAuth |
| MSGRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/USER | Outlook poll (optional) | Entra app registration |
| GOOGLE_SA_EMAIL/GOOGLE_SA_KEY | Sheets sync (optional) | GCP service account (share sheets with it) |

Adapters no-op safely until their env vars exist (Settings page shows status lights).

## Database

- Schema: `supabase/migrations/0001_init.sql` (applied to project `guqfkjqhpffihjerasoe`).
- Seed: `node --experimental-strip-types scripts/seed.ts` (idempotent; `--dry-run` for counts).
- Storage bucket `documents` (private) for uploaded PDFs.
- Users: `node scripts/create-user.mjs someone@email.com` (prints temp password).
  Signup is disabled by design; only pre-created users can log in.

## Email intake (3 paths)

1. **Forward-address (live now):** POST `/api/ingest-email` with header `x-ingest-secret`.
   Body: `{from, to, subject, text, message_id, date}`. Wire Cloudflare Email Routing →
   Worker → this endpoint, then add forwarding rules in Gmail/Outlook.
2. **Gmail poll:** fill `GMAIL_*` env → cron `/api/cron/poll-gmail` every 10 min.
3. **Outlook poll:** fill `MSGRAPH_*` env → cron `/api/cron/poll-outlook` every 10 min.

Dedup on message id — safe to run all three.

## Crons (`vercel.json`)

digest 14:00 UTC (07:00 LA) · gmail/outlook polls */10 min · sheets 6h · zimas weekly.
All guarded by `CRON_SECRET` (Vercel sends it automatically for cron invocations).

## Deploy (Vercel)

1. Push this repo to GitHub (`sitekickhilagroup-sys/sitekick`).
2. Vercel team `sitekickhilagroup-1633s-projects` → Add New Project → import the repo.
3. Set env vars from the matrix (at minimum: the 3 Supabase vars, ANTHROPIC_API_KEY,
   INGEST_SECRET, CRON_SECRET).
4. Deploy. Crons register from `vercel.json` automatically.

## Requirement lists are data

Per-project stage graphs + requirement checklists live in `project_stages` /
`stage_requirements`. Import the PM's authoritative lists via **Settings → Import
requirement lists** (same JSON format as the client dashboard `record`). Nothing is
hardcoded; the seed and the UI share one import path (`lib/import/requirements.ts`).
