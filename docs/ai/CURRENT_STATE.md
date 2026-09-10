# SiteKick — Current State

**This is a dated snapshot, not a living guarantee. Refresh it whenever relevant evidence
changes — see `WORKFLOW.md` for when to update.**

**2026-09-09/10 (Claude, extended session, "operational readiness"):** Root-caused and fixed a
production bug that made My Work silently show a stale, day-old prioritization run — an unordered
multi-run `task_priorities` fetch was truncating at PostgREST's default 1000-row cap in physical
row order, not recency (`lib/priority-run-select.ts` fixes it: count each candidate run first,
fetch rows for only the winning one). Built the Notes Center (`app/(dash)/(standard)/notes-center`,
`lib/notes-center.ts`) — a real screen merging historical `tasks.latest_note` "(... via Claude)"
notes with real `comments` rows, ranked target-candidate matching, no hardcoded counts. Corrected
`lib/feedback-context.ts`'s test/dismissed-note isolation to fail CLOSED on a real DB error (not
just a missing-column one) and to cascade through test projects, not just directly-flagged tasks.
Ran migration `0026` (Rotem, Supabase SQL Editor): `tasks.is_test`, `projects.is_test`,
`comments.is_test`, `comments.status` — all 4 columns confirmed present and default-safe. Built and
live-tested a QA test project/task end-to-end (create, edit every field, status change + reflection,
note association, save-failure rejection) — see
`docs/ai/handoffs/LIVE_FUNCTIONAL_QA_HANDOFF.md` for the full log, including one caught-and-reverted
test-data contamination incident (my own automation error, not an app bug) and a real isolation gap
found live and fixed (`158c142`: the Notes Center page itself had no test-data exclusion). Explicitly
NOT built this session, still open: persistent undo-from-history, concurrent-edit conflict
detection, Inbox review draft persistence, a continuous import-processing queue (149 documents
stored from the .olm subset upload, only 16 processed, 133 still waiting — confirmed live). Full
32-item acceptance matrix (per-item pass/fail/blocked/not-implemented, with evidence) at
`/Users/rotemmeir/Documents/Codex/2026-09-07/referenced-chatgpt-conversation-this-is-an/output/pdf/noa-fixes-test-results.csv`
(outside the repo — Noa's/Rotem's working folder). Production version at end of session: `158c142`.

**Last inspected:** 2026-09-07. **Inspected commit (Codex):** `f0549e69566b62ff3d9e7ad3028b97f6fd0c6a3c`.
No `fetch` was performed against the remote by either inspection — a local branch reference does
not establish that `origin` has no newer commits. **Reconciliation round 2 (2026-09-07, same
day):** Codex/local Claude Code reviewed this document set and reported 3 documentation
corrections + 1 new code-level finding; Claude verified the corrections directly against source
before applying them. See `DECISIONS.md` D-009/D-010 and `OPEN_QUESTIONS.md` Q-007. **Round 3
(2026-09-07, same day, "take the wheel"):** Rotem authorized a code change while Codex access was
temporarily unavailable; Claude implemented a read-side fix for the prioritization empty-run bug
in `app/(dash)/(standard)/work/page.tsx`, **not committed, not build/typecheck/test-verified**
(`device_bash` unavailable all session). See `DECISIONS.md` D-011. **Round 4 (2026-09-08):** the
on-device sandbox became reachable for the first time — used to typecheck/lint the round-3 fix
(clean, see D-011 update) and to investigate a blocked Vercel/Supabase MCP authentication task
(not resolved from this session — see D-012, `OPEN_QUESTIONS.md` Q-008, and `WORKFLOW.md`'s
refined environment-access section). **Round 5 (2026-09-08, local Claude Code CLI, "Claude handoff
reconciliation"):** the local CLI (ordinary Mac shell access, not the cloud session's bridge) read
this document set per `WORKFLOW.md` and verified the handoff's open items directly. Result: MCP
auth for both Vercel and Supabase is now connected and was exercised with real read-only calls;
Q-001 (Supabase ref), Q-005 (validation baseline), and Q-008 (MCP auth) are resolved; Q-002
(`package-lock.json` diff) is substantially explained; a full `npm run build` and `npm run test`
ran clean (370/370 tests passing) in addition to the typecheck/lint already recorded. See D-013.
As of this round: still the same one real application-code file changed on disk plus this
documentation set, still no commit — see below.

## Repository snapshot

- Local path: `/Users/rotemmeir/Documents/sitekick`.
- Branch at inspection: `main`, tracking `origin/main`.
- **Existing uncommitted change: `package-lock.json`, 144 deletions, author/cause unconfirmed.**
  Claude's hypothesis (npm metadata rewrite) is an explanation, not proof. **Preserve this change
  — do not reset, overwrite, or fold it into an unrelated commit.** See `OPEN_QUESTIONS.md` Q-002.
- `AGENTS.md` previously contained only the Next.js-generated block; `CLAUDE.md` was a one-line
  `@AGENTS.md` reference; `docs/ai/` was absent before this reconciliation.

## Status taxonomy

Per the Product Owner's own instruction, every capability below is tagged with exactly one of:
**IMPLEMENTED AND VERIFIED**, **IMPLEMENTED BUT NOT VERIFIED**, **PARTIALLY IMPLEMENTED**, or
**PLANNED / FUTURE VISION**, plus a separate **HILLA/LA-SPECIFIC** or **REUSABLE-CORE-CANDIDATE**
tag where relevant (full detail and file paths in `ARCHITECTURE.md`).

### Implemented but not verified
*(Code exists, is wired end-to-end, and — for the first two — carries direct evidence of having
processed real production incidents. "Not verified" means: no test run was executed in either
inspection this session; treat this tier as strong-but-circumstantial, not proven.)*

- `extract-comms.ts` — extraction, dedup, human review routing. Strongest evidence tier: 6 named,
  dated real bug fixes in its own prompt comments.
- `parse-invoice.ts` — invoice classification + extraction, `needs_verification: true` always set.
  2 named real bug fixes.
- `daily-digest.ts` — daily digest generation.
- `prioritize-tasks.ts` — deterministic-rank prioritization.
- `agent_proposals` / Review Inbox human-approval flow.
- Model routing (`lib/claude.ts`) — the Haiku/Sonnet/Opus job mapping itself is confirmed by
  direct code read; whether it behaves correctly under real load is not verified.
- `infer-phase.ts` — sophisticated multi-pass design confirmed present; no incident evidence like
  the other agents, so treat as less proven against real data specifically.
- `auto-triage.ts` / `runFullTriage` — confirmed as the real caller from `api/cron/triage`
  (deterministic rules, not an LLM call). Behavior under real data not verified.

### Partially implemented

- Weekly Review (`/weekly`) — shipped per `docs/client-handoff/GAP-PLAN.md`, but transcript
  upload is explicitly a stub: upload stores + links the recording only, no transcription.
- Requirements/process import (`lib/import/requirements.ts` + Settings UI) — exists, but only for
  requirement-checklist JSON, not general company configuration.
- Phase/substage configurability — DB tables exist and are richer than first read: `phases`,
  `substage_templates`, `substage_catalog`, `workstreams` (parallel tracks within a phase),
  `project_substages`, and a `stage_phase_map` bridge from 19 legacy free-form stage keys to the
  5 canonical phases. `agents/schemas.ts`'s `PHASE_KEYS` still doesn't read from any of it (see
  `ARCHITECTURE.md`).

### Planned / not implemented / future vision

- OneDrive live sync and forecasts — `GAP-PLAN.md` states explicitly: not started.
- Any multi-tenant machinery: Company Configuration Layer, Company Knowledge layer, per-tenant
  data isolation. System is single-tenant, hardcoded to Hilla, today.
- Execution Memory (situation → context → action → outcome learning/case-comparison loop) — not
  implemented. `priority_runs`/`task_priorities`/`digests` exist but no structured outcome-
  learning mechanism does.
- Vision-doc Phase 2-4 Intelligence Modules (Portfolio, Financial, Contract & Claims, Vendor
  Outcome, Procurement, Deal Intelligence) and LA-doc agents 6-9 (internal recommendation engine,
  resource/vendor matcher, vendor rating, market/deal scanner) — none exist in `agents/`. Both
  source documents correctly sequence these as later phases — this is expected "not yet," not a
  gap against plan.

### Known issue — RESOLVED (read-side and write-side both fixed, 2026-09-08)

- Prioritization run integrity (`agents/prioritize-tasks.ts` / `app/(dash)/(standard)/work/page.tsx`):
  a `priority_runs` row can be persisted with zero linked `task_priorities` rows if the second
  insert in `applyPrioritization` fails (write-side, confirmed directly by Claude — **still
  unchanged**). The UI's "latest run" query used to pick strictly the newest `priority_runs` row
  by `created_at` with no check for linked rows, so an empty run would silently replace a good one
  (read-side, confirmed directly by Claude, 2026-09-07 — see `app/(dash)/(standard)/work/page.tsx`
  lines 108-118 at the time of the read). **Read-side fix implemented 2026-09-07** (authorized by
  Rotem): the query now looks at the 10 most recent runs and picks the newest one that actually has
  linked `task_priorities` rows, instead of trusting recency alone. See `DECISIONS.md` D-011.
  **Update 2026-09-08 (round 4):** `npm run typecheck` and `eslint` were run against the read-side
  fix — clean (zero errors from the new code; 4 pre-existing unrelated `PageProps` errors from
  never having run `next dev`/`next build`). **Update 2026-09-08 (round 5, local Claude Code
  CLI):** a real `npm run build` (`next build`) ran — **compiled successfully, zero errors
  anywhere, including in the four files the bare `tsc` run had flagged** (confirms those were
  purely the missing-ambient-type artifact). `npm run test` (`vitest run`) also ran: 30 files, 370
  tests, all passed. A live query against the real Supabase database (via the now-connected MCP)
  confirmed all 22 existing `priority_runs` rows have linked `task_priorities` (8-138 each) — no
  empty run had occurred in production data as of that check.
  **Write-side fix implemented the same round, authorized by Rotem:** a literal reorder of the two
  inserts turned out to be impossible — `task_priorities.run_id` is a `NOT NULL` FK to
  `priority_runs(id)` (`0022_prioritize_learn.sql`), so the child rows cannot exist before their
  parent run row does. Implemented the practical equivalent instead: `applyPrioritization` now
  deletes the just-created `priority_runs` row if the `task_priorities` insert fails, so a failed
  run is never left behind. Re-verified clean: `tsc --noEmit` (now genuinely zero errors, since the
  build had already generated the `PageProps` type on disk), `eslint`, `next build`, and
  `vitest run` (370/370, unchanged). See `ARCHITECTURE.md`, `OPEN_QUESTIONS.md` Q-007, and
  `DECISIONS.md` D-013.

- **Vercel/Supabase MCP authentication — RESOLVED (round 5, 2026-09-08, local Claude Code CLI).**
  `claude mcp list` now shows both `vercel` and `supabase` as `✔ Connected`. Real read-only calls
  succeeded on both: Supabase's `get_project_url` confirmed `lmygivkvggerpztacdjp` and
  `list_tables` returned 31 real tables with live row counts; Vercel's `list_teams`/`list_projects`
  confirmed the `sitekick` project under `sitekickhilagroup-1633's projects`, linked to GitHub
  `sitekickhilagroup-sys/sitekick`. See `OPEN_QUESTIONS.md` Q-008 and `DECISIONS.md` D-013.

### Not verified — deployment/environment

- Whether real credentials are configured for Gmail/Outlook/Sheets/Zimas in the actual
  deployment. Static code reading cannot answer this — MCP access confirmed the database, not
  the mail/sheets/Zimas integration credentials specifically.
- ~~Which of the two conflicting Supabase project refs is the real one~~ — **resolved,
  `lmygivkvggerpztacdjp`, see `OPEN_QUESTIONS.md` Q-001.**
- ~~Current test/lint/type-check/build/CI status~~ — **resolved for typecheck/lint/build/test as of
  2026-09-08 (round 5): `npm run typecheck` (4 pre-existing unrelated errors), `npm run build`
  (clean), `npx eslint` (clean), `npm run test` (370/370 passing). Not yet run: DB migrations
  against a fresh target, production endpoints, or an actual deployment.** See
  `OPEN_QUESTIONS.md` Q-005.

## Next work

- Review this documentation set with the Product Owner (this reconciliation, now in its second
  round via the local Claude Code CLI).
- ~~Decide (Product Owner): authorize or defer the write-side fix for the prioritization
  empty-run bug~~ — **done: authorized and implemented, 2026-09-08. See `DECISIONS.md` D-013.**
- Decide whether/when to commit the now-verified `work/page.tsx` read-side fix (D-011) and the
  `agents/prioritize-tasks.ts` write-side fix (D-013), separately from the untouched
  `package-lock.json` diff (D-003) — all three are still uncommitted.
- Resolve `OPEN_QUESTIONS.md` Q-003 (`dorazouri24` identity) — the one remaining open item that
  needs a Product Owner answer rather than more code inspection; Q-004/Q-006 are precedence
  decisions also awaiting the Product Owner.
- Decide (Product Owner) whether/when to begin the scoped `PHASE_KEYS`-from-config extraction as
  a first Core/Configuration separation — not yet authorized.
