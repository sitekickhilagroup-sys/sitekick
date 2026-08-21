# Sitekick — Client Handoff vs Current POC — Gap Plan

Source: https://sitekick-blair-process-demo.noameir399.chatgpt.site (Noa's demo, v5 spec, files in this folder).
Date: 2026-08-21.

## Where we're already AHEAD of the demo

The demo is a static front-end — all updates live in browser localStorage, no auth, no DB, no agents running. We already have in production:

- Supabase persistence + auth + user management (their "decide production stack and authentication model" step — done)
- Email / DOCX / XLSX / EML / JSONL ingestion with Claude extraction + task dedup (their pipeline steps 1–4, partially)
- Deterministic priority engine with structured "why" parts (their Priority Agent core)
- Daily digest cron (their Daily Planning Agent)
- Invoices workspace with status chain, tabs, filters (most of their Invoices contract)
- Drafts approval queue (the human-approval pattern their Review Inbox wants)
- Cron mailbox polling (their "recurring scans")

Strategy: keep our backend, adopt their product structure and contracts on top. Do NOT throw away and rebuild.

## Gaps (ranked by value / effort)

### 1. Agent Review Inbox + audit log — HIGH value, MEDIUM effort
Spec non-negotiable: agents propose, human approves, one State Writer commits; every mutation audited.
Today our extract-comms writes tasks/blockers/decisions straight to DB (also our own security finding).
Build: `agent_proposals` + `activity_log` tables; extraction emits proposals; low-confidence/conflicting → inbox UI; accept/reject buttons; auto-accept only high-confidence non-destructive ops (create task) if we choose.

**Status (2026-08-21):** Shipped — `agent_proposals` + `activity_log` tables and the `/inbox` review UI (Sprint A).

### 2. My Work screen — HIGH value, LOW-MEDIUM effort
Views over the SAME tasks table: Today / Blocking / Follow-ups / Waiting / All, grouped by project, ranked.
Update verbs per row: Completed, Sent email, Waiting, Delayed, Scheduled, Not applicable, Add note.
`+` disclosure: evidence, what-it-unlocks, recommended next move.
We have the data; mostly a new page + a few task fields (`snoozed_until`, `manual_priority`, notes).

**Status (2026-08-21):** Shipped — `/work` screen with Today/Blocking/Follow-ups/Waiting/All views (Sprint A).

### 3. Fixed 5-phase process model — HIGH value, HIGH effort (migration)
Their canon: Planning > Plan Check > Bidding > Financing > Construction, with a reusable sub-stage library, conditional sub-stages (Hold Letter, Deemed Complete, Extension Determination…), and PARALLEL workstreams (San Marco: Planning track ∥ Design/Engineering track).
Ours: per-project free-form stage list (Feasibility → … → Framing). Schema work: `phase/substage templates`, `project_substages`, `workstreams`. Migrate existing stage data into the template model.

**Status (2026-08-21):** Shipped — phase/substage schema + Process page on the project view, plus agent phase inference from emails (Sprint B).

### 4. Relationships + evidence links — MEDIUM value now, grows later
Types: Blocks / Supports / Parallel / Unrelated / Needs verification, each with evidence, confidence, verifier, manual override. "Co-occurrence is not dependency."
We only have a flat `blockers` table. New `relationships` + link `evidence` (our `documents` are 90% of their evidence table already).

**Status (2026-08-21):** Shipped — `relationships` table with typed links (Blocks/Supports/Parallel/Unrelated/Needs verification) and "unlocks" surfaced in My Work (Sprint C).

### 5. Weekly Review screen — MEDIUM value, MEDIUM effort
Sunday prep / Monday meeting: Project > Sub-topic > Actions, carry-forward with current status + weekly note, Save Review. MP4/Teams transcript upload later (their demo has it as design-only too).

**Status (2026-08-21):** Shipped — `/weekly` Review Board (Project > Sub-topic > Actions) with Save Review (Sprint D).
**Status (2026-08-21):** Deferred — MP4/Teams transcript upload; `/api/upload` stores + links the recording only, no transcription yet.

### 6. Portfolio restructure + design system — MEDIUM value, LOW-MEDIUM effort
Rename/split our Overview into Portfolio (understand) vs My Work (act). Accordion per project with: current position, parallel workstream, what-must-happen-next, main blocker, "then".
Design system: Geist Sans/Mono, their semantic palette (green=progress, red=verified blocker ONLY, amber=verify, blue=external waiting). Our token system makes this a palette swap + font swap, not a rebuild.

**Status (2026-08-21):** Shipped — Portfolio accordion on Overview (`components/portfolio/project-accordion.tsx`) + Geist/semantic-palette design system (Sprint C).

### 7. Invoices deltas — LOW effort
Add: invoice link + receipt link fields, aggregated "Payment Run" action in My Work, keep exact workbook dates (we already do).

**Status (2026-08-21):** Shipped — invoice/receipt link fields + edit-links UI, aggregated Payment Run action on `/work` (Sprint A).

## Proposed build order (maps to their recommended order)

- **Sprint A (this week):** #1 Review Inbox + activity log, #2 My Work, #7 invoice deltas. Users: ADMIN_EMAILS live (Dor superadmin, Noa user).
- **Sprint B:** #3 process-model migration + Project Process screen (their San Marco parallel-tracks acceptance test is the target).
- **Sprint C:** #4 relationships + evidence UI, #6 Portfolio + design-system restyle.
- **Sprint D:** #5 Weekly Review; then OneDrive live sync, Teams/MP4 transcription, forecasts.
  **Status (2026-08-21):** Deferred — OneDrive live sync and forecasts not started; MP4/Teams transcription status covered under gap #5 above.

## Non-negotiables to respect throughout (from seed contract)

One canonical action record · co-occurrence ≠ dependency · manual override outranks agents · conflicts create Verify · unknown stays unknown · every mutation auditable.
