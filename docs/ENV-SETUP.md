# Sitekick — Environment Variables Guide

Status legend: ✅ already set in `.env.local` · ⬜ pending (optional adapters no-op until set).

| Var | Status | Needed for |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | ✅ | everything |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ✅ | dashboard reads |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | writes, agents, seed |
| SUPABASE_TOKEN | ✅ | scripts/Management API only (not the app) |
| ANTHROPIC_API_KEY | ✅ | all agents |
| INGEST_SECRET | ✅ | /api/ingest-email guard |
| CRON_SECRET | ✅ | cron guards — **required in production** (endpoints return 503 without it) |
| ADMIN_EMAILS | ⬜ | comma-separated admin emails; once set, only these can manage users in Settings. Unset = every signed-in user can (POC only — set before onboarding externals) |
| NEXT_PUBLIC_APP_URL | ✅ (localhost) | links; set prod URL in Vercel |
| GMAIL_* (4) | ⬜ | Gmail inbox poll |
| MSGRAPH_* (4) | ⬜ | Outlook/M365 inbox poll |
| GOOGLE_SA_* (2) | ⬜ | Gantt + budget Sheets sync |

## 1. Supabase (done — for reference)

Dashboard → https://supabase.com/dashboard/project/lmygivkvggerpztacdjp/settings/api-keys
- `anon` public key → NEXT_PUBLIC_SUPABASE_ANON_KEY
- `service_role` key → SUPABASE_SERVICE_ROLE_KEY (server only, never expose)
- URL is fixed: `https://lmygivkvggerpztacdjp.supabase.co`
- SUPABASE_TOKEN (`sb_...`): supabase.com → Account (avatar) → Access Tokens. Used only by local scripts.

## 2. Anthropic (done)

https://console.anthropic.com → API Keys → Create Key.
Models used: Haiku (triage) / Sonnet (extract, digest) / Opus (analysis) — switchable via
`SITEKICK_MODEL_*` env overrides if ever needed.

## 3. Secrets (done)

INGEST_SECRET / CRON_SECRET are random hex generated locally. To rotate:
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
Whatever value goes to Vercel must match what the forwarding Worker sends (`x-ingest-secret`).

## 4. Gmail poll — GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN / USER

Google account = the mailbox you want polled (e.g. office@hilla...).
1. https://console.cloud.google.com → create project "sitekick".
2. APIs & Services → Library → enable **Gmail API**.
3. APIs & Services → OAuth consent screen → External → add the mailbox as **Test user**.
4. Credentials → Create Credentials → **OAuth client ID** → type **Web application** →
   add redirect URI `https://developers.google.com/oauthplayground` → copy **Client ID** + **Client secret**.
5. Refresh token via OAuth Playground:
   - https://developers.google.com/oauthplayground → gear icon → check "Use your own OAuth credentials" → paste ID+secret.
   - Left list → paste scope `https://www.googleapis.com/auth/gmail.readonly` → Authorize → sign in with the mailbox → Exchange authorization code for tokens → copy **Refresh token**.
6. GMAIL_USER = the mailbox address.

## 5. Outlook / Microsoft 365 poll — MSGRAPH_TENANT_ID / CLIENT_ID / CLIENT_SECRET / USER

Needs M365 tenant admin (client's IT or Rotem's admin).
1. https://entra.microsoft.com → Identity → App registrations → **New registration** → name "sitekick-mail", single tenant.
2. Overview page → copy **Directory (tenant) ID** + **Application (client) ID**.
3. Certificates & secrets → **New client secret** → copy the **Value** immediately.
4. API permissions → Add → Microsoft Graph → **Application permissions** → `Mail.Read` → **Grant admin consent**.
5. MSGRAPH_USER = mailbox address to poll (e.g. rotem@hillagroup.com).

Security note: `Mail.Read` application permission = all mailboxes. To restrict to one mailbox,
IT should add an **Application Access Policy** (Exchange Online PowerShell) scoping the app to that mailbox.

## 6. Google Sheets sync — GOOGLE_SA_EMAIL / GOOGLE_SA_KEY

1. Same GCP project → APIs & Services → Library → enable **Google Sheets API**.
2. IAM & Admin → Service Accounts → Create ("sitekick-sheets") → done.
3. Open it → Keys → Add key → **JSON** → download.
4. From the JSON: `client_email` → GOOGLE_SA_EMAIL; `private_key` → GOOGLE_SA_KEY
   (paste as one line, keep the `\n` sequences exactly as in the file).
5. **Share** the Gantt + Budget Google Sheets with GOOGLE_SA_EMAIL (Viewer).
6. In the app: Settings → Google Sheets sync → paste the two sheet IDs
   (the long id from each sheet URL between `/d/` and `/edit`).

## 7. Vercel (deploy time)

Project → Settings → Environment Variables → paste everything above EXCEPT SUPABASE_TOKEN
(scripts-only). Set NEXT_PUBLIC_APP_URL to the prod URL. Crons authenticate automatically:
Vercel sends `Authorization: Bearer $CRON_SECRET` when a var named CRON_SECRET exists.
