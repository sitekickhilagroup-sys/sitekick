# Sitekick Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production Sitekick platform — Next.js dashboard + Supabase + Claude agents for Hilla Group LA development ops.

**Architecture:** Single Next.js 15 App Router app. Reads via anon Supabase client (RLS select-only), writes via service-role server actions/API routes. Agents are typed server modules invoked from ingest routes and crons. Per-project stage graphs with 3-state requirements are first-class DB entities imported from data files.

**Tech Stack:** Next.js 15, TypeScript strict, Tailwind v4, shadcn/ui, Supabase (`@supabase/ssr`), `@anthropic-ai/sdk`, next-intl (EN/HE + RTL), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-08-20-sitekick-platform-design.md`

## Global Constraints

- TypeScript strict; no `any` unless annotated why.
- All DB writes server-side only (service role). Browser = anon key, SELECT via RLS.
- Requirement lists / stage graphs are DATA (DB rows imported from JSON) — never hardcoded.
- Requirement states exactly: `done` | `open` | `unknown`. Owner: `us` | `city`.
- Invoice status chain exactly: `received` → `for_rowan_approval` → `approved` → `paid` (+ `on_hold`).
- i18n: every UI string through dictionary; `en.json`/`he.json` keys must stay in parity (tested).
- Design: POC v3 pastel (linen/sage/apricot), light default + dark toggle, WCAG AA. Use design skills (ui-ux-pro-max / frontend-design / design-taste-frontend) when building UI tasks.
- **No git commits by Claude — Dor reviews and runs /commit-push** (overrides plan-template commit steps).
- Before writing `lib/claude.ts` or any agent: load `claude-api` skill for current model ids.
- Secrets only via env; `.env.example` documents all.

---

### Task 1: Scaffold

**Files:** Create Next.js app in repo root (`package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `postcss.config.mjs`), `.env.example`, `.gitignore`, `vitest.config.ts`, `README.md`, shadcn init (`components.json`, `lib/utils.ts`).

**Steps:**
- [ ] `npx create-next-app@latest` (TS, App Router, Tailwind, no src dir, import alias `@/*`) — scaffold into temp dir and move contents (root contains `docs/`).
- [ ] Add Vitest + config (`environment: 'node'`, include `**/*.test.ts`), scripts: `test`, `typecheck` (`tsc --noEmit`), `check` (typecheck+lint+test).
- [ ] shadcn/ui init + add: button card badge table tabs dialog input select textarea dropdown-menu collapsible sheet sonner skeleton separator switch label popover command calendar.
- [ ] `.env.example` with: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, INGEST_SECRET, CRON_SECRET, GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/USER, MSGRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET/USER, GOOGLE_SA_EMAIL/GOOGLE_SA_KEY, NEXT_PUBLIC_APP_URL.
- [ ] Verify: `npm run check` passes clean.

### Task 2: Database schema migration

**Files:** Create `supabase/migrations/0001_init.sql` — full DDL per spec §4 (all tables, enums, RLS policies, indexes on FKs + tasks.status + invoices.status + documents.external_id unique).

**Interfaces — produces (exact enum values, used by all later tasks):**
- `req_state`: done|open|unknown · `req_who`: us|city · `req_basis`: standard|ours
- `stage_status`: done|current|upcoming|skipped
- `invoice_status`: received|for_rowan_approval|approved|paid|on_hold
- `invoice_tab`: invoices|payment_summary|david
- `task_priority`: critical|high|normal · `task_status`: open|done|dropped
- `doc_kind`: email|transcript|invoice_pdf|sheet|other · `doc_source`: forward|gmail|outlook|upload|sheets|zimas|manual
- `draft_status`: proposed|approved|sent|dismissed · `event_kind`: history|forecast
- Tables per spec §4 verbatim.

**Steps:**
- [ ] Write DDL. RLS: enable on all; policy `for select to authenticated using (true)` each table. No insert/update policies (service role bypasses).
- [ ] Syntax sanity: statements split/parse non-empty; real apply happens in deploy task.

### Task 3: Types + Supabase clients

**Files:** Create `lib/types.ts`, `lib/supabase/server.ts` (anon, cookie-bound via `@supabase/ssr`), `lib/supabase/admin.ts` (service role, server-only guard), `lib/supabase/client.ts` (browser anon).

**Interfaces — produces:** `Project`, `ProjectStage`, `StageRequirement`, `Task`, `Blocker`, `Decision`, `Draft`, `Vendor`, `VendorHours`, `Invoice`, `DocumentRow`, `ProjectEvent`, `Digest`, `SettingRow` types mirroring DDL; `supabaseAdmin()`, `supabaseServer()`, `supabaseBrowser()`.

### Task 4: Requirement import module + seed

**Files:** Create `lib/import/requirements.ts` (+ `requirements.test.ts`), `lib/import/schema.ts` (Zod for the dashboard `record` format), `scripts/seed.mjs`, `supabase/seed/data.json` (from extracted `data-substages.json`), `supabase/seed/substage-catalog.json` (SUB map: entitlements 9 rails, plan_check 6, permits 3).

**Interfaces — produces:** `parseRecordImport(json: unknown): ImportResult` (validated stages+requirements per project); `applyImport(admin, projectName, result)` — upserts project_stages + stage_requirements (idempotent on (project_id, stage_key) and (project_stage_id, position)). Used by BOTH seed script and Settings import UI (spec §8).

**Steps (TDD):**
- [ ] Test: minimal valid record `{stage: 'entitlements', stages: {entitlements: {items: [{r: 'Site control', done: true, who: 'us', state: 'done_noev', basis: 'standard'}], total: 1}}}` → 1 stage, 1 requirement; state mapping `done_noev`→`done`, `open`→`open`, `unknown`→`unknown`.
- [ ] Test: rejects invalid `who`; unknown stage keys ACCEPTED (extensible) with title-cased label.
- [ ] Implement; green.
- [ ] `scripts/seed.mjs`: maps projects, project_stages (stages.done[]+current+record keys+also_active+substage+risk/slip/confirmed), requirements via `applyImport`, tasks (description, planned, source), blockers (days_stuck, downstream[]), invoices (approval 1→received, 2→for_rowan_approval, 3→approved; paid→paid; tab invoices), decisions (t→title, why→detail), directory→vendors, project_events (history/forecast), substage catalog. `--dry-run` prints counts.
- [ ] Verify dry-run: 5 projects, 59 tasks, 7 blockers, 94 invoices.

### Task 5: Claude client

**Files:** Create `lib/claude.ts` (+ `claude.test.ts`). **Load `claude-api` skill first.**

**Interfaces — produces:** `runStructured<T>(opts: {job: JobName; system: string; messages: MessageParam[]; schema: ZodSchema<T>; toolName: string; maxTokens?: number}): Promise<T>` — forced tool_choice, Zod-validated, one retry feeding validation error back, then `StructuredOutputError`. `MODELS: Record<JobName, string>`, jobs: `triage` | `extract` | `digest` | `analyze`.

**Steps (TDD):** fake injected client: parses valid tool_use; retry-then-throw on invalid. Implement (injectable client, env singleton default).

### Task 6: Priority engine

**Files:** Create `lib/priority.ts` (+ `priority.test.ts`).

**Interfaces — produces:** `scoreTask(t, ctx: {today: string; currentStageKey?: string|null}): number`; `topActions(tasks, blockers, stagesByProject, opts?): Action[]` — `Action = {kind: 'task'|'blocker', id, project, title, why, score}` sorted desc, limit 8 default; `followUpAlerts(tasks, today): Task[]` (follow_up_date/check_back_on ≤ today, open).

**Scoring:** +40 critical, +20 high; overdue +35, due ≤2d +25, ≤7d +12; follow-up due +18; on current stage +25; waiting_for set +6; last_touched >14d +8. Blockers: 50 + min(days_stuck,30) + 15 if downstream ≥2.

**Steps (TDD):** rule-by-rule tests + ordering + today-inclusive boundary; implement; green.

### Task 7: Task dedup matcher

**Files:** Create `lib/dedup.ts` (+ `dedup.test.ts`).

**Interfaces — produces:** `matchExistingTask(candidate: {title; project_id; stage_key?}, open: Task[]): Task|null` — normalized token-set Jaccard ≥0.55 OR containment ≥0.8, same project only, stage mismatch −0.15. Deterministic, no LLM.

**Steps (TDD):** rephrase matches ("Retain Surveyor (Updated Survey / Topo)" ≈ "Retain surveyor — updated survey/topo"); different work doesn't ("Retain Surveyor" ≠ "Retain Civil Engineer"); cross-project never; implement; green.

### Task 8: extract-comms agent

**Files:** Create `agents/extract-comms.ts`, `agents/schemas.ts` (+ `extract-comms.test.ts`), fixtures `fixtures/email-soils.txt`, `fixtures/transcript-weekly.txt` (from POC sample-data).

**Interfaces — produces:** `extractComms(doc: {id, project_hint?, raw_text}, ctx: {projects, openTasks}): Promise<ExtractResult>`; ExtractResult (Zod) = `{project_name: string|null; tasks: {op: 'create'|'update'; existing_id?; title; description?; owner?; waiting_for?; due?; stage_key?; priority; planned?; follow_up_date?}[]; blockers: [...]; decisions: {title; detail; decided_at?}[]; drafts: {to_email?; subject; body; re_blocker_index?}[]; vendor_hours: {vendor_name; hours; rate?; period?; note?}[]; deadline_updates: {task_match; new_due; evidence}[]}`. Claude proposes; `matchExistingTask` reconciles create/update server-side (item 1 belt-and-braces).
- Writer: `applyExtractResult(admin, docId, result)` inserts/updates, links document_id, bumps last_touched.

**Steps:** schema tests; agent test with canned tool JSON → captured DB ops correct (admin mocked); implement.

### Task 9: parse-invoice agent

**Files:** Create `agents/parse-invoice.ts` (+ test, fixture `fixtures/invoice-kgs.txt`).

**Interfaces — produces:** `parseInvoice(doc: {id, raw_text?, pdf_base64?}, ctx: {projects, vendors}): Promise<InvoiceParse>` = `{vendor_name, project_name, number, amount_usd, invoice_date?, received_date?, note?}`; `applyInvoiceParse` upserts vendor, inserts invoice status `received`, tab `invoices`.

### Task 10: daily-digest agent

**Files:** Create `agents/daily-digest.ts` (+ test).

**Interfaces — produces:** `buildDigest(admin, forDate): Promise<{body_md; top_actions: Action[]}>` — topActions + followUpAlerts computed pure; Claude writes narrative (sections: Top actions · Stuck · Follow-ups due · Stage changes · Money waiting on Rowan); stores digests row.

### Task 11: Ingest routes

**Files:** Create `app/api/ingest-email/route.ts`, `app/api/upload/route.ts`, `lib/ingest.ts` (+ `ingest.test.ts`), `lib/docx.ts` (mammoth).

**Interfaces — produces:** `ingestDocument(admin, input: {kind, source, external_id?, project_hint?, raw_text?, storage?})` → `{documentId, deduped}`; dedup on external_id; routes email/transcript → extract-comms, invoice_pdf → parse-invoice.
- `POST /api/ingest-email`: `x-ingest-secret` guard, body `{from, to, subject, text, message_id, date}`.
- `POST /api/upload` (auth): multipart; `.pdf`→invoice_pdf (storage bucket `documents`), `.txt`/`.docx`→transcript.

**Steps (TDD):** dedup + secret guard via direct Request invocation; implement.

### Task 12: Mail polls + external syncs

**Files:** Create `lib/mail/gmail.ts`, `lib/mail/outlook.ts`, `lib/sync/sheets.ts`, `lib/sync/zimas.ts`, cron routes `app/api/cron/{poll-gmail,poll-outlook,sheets-sync,zimas-sync,digest}/route.ts`, `lib/cron.ts` (Bearer CRON_SECRET / Vercel cron header guard).

**Interfaces:** each adapter: `isConfigured(): boolean`, `run(admin): Promise<{processed: number} | {skipped: 'not_configured'}>`. Gmail unread poll (external_id = message id); Outlook Graph unread; Sheets (settings `sheet_ids` {gantt, budget}, SA JWT) → project_events forecast + budget lines; Zimas per city_case → status/clearances regex → project_events + city_on_hold, result logged to settings `zimas_last_result`. Cron routes never throw (200 + error field).

### Task 13: i18n + design tokens

**Files:** Create `lib/i18n/en.json`, `lib/i18n/he.json`, `lib/i18n/index.ts` (+ parity test), `components/locale-toggle.tsx`, `components/theme-toggle.tsx`, update `app/layout.tsx` (dir from locale cookie), `app/globals.css` (v3 palette light+dark).

**Interfaces — produces:** `useT()` client + `getT(locale)` server: `t('overview.top_actions')`; cookies `sk-locale` (`en`|`he`), `sk-theme`. Palette tokens extracted from `dashboard-substages.html` styles. RTL via `dir="rtl"` + logical utilities.

**Steps:** parity test (flattened key sets equal); dictionaries for ALL Task 14-15 strings; toggles; layout wiring.

### Task 14: Dashboard overview page

**Files:** Create `app/(dash)/layout.tsx`, `app/(dash)/page.tsx`, `components/overview/top-actions.tsx`, `whats-stuck.tsx`, `project-rails.tsx`, `requirements-pane.tsx`, `tasks-section.tsx`, `decisions-week.tsx`, `compare-charts.tsx`, `lib/queries.ts` (`getOverviewData()` server-side, priority engine on server).

**Use design skills first** (ui-ux-pro-max + frontend-design + design-taste-frontend). Port paneWork/paneTime interaction logic from `dashboard-substages.html` (client-validated).

**Acceptance:** hero = Top actions + What's stuck, top, largest scale (item 2); rails collapsible (4b), stones clickable past/current/future (4a), 3-state groups On us / City issues / Unknown / Done; substage rail + timeline tab; tasks collapsed default (6) with Description (8) + manual add (13); decisions grouped by project title-first (7); compare charts bottom (5); EN/HE + RTL + dark all render.

### Task 15: Sub-pages

**Files:** Create `app/(dash)/invoices/page.tsx` + `components/invoices/*` (tabs Invoices/Payment Summary/David; filters project/entity/vendor/status/date; 4-chip chain, for_rowan_approval loud; received/paid dates; transfer link; status-advance server action), `app/(dash)/drafts/page.tsx` (approve/dismiss/copy/mailto), `app/(dash)/digest/page.tsx`, `app/(dash)/directory/page.tsx`, `app/(dash)/upload/page.tsx` (dropzone), `app/(dash)/settings/page.tsx` (requirements JSON import via `parseRecordImport`+`applyImport`, stage overrides, substage catalog, sheet IDs, integration status, zimas run-now).

### Task 16: Auth

**Files:** Create `app/login/page.tsx`, `middleware.ts` (unauthed → /login for (dash); API routes excluded — secret-guarded), server actions `signIn`/`signOut`. Email+password only, no signup UI, `@supabase/ssr` cookies.

### Task 17: Deploy readiness

**Files:** Create `vercel.json` (crons per spec §11, maxDuration 300 agent routes), README ops runbook (env matrix, Supabase apply, forwarding setup, user creation), `scripts/apply-migrations.mjs`.

**Steps:**
- [ ] `npm run check` + `npm run build` green.
- [ ] Push to GitHub (Dor /commit-push flow).
- [ ] Vercel link + env + deploy.
- [ ] Supabase apply migration + seed (keys from Dor).
- [ ] Smoke: login → seeded overview; sample email POST → task appears.

---

## Self-review (done)

- Spec coverage: §2→T2/T4/T14; §5→T11/T12; §6→T5-T10,T12; §7→T13-T15; §8→T4+T15; §9→T4; §10→T2/T3/T16; §11→T12/T17; §12→per-task TDD; §13→T17. Client items 1→T7/T8, 2→T14, 3→T15, 4→T14, 5→T14, 6→T14, 7→T14, 8→T4/T14, 9→T6/T10, 10→T12, 11→T12, 12→T8, 13→T14, 14→T6/T10/T12. No gaps.
- Types consistent (Action, ExtractResult, ingestDocument single-sourced).
- UI tasks carry acceptance criteria + design-skill directive instead of frozen JSX (deliberate — design skills own visual output).
