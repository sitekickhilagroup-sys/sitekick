# Sitekick — Platform Design Spec

**Date:** 2026-08-20
**Status:** Approved direction (Dor) + client feedback round folded in (Rotem, 2026-08-20)
**Repo:** `sitekickhilagroup-sys/sitekick` · **Vercel:** `sitekickhilagroup-1633s-projects` · **Supabase:** `guqfkjqhpffihjerasoe`

## 1. What this is

Sitekick is an AI-agent operations platform for Hilla Group's LA real-estate development projects. It ingests the firm's communication streams (email, meeting transcripts, invoices, trackers), runs Claude agents that convert them into structured operational state (tasks, blockers, decisions, invoices, stage progress), and serves a dashboard that answers: **where does every project stand, what's stuck, and what should we do today.**

Successor to the POC in `Rotem/POC` (platform-starter + dashboard v1–v3 + substages demo). This is the production build.

## 2. Core domain model — the client's #1 requirement

> "A project is not a row, it is a sequence of stages. Inside each stage is a list of requirements to complete before exiting it."

- **Per-project stage graphs.** Stages are NOT a global enum. Blair has Plan Approval; Rinconia has no planning stage. Each project owns an ordered list of stages (from a shared catalog of known stage keys: feasibility, entitlements, plan_check, rti, permits, b_permit, haul_route, grading, foundation, framing, inspections, delivery — extensible).
- **Requirements have THREE states: `done` · `open` · `unknown`.** Unknown is first-class — "Plan Check has 21 requirements and we know about 3; say unknown rather than mislead."
- **Ownership split:** every requirement is `us` (Hilla side) or `city` (the City issues it).
- **Requirement lists are DATA, not code.** The PM will send authoritative lists per project; the system imports them from file (JSON; CSV later). Nothing hardcoded.
- **Substages:** each stage key has an ordered substage rail (e.g. entitlements: Filed → Assigned to Planner → … → In Effect). Current substage tracked per project.
- **Evidence:** done-items carry evidence text + source; done-without-evidence is displayed as such.

## 3. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| UI | Tailwind CSS v4 + shadcn/ui, POC v3 design system (linen/sage/apricot pastel, light default + dark toggle, WCAG AA) |
| i18n | EN default + HE toggle, RTL flip, dictionary files (`en.json` / `he.json`) |
| DB / Auth / Storage | Supabase — email+password auth (signup disabled, users pre-created), RLS: authenticated SELECT only; all writes via service-role API routes / server actions |
| AI | `@anthropic-ai/sdk` — Haiku (triage), Sonnet (extraction), Opus (weekly analysis); forced-tool JSON (`runStructured`) |
| Deploy | Vercel (crons via `vercel.json`) |
| Tests | Vitest — lib logic + agent schemas against fixtures, Anthropic mocked |

## 4. Database schema (v2)

Supabase migrations in `supabase/migrations/`. Tables:

- **projects** — id, name (unique), address, llc, city_case, city_on_hold, city_flag, target_rti, created_at
- **project_stages** — id, project_id, stage_key, label, position, status (`done`/`current`/`upcoming`/`skipped`), also_active bool, substage text, risk bool, slip_days int, confirmed bool. Unique (project_id, stage_key).
- **stage_requirements** — id, project_stage_id, text, state (`done`/`open`/`unknown`), who (`us`/`city`), basis (`standard`/`ours`), evidence, note, src, position, done_at. Imported from file; editable in UI.
- **substage_catalog** — stage_key, position, name. Shared rail definitions (seeded from POC SUB map, editable).
- **project_events** — id, project_id, kind (`history`/`forecast`), step, event_date, src. Timeline pane.
- **documents** — id, project_id, kind (`email`/`transcript`/`invoice_pdf`/`sheet`/`other`), source (`forward`/`gmail`/`outlook`/`upload`/`sheets`/`zimas`), external_id (message-id — dedup), storage_path, raw_text, received_at, processed_at
- **tasks** — id, project_id, document_id, title, **description** (client item 8), owner, waiting_for, due, stage_key, priority (`critical`/`high`/`normal`), status (`open`/`done`/`dropped`), **planned** bool (בלת"ם flag), **follow_up_date**, **check_back_on** (item 9), source, last_touched, created_at. Agent updates existing tasks instead of duplicating (item 1).
- **blockers** — id, project_id, document_id, what, blocked_by, days_at_risk, days_stuck, downstream (text[]), suggested_action, status (`active`/`released`), created_at
- **decisions** — id, project_id, title, detail, decided_at, created_at (item 7)
- **drafts** — id, blocker_id, task_id, to_email, subject, body, status (`proposed`/`approved`/`sent`/`dismissed`), approved_at, sent_at
- **vendors** — id, name (unique), role/discipline, contact_name, email, phone, status, hue, notes
- **vendor_hours** — id, vendor_id, project_id, document_id, hours numeric, rate numeric null, period text, note, created_at (item 12)
- **invoices** — id, project_id, vendor_id, document_id, number, amount_usd, invoice_date, **received_date** (item 3c), due (nullable — tracker has no due column; kept nullable, received_date is the primary date), **status 4-state: `received` → `for_rowan_approval` → `approved` → `paid`** (+ `on_hold`) (item 3d), **tab** (`invoices`/`payment_summary`/`david`) (item 3a), entity/llc, paid_date, **transfer_confirmation_url**, approved_by, unique (vendor_id, number)
- **digests** — id, for_date (unique), body_md, top_actions jsonb, created_at
- **settings** — key/value jsonb (stage overrides, feature flags, sheet IDs, follow-up rules)

## 5. Ingest — three mail adapters + uploads

All ingest normalizes into `documents`, dedups on `external_id`, then triggers extraction.

1. **Forward-address** — `POST /api/ingest-email` guarded by `x-ingest-secret`. Universal (works from Gmail and Outlook forwarding rules). Live day one.
2. **Gmail poll** — `lib/mail/gmail.ts`, OAuth refresh token, cron every 10 min. Activates when `GMAIL_*` env vars present.
3. **Outlook / Microsoft Graph poll** — `lib/mail/outlook.ts`, Graph API, cron every 10 min. Activates when `MSGRAPH_*` env vars present.
4. **Upload dropzone** — `POST /api/upload`: PDF → invoice pipeline (native PDF to Claude, no OCR), txt/docx → transcript (docx text extracted server-side via mammoth).

## 6. Agents

`agents/` — each a typed module: input → Claude (forced-tool JSON) → validated rows. Model per job in `lib/claude.ts`.

1. **extract-comms** — email/transcript → tasks + blockers + decisions + drafts + vendor_hours + deadline updates. **Dedup/merge:** before insert, agent receives the project's open tasks and must return `update` ops (matching existing task id) instead of `create` when the item is the same work (item 1). Meeting summaries are the canonical case.
2. **parse-invoice** — invoice PDF → structured invoice row (status starts `received`).
3. **daily-digest** — 07:00 LA cron. Reads DB state → digest markdown + **top actions** ranked by the priority engine. Includes **follow-up alerts**: tasks whose `follow_up_date`/`check_back_on` is due (item 9).
4. **sheets-sync** — Gantt + budget Google Sheets → project_events (forecast) + budget lines (item 10). Sheet IDs in settings; activates when `GOOGLE_SA_*` env present. Cron every 6h.
5. **zimas-sync** — per project city_case → zimas.lacity.org fetch, parse clearances/status → project_events + city_on_hold flag (item 11). Best-effort parser + manual override in settings. Weekly cron + on-demand button.

**Priority engine** (`lib/priority.ts`, pure TS, no LLM): score tasks/blockers by critical flag, due/follow-up proximity, days_stuck, and stage-criticality (is the item on the current stage of its project's own stage graph). Drives Top Actions on dashboard + digest (item 14). Deadlines update from emails/Gantt/meetings via extract-comms + sheets-sync feeding `due`/`project_events`.

## 7. Dashboard (client feedback layout)

Single-page overview + sub-pages. EN/HE toggle, RTL-aware, v3 pastel, dark toggle.

Order on overview (item 2 — hero first):
1. **Today's top actions + What's stuck** — biggest section, top. Priority-engine output; blockers with days-stuck, owner, one-click draft.
2. **Where every project stands** — collapsible (4b). Per-project stage rail from `project_stages` (per-project graphs). Stage stones clickable (4a): past stage → completed list; current → "to finish this stage" with 3-state groups (**On us / The City issues / Status unknown / Done**); future → "what will be required". Substage rail + timeline tab (history + forecast). Case-number chip + ON HOLD flag.
3. **Daily tasks** — collapsed by default, expand button (6). Columns include **Description** (8). **Manual add-task form** (13) alongside auto-created tasks.
4. **Decisions this week** — compact title rows grouped by project, click to expand detail (7).
5. **Compare across projects** (money charts) — bottom (5).

**Invoices page** (3): tabs **Invoices / Payment Summary / David** (a); filters project · entity (LLC) · vendor · status · date (b); columns: received date, invoice date, amount, 4-state status chain with **For Rowan Approval** stage visually loud (d), paid date + Transfer Confirmation link (a).

**Other pages:** Drafts approval queue (approve = mark + copy/mailto; Resend later), Digest archive, Upload dropzone, Directory (vendors + open counts), Settings (requirement-list import, stage overrides, substage catalog, sheet IDs, integrations status).

## 8. Requirement-list import mechanism

`Settings → Import requirements`: upload JSON (schema = the dashboard `record` format from the substages demo) → server action validates + upserts project_stages + stage_requirements for the named project. Same code path used by the seed. When the PM's authoritative lists arrive, they load through this — zero code change.

## 9. Seed

`supabase/seed/` imports the extracted real data (from `dashboard-substages.html` DATA blob): 5 projects with full stage records, 59 tasks, 7 blockers, 94 invoices (approval levels 1/2/3 → received/for_rowan_approval/approved; paid → paid), 5 decisions, directory → vendors, digest sample, substage catalog, project events (history/forecast).

## 10. Security

- Browser: anon key, authenticated SELECT-only RLS on all tables.
- Writes: service-role key server-side only (API routes / server actions).
- Ingest endpoint: shared-secret header. Crons: Vercel cron secret.
- Auth: Supabase email+password, signup disabled, users created by admin.
- No secrets in repo; `.env.example` documents every var.

## 11. Crons (`vercel.json`)

| Path | Schedule | Note |
|---|---|---|
| `/api/cron/digest` | 14:00 UTC | 07:00 LA (PDT); accept 1h winter drift |
| `/api/cron/poll-gmail` | */10 min | no-op until creds |
| `/api/cron/poll-outlook` | */10 min | no-op until creds |
| `/api/cron/sheets-sync` | every 6h | no-op until creds |
| `/api/cron/zimas-sync` | weekly Mon 09:00 UTC | + on-demand |

## 12. Testing

Vitest: priority engine, task dedup matcher, propagate (stage-graph slip), requirement import validator, i18n dictionary completeness (en/he key parity), agent output schema validation against fixtures in `fixtures/` (sample emails, invoice text, transcript), Anthropic client mocked. `npm run check` = typecheck + lint + test; gate before deploy.

## 13. Deploy

GitHub push (dorazouri24 collaborator ✓) → Vercel project in `sitekickhilagroup-1633s-projects` connected to repo → env vars in Vercel. Supabase `guqfkjqhpffihjerasoe`: run migrations + seed. Needed from Dor at deploy: Supabase service-role + anon keys, Anthropic API key, ingest secret (generated), later Gmail/MS Graph/Google SA creds.

## 14. Out of scope v1 (explicit)

- Resend/actual email sending of drafts (approve = mark + copy/mailto; wiring is a switch later)
- Teams meeting auto-pull (transcripts arrive via upload/email until then)
- Multi-tenant (single Hilla workspace)
- Mobile app (responsive web only)
