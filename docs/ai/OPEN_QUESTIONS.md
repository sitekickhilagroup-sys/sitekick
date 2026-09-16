# SiteKick — Open Questions

Unknown facts remain unknown until evidence or the Product Owner resolves them. Do not guess an
answer into `CURRENT_STATE.md` or `ARCHITECTURE.md` to make this list shorter.

## Q-001 — Which Supabase project is real — **RESOLVED (local Claude Code CLI, 2026-09-08)**
`README.md` and `docs/ENV-SETUP.md` reference `lmygivkvggerpztacdjp`. The 2026-08-20 design spec
references `guqfkjqhpffihjerasoe`. **Confirmed independently by both Claude and Codex** — this is
a real discrepancy, not a one-off misread.

**Resolution:** with the Supabase MCP connection now authenticated (see Q-008), the local Claude
Code CLI ran `mcp__supabase__get_project_url` directly — it returned
`https://lmygivkvggerpztacdjp.supabase.co`. `list_tables` against that live connection returned 31
tables with real production-scale row counts (`projects`: 5, `tasks`: 225, `invoices`: 110,
`agent_proposals`: 512, `activity_log`: 1140, `task_priorities`: 2600, `priority_runs`: 22, plus
`workstreams`/`phases`/`substage_templates`/`stage_phase_map` exactly as `ARCHITECTURE.md`
describes) — this is Hilla's real operational data, not an empty or seed-only project. Combined
with `README.md`/`docs/ENV-SETUP.md` already citing this same ref, and the 2026-08-20 design spec
being independently known-stale on other points (Next.js version — see `ARCHITECTURE.md`),
`lmygivkvggerpztacdjp` is confirmed as the real project. The design-spec doc's
`guqfkjqhpffihjerasoe` reference is stale, not a second live environment.
**Impact:** no longer blocks environment-dependent work or validation.

## Q-002 — Existing `package-lock.json` change — **substantially resolved (local Claude Code CLI, 2026-09-08)**
An uncommitted modification exists (144 deletions). Claude's hypothesis is npm metadata
rewriting; the actual cause/author is unconfirmed.

**Evidence found:** the full diff is mechanical — every hunk removes a `"libc": ["glibc"]` array
from an *optional*, platform-gated `rollup`/esbuild-style dependency entry (arm, arm64, ppc64,
riscv64, s390x variants); no version numbers, resolved URLs, or integrity hashes changed. Local
environment is `npm 10.9.8` / `node v22.23.2`. This is exactly the shape of an npm-version lockfile
metadata rewrite (newer/older npm read the same `package.json` and re-emit the `optionalDependencies`
platform metadata slightly differently), not a hand edit or a dependency change. **Not fully
provable without knowing which exact npm version produced the committed lockfile**, but the diff
content is consistent with the hypothesis and inconsistent with a manual or malicious edit.
**Impact:** preserve and exclude from unrelated commits (`DECISIONS.md` D-003) — still applies,
this file remains untouched by all reconciliation work. Low-risk to fold into a future dependency
commit once someone runs `npm install` deliberately, but not yet done.

## Q-003 — `dorazouri24` identity
Found as a Git commit author during local inspection. Presumed to be Dor's GitHub handle, not
confirmed.
**Needed evidence:** a one-line confirmation from the Product Owner.
**Impact:** relevant to contributor coordination and attribution once multiple agents start
committing. Does not establish ownership of the current uncommitted `package-lock.json` change,
and does not block this documentation set. **Do not change git identity settings to resolve
this.**

## Q-004 — Precedence between this reconciliation and the original Claude application assessment
The original Claude application conversation produced a full 12-point repository assessment and
an initial 5-file proposal, delivered to the Product Owner as a standalone document before this
reconciliation. This `docs/ai/` set supersedes that proposal's *structure* (see `DECISIONS.md`
D-007) and incorporates its factual findings, but the original document itself is not duplicated
here in full.
**Impact:** if a discrepancy surfaces later, treat this `docs/ai/` set as current and the original
standalone document as historical input to it, not as a second live source.

## Q-005 — Validation baseline — **RESOLVED for typecheck/lint/build (local Claude Code CLI, 2026-09-08)**
No test, lint, type-check, or build run had been performed by either assistant before this round.

**What actually ran, this session, on the real Mac (not a sandbox), against the working tree as-is
(including the uncommitted `work/page.tsx` fix):**
- `npm run typecheck` (`tsc --noEmit`): 4 errors, all `Cannot find name 'PageProps'`, in the same
  four route files noted in `DECISIONS.md` D-011 — a Next.js ambient type that only exists after
  `next dev`/`next build` has run at least once.
- `npm run build` (`next build`, Turbopack): **compiled successfully, zero errors** — including in
  the four files that failed bare `tsc`. This confirms the `PageProps` errors were purely the
  missing-ambient-type artifact D-011 predicted, not a real defect; running the build is the fix,
  not a workaround.
- `npx eslint "app/(dash)/(standard)/work/page.tsx"`: clean, no output.
- `npm run test` (`vitest run`): **30 test files, 370 tests, all passed**, 744ms. One benign
  config warning (Vite's `configLoader: 'native'` CommonJS-vs-ESM notice on `vitest.config.ts`) —
  informational, not a test failure.
**Impact:** typecheck, lint, build, and the existing Vitest suite are all now a real, run-and-
recorded green baseline as of 2026-09-08 — not merely "not verified" by omission. This does not
mean the suite has full coverage of the codebase; it means what exists passes.

## Q-006 — Precedence between client-handoff docs and the Product Owner's own vision documents
`docs/client-handoff/*` (Build Spec, Implementation Guide, Agent Operating Manual, seed contract)
and the Product Owner's own Vision Doc / LA Doc both describe product direction, but were not
formally ranked against each other.
**Needed evidence:** an explicit Product Owner decision on which is authoritative for product
direction going forward, and whether the client-handoff docs should be relabeled or relocated
(e.g. to a `docs/archive/` path) to avoid being mistaken for current architecture again.
**Impact:** avoid silently archiving, replacing, or treating either set as sole authority before
this is decided.

## Q-007 — Prioritization-run empty-run risk — RESOLVED (2026-09-08, local Claude Code CLI)
`agents/prioritize-tasks.ts`'s `applyPrioritization` inserts the `priority_runs` row before the
`task_priorities` rows; a failure on the second insert used to leave an empty run persisted. **The
write-side vulnerability was confirmed by direct code read (Claude, 2026-09-07) and is now fixed —
see item 1 below.** The read-side half (whether the UI's "latest run" selection would surface an empty run
over a good one) was reported by Codex/local Claude Code and **independently re-verified by
Claude by reading `app/(dash)/(standard)/work/page.tsx` directly — confirmed accurate.** A
read-side fix was then authorized by Rotem and implemented; see `DECISIONS.md` D-011 and
`ARCHITECTURE.md`.
**Status:**
1. **Fixed (local Claude Code CLI, 2026-09-08, authorized by Rotem).** A literal insert-order swap
   turned out to be impossible: `task_priorities.run_id` is a `NOT NULL` FK to `priority_runs(id)`
   (`supabase/migrations/0022_prioritize_learn.sql`), so the child rows cannot be inserted before
   the parent run row exists. Implemented instead: on a failed `task_priorities` insert,
   `applyPrioritization` now deletes the `priority_runs` row it just created, so no empty run is
   left behind. See `DECISIONS.md` D-013.
2. **Done (local Claude Code CLI, 2026-09-08, real Mac terminal, not a sandbox):** `npm run
   typecheck`, `npx eslint`, and — new this round — a full `npm run build` (`next build`) all ran.
   `tsc --noEmit` alone still shows the same 4 pre-existing `PageProps` errors (unrelated, as
   before). **`next build` compiled successfully with zero errors**, including in those same four
   files — confirming the `PageProps` errors are purely the missing-ambient-type artifact, not a
   real problem, now that the build has actually been run once. `eslint` on the changed file:
   clean. See `OPEN_QUESTIONS.md` Q-005 and `DECISIONS.md` D-013 for the full validation run.
3. **Checked (local Claude Code CLI, 2026-09-08, live Supabase query via the now-authenticated MCP
   connection):** all 22 `priority_runs` rows currently in the database have linked
   `task_priorities` rows (range: 8 to 138 linked rows per run; the 8-row run on 2026-08-31 is
   real, not empty). **No evidence the empty-run bug has manifested in production data so far.**
   This does not prove it never will — the write-side race is still live — but it is real
   negative evidence, not a guess. Now that item 1's fix is in, the write path can no longer
   produce a new empty run at all — this data point stands as a snapshot from before the fix.
**Impact:** fully resolved. The write-side bug is fixed, the read-side mitigation from D-011
remains in place as harmless defense-in-depth, and build/typecheck/lint/test all pass against
both changes together— see `DECISIONS.md` D-013.

## Q-008 — Vercel/Supabase MCP connections configured but not authenticated
Codex created `.mcp.json` with two remote HTTP MCP servers: `vercel` (`https://mcp.vercel.com`,
account `sitekickhilagroup@gmail.com`, project `sitekick` approved in-browser) and `supabase`
(`https://mcp.supabase.com/mcp?project_ref=lmygivkvggerpztacdjp&read_only=true`, account
`rotmmeir22@gmail.com`, read-only, permissions approved in-browser). **Browser-side consent was
completed by the Product Owner for both, but the local Claude Code CLI's `claude mcp list` still
shows both as "Needs authentication."** Reported errors: Vercel — `Existing OAuth client
information is required when exchanging an authorization code`; Supabase — an unspecified generic
MCP SDK error (full text not yet captured).
**What Claude checked directly (2026-09-08, via the now-reachable on-device sandbox — see
`WORKFLOW.md`'s channel (1) refinement):** confirmed `.mcp.json`'s exact contents (as above, no
secrets present in the file). **Could not** run `claude mcp login`/`logout`/`get` — the sandbox's
own `claude` binary has no `mcp` subcommand and is not the same process as the Product Owner's
real local Claude Code CLI (see `WORKFLOW.md`). No fix was attempted or applied.
**Likely cause (per Claude Code's own docs and a matching precedent for Supabase specifically —
not verified against this exact case):** a stale/mismatched local OAuth client registration or
credential-store entry for one or both servers — the same class of issue as
[Claude Code's MCP OAuth troubleshooting guide](https://code.claude.com/docs/en/mcp) describes for
"Needs authentication" and token-refresh failures, and as reported for Supabase specifically in
[supabase/supabase#48544](https://github.com/supabase/supabase/issues/48544) (a stale keychain
slot with a client_id the server no longer recognizes).
**Needed action (must run in the Product Owner's real terminal, or via the local Claude Code CLI
— not from this application session):**
1. `claude mcp logout vercel` then `claude mcp login vercel` (re-approve the browser consent
   screen when it reopens — same screen as before).
2. `claude mcp logout supabase` then `claude mcp login supabase` (same, browser consent again).
3. If either still fails, capture the *full* error text (`claude mcp get <name>` after a failed
   login) rather than a generic description, and re-check `.mcp.json`'s project-scoped approval
   via `claude mcp reset-project-choices` if `claude mcp list` reports the server as unapproved
   rather than unauthenticated.
4. Once both show connected: run a genuinely read-only check with each (e.g. a Vercel "list
   projects" / "get project" call confirming the `sitekick` project, and a Supabase "list tables"
   or trivial read query confirming `project_ref=lmygivkvggerpztacdjp`) and record the result here.

**RESOLVED (local Claude Code CLI, 2026-09-08).** `claude mcp list` now shows both servers
`✔ Connected` — whatever stale OAuth state caused "Needs authentication" has cleared (no
`logout`/`login` was needed by the time this session ran the check; possibly the Product Owner or
Codex already ran the recovery steps below, or the state simply resolved). Step 4's read-only
checks were run for real:
- **Supabase:** `mcp__supabase__get_project_url` → `https://lmygivkvggerpztacdjp.supabase.co`,
  confirming the exact ref from `.mcp.json`. `mcp__supabase__list_tables` → 31 tables returned with
  live row counts (see Q-001 resolution above for detail).
- **Vercel:** `mcp__vercel__list_teams` → team `sitekickhilagroup-1633's projects`
  (`team_l9jCJsxk4YO9l1m9BlODw4wK`), matching the `sitekickhilagroup@gmail.com` account named in
  this question. `mcp__vercel__list_projects` (with that team ID) → project `sitekick`
  (`prj_XemU3jGdKLn4LUP2fbD3dgAyuHlh`), linked to GitHub `sitekickhilagroup-sys/sitekick`.
**Impact:** no longer blocks Vercel/Supabase MCP tool use from the local Claude Code CLI. Note:
Supabase access is confirmed read-only per the connector config; no write/mutation call was
attempted or should be, per that same config.
