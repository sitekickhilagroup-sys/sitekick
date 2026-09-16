# SiteKick — Architecture Baseline

**Status:** Reconciled from two independent inspections — Claude (application session, full read
of listed files) and Codex (local repo + git inspection, commit `f0549e69566b62ff3d9e7ad3028b97f6fd0c6a3c`).
Convergent findings are marked **[confirmed by both]**. This is a source-based map, not a
complete audit — see `OPEN_QUESTIONS.md` for what remains unverified.

**Evidence boundary:** local source does not establish the current deployed version or which
migrations have actually been applied to a remote database. Neither inspection ran the app,
tests, or a build.

## Stack

`package.json`: Next.js 16.3.1, React 19.2.8, TypeScript (strict), `@supabase/supabase-js` +
`@supabase/ssr`, `@anthropic-ai/sdk`, Zod for all agent-output validation, Vitest for tests.
`package.json`'s `name` field is `"sitekick-scaffold"` — stale relative to the code's actual
maturity (see `CURRENT_STATE.md`). **[confirmed by both — Codex additionally notes current
package versions differ from the 2026-08-20 design-spec doc, e.g. that doc cites Next 15.]**

## Source layout

- `app/` — routes, pages, server actions (`app/actions/*.ts`), API routes (`app/api/cron/*`,
  `app/api/ingest-email`, `app/api/upload`).
- `components/` — UI, grouped by area: `overview`, `work`, `inbox`, `invoices`, `weekly`,
  `process`, `portfolio`, `profile`, `upload`, `chrome`.
- `lib/` — shared logic: LLM plumbing (`claude.ts`), integrations (`mail/`, `sync/`), parsing
  (`parse/`), and a deterministic layer around the agents (`priority.ts`, `dedup.ts`,
  `reconcile.ts`, `merge.ts`, `auto-triage.ts`, `state-writer.ts`, `proposals.ts`).
- `agents/` — the LLM-calling agent modules (5 files, see below) + `schemas.ts` (shared Zod
  contracts).
- `supabase/migrations/` — 25 SQL files, numeric prefixes through `0022` with three lettered
  patch-migrations (`0003b`, `0003c`, `0004b`). **[Codex's count, more precise than Claude's
  earlier "22" — confirmed correct.]**

**Do not infer an eleven-agent runtime, or most of the client-handoff docs' schema
(`process_templates`, `actions`, `evidence`, `budgets`, etc.), from the specification documents —
these do not exist in this codebase. Correction (found by Codex, verified by Claude directly
against `supabase/migrations/0003_process_model.sql`): `workstreams` IS a real table — it is not
one of the invented ones.** It was added in Sprint B ("canonical fixed phases + substage library +
parallel workstreams") alongside `phases`, `substage_templates`, `project_substages`, and a
`stage_phase_map` bridge table that maps 19 legacy free-form `stage_key` strings (discovered live
in `project_stages`/`tasks`, e.g. `feasibility`, `b_permit`, `haul_route`) onto the 5 canonical
phases. A `workstreams` row is project-scoped (`project_id`, `name`, `phase_key`, `status`) and
represents a parallel track within a phase (e.g. "Design / Engineering" running alongside "Plan
Check"). This is materially relevant to the Configuration-boundary discussion below — the schema
is more config-ready than the earlier read gave it credit for.

## Agent layer

Five agent modules exist and are wired end-to-end (route → agent → DB):

| Agent | Job (model routing) | What it does | Maturity signal |
|---|---|---|---|
| `extract-comms.ts` | `extract` | Extracts tasks/blockers/decisions/drafts/vendor-hours from one document, with per-item project attribution, dedup, evidence-quote requirements | Most battle-tested: system prompt documents 6 dated, named real production bug fixes |
| `parse-invoice.ts` | `extract` | Classifies document kind before extracting invoice fields; sends PDFs natively to Claude | 2 named real bug fixes; every agent-created invoice hardcodes `needs_verification: true` |
| `daily-digest.ts` | `digest` | Builds the markdown daily digest from 7 parallel Supabase queries | Reads as finished; addresses named real people, not generic roles |
| `prioritize-tasks.ts` | `digest` | Scores open tasks 0-100; **ranks are always derived deterministically server-side, the model's rank is never trusted directly** | Defensive, engineering-disciplined; explicitly a "suggestion layer" |
| `infer-phase.ts` | `analyze` (×1-3 passes) | Infers project phase via a pass-1/adversarial-pass-2/tiebreak-pass-3 loop (attributed in-code to "Dor: 2 or 3 smart iterations") | Sophisticated design, but no bug-fix evidence like the other four — less proven against real data |

### Model routing (`lib/claude.ts`, read in full)

```
triage  → claude-haiku-4-5
extract → claude-sonnet-5
digest  → claude-sonnet-5
analyze → claude-opus-5
```
All four overridable via `SITEKICK_MODEL_*` env vars. `runStructured()` forces tool-call JSON,
validates against Zod, retries once on validation failure. `client?: Anthropic` is injectable —
designed for mockable tests.

**A defined model slot does not prove a corresponding runtime call exists** — see `triage` below.
**[Codex caveat, correctly stricter than Claude's initial read.]**

### Auto-triage — resolved

`app/api/cron/triage/route.ts` invokes `runFullTriage` from `lib/auto-triage.ts`. **[confirmed by
Codex, reading that specific file]** This is a **deterministic rules/threshold engine derived
from learned human decisions — not an LLM call.** No caller selecting the `triage` LLM job was
found anywhere in `agents/` or `lib/`. This resolves Claude's earlier open question. Auto-triage
can *apply or ignore* proposals automatically — it is a real mutation path, not a harmless
read-only classifier. **Do not invoke this endpoint as a diagnostic without understanding it can
change data.**

## Review / human-in-the-loop layer

Agent output → `agent_proposals` + `activity_log` → human review via the Review Inbox
(`components/inbox/review-board.tsx`, route `(dash)/(standard)/inbox`) → only then applied as a
real `task`/`blocker`/`decision`. Per `docs/client-handoff/GAP-PLAN.md`, this replaced an earlier
direct-write pattern ("today our extract-comms writes tasks/blockers/decisions straight to DB —
also our own security finding").

**Correction (Codex, confirmed against Auto-triage above): human review is the default path, not
a universal one.** `runFullTriage` can apply *or* ignore a proposal automatically, based on rules/
thresholds learned from prior human decisions — bypassing the Review Inbox for the cases it
matches. Do not describe "every proposal gets human review" as an absolute in any document or
pitch; it is true of the default path, not of auto-triage's matches.

## Ingestion / integration adapters

| Adapter | Files | Status |
|---|---|---|
| Forward-email webhook | `app/api/ingest-email/route.ts` | README states live, no credential caveat given |
| Gmail poll | `lib/mail/gmail.ts`, `app/api/cron/poll-gmail` | Code exists; no-ops until `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/USER` are set — **deployment status unconfirmed** |
| Outlook poll | `lib/mail/outlook.ts`, `app/api/cron/poll-outlook` | Same pattern, `MSGRAPH_*` — **unconfirmed** |
| Sheets sync | `lib/sync/sheets.ts`, `app/api/cron/sheets-sync` | Code exists; `GOOGLE_SA_EMAIL/GOOGLE_SA_KEY` gated — **unconfirmed** |
| Zimas sync (LA County parcel/zoning) | `lib/sync/zimas.ts`, `app/api/cron/zimas-sync` | Code exists — **unconfirmed** |
| Upload dropzone | `app/api/upload/route.ts` | PDF → invoice pipeline, txt/docx → transcript pipeline |
| Document parsing | `lib/parse/{eml,emails-jsonl,xlsx,archive}.ts` | Supports raw email archive / jsonl / xlsx ingestion formats |

Seed data (`supabase/seed/data.json`, ~180KB) is a **one-time, manually extracted historical
snapshot** of real Hilla data — not a live feed. See `CURRENT_STATE.md`.

## Persistence

25 migrations track real, incremental schema evolution (tables added per "Sprint," per
`docs/superpowers/plans/*`). `lib/state-writer.ts` is a relevant state-mutation component — **its
presence alone does not prove every write path is centralized or audited; review callers,
authorization, and DB policies before changing mutation behavior.**

## Configuration boundary — Core vs. Configuration example

`PHASE_KEYS = ['planning','plan_check','bidding','financing','construction']` is currently a
compile-time Zod enum in `agents/schemas.ts`. The database is **already partway toward
configurable phases** — `phases`, `substage_templates`, and `substage_catalog` tables exist — but
`agents/schemas.ts` does not read from them. **Moving `PHASE_KEYS` into DB-config is a possible,
scoped future task — not an approved change.** Any proposal must account for schema, DB
constraints, all callers, and existing project data.

## Classification (Core / Configuration / Knowledge / Integration / Hilla-LA-specific)

Per `PROJECT_CONTEXT.md`'s classification rule, with concrete file-level examples:

- **Reusable Core (candidate):** `lib/claude.ts` (`runStructured`/`MODELS`); the
  `agent_proposals` → human-approval → `activity_log` pattern; `lib/priority.ts` +
  `prioritize-tasks.ts`'s "engine score as hint, rank always derived server-side" philosophy;
  `lib/dedup.ts`, `lib/reconcile.ts`, `lib/merge.ts`; `parse-invoice.ts`'s classify-before-extract
  pattern.
- **Configuration (candidate, not yet separated):** `PHASE_KEYS` in `agents/schemas.ts` (should
  eventually read from the `phases`/`substage_templates` tables instead of a hardcoded enum).
- **Company Knowledge (candidate, not yet separated):** the Hilla-specific tuning embedded inside
  `extract-comms.ts`'s single system-prompt string (named people, named incident fixes);
  `daily-digest.ts`'s hardcoded section list and names (e.g. "Money waiting on Rowan").
- **Integration Adapters (already structurally separated):** `lib/mail/*`, `lib/sync/*`,
  `lib/parse/*` — organized as pluggable adapters even though nothing formally labels the
  category yet.
- **Hilla/LA-specific:** the 5-phase vocabulary itself (Plan Check, RTI are LA/CA entitlement
  terms), `lib/sync/zimas.ts` (LA County-specific system), all of `supabase/seed/data.json`.

**No separation has been implemented.** This section is inventory for future decisions, not a
plan — see `PROJECT_CONTEXT.md`'s explicit caution against premature refactoring.

## Known issue — prioritization run integrity — RESOLVED (read-side 2026-09-07, write-side 2026-09-08)

Reading `agents/prioritize-tasks.ts` (`applyPrioritization`) directly confirms a real ordering
bug reported by Codex/local Claude Code: the `priority_runs` row is inserted and committed
(line ~151) *before* the corresponding `task_priorities` rows are inserted (line ~173). If that
second insert fails, the function returns `{ error }`, but the now-empty `priority_runs` row
already exists in the database. **This write-side ordering is still unchanged.**

The read-side half — whether the UI's "latest run" selection would actually surface an empty run
over a good prior one — was reported by Codex/local Claude Code and then **independently
confirmed by Claude directly** by reading `app/(dash)/(standard)/work/page.tsx` lines 108-118:
the query selected strictly the single newest `priority_runs` row by `created_at`, with no check
for whether it had any linked `task_priorities` rows.

**Fix implemented (authorized by Rotem, `DECISIONS.md` D-011):** that query now fetches the 10
most recent `priority_runs` rows, fetches all `task_priorities` rows for that set, and picks the
newest run that actually has at least one linked row — instead of trusting recency alone. The
surrounding variables (`aiByTask`, `aiRunAt`) keep their prior names/shapes, so no other code in
the file needed to change.

**Write-side fix (local Claude Code CLI, 2026-09-08, authorized by Rotem):** a literal reorder of
the two inserts is impossible — `task_priorities.run_id` is a `NOT NULL` FK to
`priority_runs(id)` (`0022_prioritize_learn.sql`), so those rows cannot be inserted before their
parent `priority_runs` row exists. Implemented the practical equivalent: `applyPrioritization`
now deletes the just-created `priority_runs` row if the `task_priorities` insert fails, so a
failed run is never left behind at all — closing the issue at its source rather than only masking
it on read. The read-side fix (D-011) stays in place as harmless defense-in-depth.

**Verified (local Claude Code CLI, 2026-09-08, real Mac terminal, both fixes together):** `npm run
typecheck` — clean (zero errors; the earlier `next build` run had already generated the
`PageProps` ambient type these four route files need, so even the previously-noted pre-existing
errors are gone now). `npx eslint` on both changed files: clean. `npm run build` (`next build`):
compiled successfully, zero errors. `npm run test` (`vitest run`): 370/370 passing (no test
exists specifically for `applyPrioritization`; not added — out of the approved fix's scope). A
live query via the now-authenticated Supabase MCP connection (`OPEN_QUESTIONS.md` Q-008) confirmed
all 22 pre-fix `priority_runs` rows have at least one linked `task_priorities` row (8-138 each) —
no empty run had occurred in production data before this fix landed. See `OPEN_QUESTIONS.md` Q-007
and `DECISIONS.md` D-009/D-011/D-013.

## Known discrepancies

- **Supabase project ref conflict — RESOLVED (local Claude Code CLI, 2026-09-08):**
  `README.md`/`docs/ENV-SETUP.md` cite `lmygivkvggerpztacdjp`; the `docs/superpowers/specs/
  2026-08-20-sitekick-platform-design.md` spec cites `guqfkjqhpffihjerasoe`. Confirmed via the
  live, authenticated Supabase MCP connection that `lmygivkvggerpztacdjp` is real (returns
  production-scale data matching this document's table inventory) — the design-spec doc's ref is
  stale, not a second live environment. See `OPEN_QUESTIONS.md` Q-001.
- `docs/superpowers/specs/2026-08-20-sitekick-platform-design.md` is stale relative to running
  code on at least two independently-verifiable points (Next.js version, Supabase ref) — treat it
  as historical, not current.
