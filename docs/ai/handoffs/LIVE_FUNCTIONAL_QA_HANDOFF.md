# Live Functional QA — handoff (in progress)

## Session 2026-09-11 (continuation) — Date provenance CLOSED (with one known residual), Agent Review Inbox audit + safe fixes

### Item 0 — Date provenance: CLOSED, one residual gap flagged honestly

Migration `0027_date_provenance.sql` applied by Rotem; verified via `information_schema` (3
columns present). Two-tab Production preflight passed (identical build hash both tabs, both opened
and cancelled "+ Add action" cleanly) before any code.

**Implemented and live-verified** (commits `3043568`, `5b64646`, `7b5a5c1`, `283d479`):
- `due_provenance` ('explicit'/'derived'/'unresolved') + `due_source_document_id` + `due_source_date`
  stamped on every write path that can set a task's `due`: `extractComms`'s autoCreates,
  `applyProposal` (task_update/task_done/deadline_update — the human-approval Apply path),
  `app/actions/process-text.ts`'s separate "Paste an update" path (found live, not in the original
  extractComms-only scope), Edit details, the Delayed/Scheduled verbs, and — found live, a real bug —
  the Inbox drawer's own `decideProposal` taskPatch construction, which bypassed `applyProposal`
  entirely for the `update_existing`/`new_task`/`keep_both_linked` treatments (the DEFAULT treatment
  for a matched task_update). Fixed in `283d479` with a shared `dueProvenanceFields()` helper; also
  fixed `undoProposalDecision`'s own separate hardcoded restore-key list (missing the 3 new columns).
- `auto-triage.ts`: a due date without `due_provenance:'explicit'` can no longer auto-apply, even
  inside an otherwise learned-accept class (`isSafeEnrichment` + a new `assertsUnconfirmedDue` gate
  on the learned-threshold path) — closes the one truly "silent" path (auto-apply with no human in
  the loop at all).
- Display: My Work's Due badge never renders a derived/unresolved date as Overdue/Now (shows
  "Estimated"/"Unconfirmed · <date>" instead, and always names the actual date — also fixes Noa's
  F-3, "DUE column shows only the word Overdue, never the date"); the Details/evidence section
  states plainly "Estimated from a note dated X — not a confirmed commitment" / "not confirmed by
  any source" for non-explicit dates; `whyNowFor`'s deterministic Overdue/Now append respects the
  same gate.

**Live-tested on the QA task (`0656c6be-…`) via the real pipeline, not simulated:**
- Explicit: "Delayed to…" verb, past date → `due_provenance='explicit'`, badge showed
  **"Overdue · 09/01/26"** (full alarm treatment, correctly preserved).
- Derived: pasted "expects to send... by end of this week" → resolved to a concrete date,
  `due_provenance='derived'`, hedge language preserved in the proposal's summary → Approved via the
  real Inbox drawer → **live bug caught and fixed** (see above) → re-tested clean: task landed with
  `due_provenance='derived'`, correct `due_source_document_id`/`due_source_date`; Details showed
  **"Estimated from a note dated 09/11/26 — not a confirmed commitment."**
- Genuinely ambiguous range ("late next week or early the week after") → model correctly left `due`
  null rather than guessing, kept hedge language in the summary — stronger proof than a forced
  'derived' tag would have been.

**Greg/Rinconia acceptance case — CLOSED, DB + browser evidence:**
Rotem ran the audited classification SQL (guarded, `rows_updated=1`, `log_rows_inserted=1`,
`actor='rotmmeir22@gmail.com'`, `action='manual:date_provenance_classification'`). `tasks.due` is
untouched at `2026-09-08`. Live-verified in My Work + Details (`/work?view=all#task-33677f42-…`):
Due badge now shows **"Unconfirmed · 09/08/26"** (was "Overdue"); Details' EVIDENCE section adds
**"This date is not confirmed by any source. Treat as needing review, not as a commitment."**

**Known residual gap, not silently closed:** the SAME Details EVIDENCE section still also shows a
STALE AI-generated reasoning sentence from a prioritization run that predates this fix —
*"Greg committed to revise and respond by end of this week (human correction supersedes stale 9/8
due date)... Overdue"* — the exact fabrication Noa's F-2 flagged. The prompt that generates this
text (`agents/prioritize-tasks.ts`) IS already fixed (forbids "committed", forbids calling a
derived/unresolved date "Overdue", now reads a `due_provenance` tag per task) and is live — but the
stored `task_priorities.reason` text itself is cached from the last real prioritization run and only
regenerates the next time one runs. Running a full prioritization pass re-ranks all 136 tasks
system-wide — a bigger, separate action than "close this one record," and was intentionally NOT
triggered in this pass (belongs with the later "run one normal prioritization, verify reasons"
item). Until that next run, this ONE stale sentence remains visible on this record specifically.

### Item 1 — Agent Review Inbox: read-only audit + safe fixes shipped

**Audit findings (read-only, before any change):**
- 100 pending at session start; header badge matched exactly.
- By type: task_create 44, relationship_create 24, blocker_create 22, deadline_update 6,
  task_update 3, task_done 1.
- Confidence is a near-constant per type/reasoning-family, not a real per-item signal:
  blocker_create always 0.70, relationship_create always 0.50, deadline_update always 0.60 (all
  hardcoded in `routeExtractResult`) — task_create splits 37×0.50 / 7×0.40 by reasoning family.
- **Zero exact-duplicate identity groups** among pending items (checked task_create titles and
  relationship_create from/to pairs per project — every one is textually unique). The existing
  ingest-time dedup (`filterDuplicateProposals`) is doing its job; there is no low-hanging duplicate
  cleanup available in the current backlog.
- Target status: 96 of 100 have no `target_task_id` at all (only task_update/task_done/deadline_update
  types carry one) — of the 4 that do, all 4 point at a still-`open` task. Zero point at a
  done/missing task.
- 2 of 100 were QA-project proposals (both created live during this session's own testing).
- Age: 58 created 2026-09-10, 42 created 2026-09-11 — all from the import-queue backlog drain
  (documents dated 2026-08-23 through 2026-09-04 being processed now), not new incoming mail.
  **Confirms the import batches are the real driver of the backlog's size**, not a broken dedup.
- `/api/cron/triage` exists in code but is **not** in `vercel.json`'s cron list — auto-triage only
  ever runs inline at ingest time (on the rows one document just produced) or via the manual
  "Auto-triage now" button. **No scheduled sweep exists at all.**
- **Structural finding:** almost the entire backlog (95-99 of ~100) can never be provably
  auto-ignored (no-op/target-closed checks only apply to task_update/task_done with a target) —
  the ONLY route out of "needs review" for a blocker/relationship/task_create/deadline_update claim
  is the LEARNED-THRESHOLD mechanism (≥5 prior human decisions in the exact same class, ≥85%
  agree/reject). This is by design (client handoff: "reduce to almost nothing — no guessing,
  learning only"), not a bug — but it means the backlog size is fundamentally a function of how much
  Noa has decided so far, not something a smarter dedup pass alone would shrink.

**Fixes shipped (commits `f6dec4d`, `9da98d5`), each typecheck/lint/test-clean before deploy:**
1. **QA excluded from the real Agent Review** — neither the My Work "Agent review inbox · N" badge
   nor `/inbox`'s own pending/history queries had ever excluded test-project proposals (same gap
   Notes Center had, fixed earlier this session). The existing 4-way split (Needs review / Not sure
   / Approved / Applied automatically — this UI element ALREADY EXISTED, contrary to first
   assumption) derives from the same filtered row set, so one fix corrects the badge, the list, and
   all 4 tab counts together.
2. **Live-caught regression in that same fix, fixed within the hour:** `.not('project_id','in',(…))`
   silently drops every row where `project_id IS NULL` too (SQL: `NULL NOT IN (...)` is neither true
   nor false) — the My Work badge read 79 instead of the real 99 immediately after deploying fix #1,
   because it silently hid the 20 real "no project evidence" proposals — exactly the ones most
   needing a human. Fixed with `.or('project_id.is.null,project_id.not.in.(...)')` in both call
   sites. Re-verified: badge now correct.
3. **Safe, genuine dry-run for "Auto-triage now"**, per explicit instruction not to sweep the real
   backlog this hour: `runAutoTriage`/`runFullTriage` gained a `dryRun` option (classifies exactly
   as a real run would; skips every write) plus a `previewAutoTriage()` action and a **"Preview (no
   changes)"** button next to the existing button in the Inbox UI. Also: the real sweep (dry or not)
   now excludes QA-project rows entirely, so it can never touch this session's own test proposals.
4. **Closed a 6th due-write gap found while wiring the dry-run**: auto-triage's own `task_create`
   insert (the learned-threshold auto-apply branch) never stamped `due_provenance` at all.
5. **`isSafeEnrichment`/learned-threshold auto-apply already gated against unconfirmed dates** (see
   item 0) — directly answers "never auto-approve a business deadline change" for the one path that
   actually could have done so silently.

**Separate, pre-existing bug found and flagged (not fixed — out of today's bounded scope):** the
exact same NULL-handling flaw exists in `lib/open-tasks.ts`'s `selectOpenTasksExcludingTest` (used
by prioritization, the daily digest, and extraction dedup context) — confirmed live via SQL that 40
real, open, non-test tasks currently have `project_id IS NULL` and are therefore silently invisible
to all three. Filed as a background task (`task_ae4422a2`) rather than fixed inline, since it's a
materially bigger, separate concern than "diagnose the Inbox."

**Dry-run live-verified in Production against the REAL backlog (zero risk, zero writes — the whole
point):** clicked the new "Preview (no changes)" button on `/inbox`. Toast: **"Preview of 99
pending: would apply 0, would ignore 0, 99 would stay for review — nothing was changed."** Badge
count confirmed unchanged (99 before, 99 after). This is direct, live, empirical proof of the audit
finding above — not a code-reading inference: with today's learned-class stats, literally nothing
in the real backlog qualifies for auto-apply or auto-ignore right now.

**What's left for Noa, and why it needs a human, not a bigger sweep:** with QA now excluded, the
real queue is **99 items** (58 created 9/10, 41 created 9/11 — one of the original 42 was the
`task_done` that's since resolved). None of them are duplicates, none target an already-closed or
vanished task, and virtually none qualify for a provable no-op — by the system's own "learning
only, no guessing" design, every one of them is waiting on either (a) Noa's own attribution for the
20 unattributed items, or (b) enough of her prior decisions in that exact claim-shape to teach the
learned-threshold mechanism. **Not run this pass, deliberately:** the real "Auto-triage now" sweep
itself (only the safe dry-run preview and QA-only exclusion were exercised) — running it for real
against the 99 real items is a decision for Rotem/Noa, not something to trigger unilaterally in a
diagnostic pass.

**Not yet reached this pass:** item 2 (QA regression pass on My Work — Add Action, field edits,
Done/Reopen, two-tab concurrent-edit conflict, Undo/Undo-of-undo) — pending remaining time in this
session.

Scoped task: implement explicit/derived/unresolved date provenance, source-document/date storage,
and consistent Details/My-Work-reasoning/Due-Overdue display, using the Greg/Rinconia record as the
acceptance case. Per Rotem's own instructions this session, two checks are required before writing
any code, and both stopped the task before implementation started — no application code, migration,
or business data was touched.

**Check 1 — no other deployment/tester active, two-tab My Work interactivity:** could not be
performed. This session's sandboxed Browser pane is not signed in to SiteKick (would need entering
credentials, which is prohibited), and `mcp__claude-in-chrome__*` (the tool used in every prior
session's live testing, against Rotem's own already-authenticated Chrome) reported **"Claude in
Chrome is not connected"** in this session. No live browser check of any kind was performed as a
result — this is a genuine access gap in this session, not a finding about the app.
**Next session needs:** either the Claude-in-Chrome extension connected and signed in, or Rotem to
run the two-tab hard-reload + "Add action" open/cancel check himself and report the result.

**Check 2 — is `0027_date_provenance.sql` applied:** **NOT applied.** Verified two ways:
- `select column_name, data_type from information_schema.columns where table_name='tasks' and column_name like 'due_%'` → **zero rows** (no `due_provenance`/`due_source_document_id`/`due_source_date` on `tasks`).
- `mcp__supabase__list_migrations` → tracked history stops at `0021`; `0027` was never sent to the DB (matches the prior handoff: prepared and sent to Rotem as a file, never run).

Per instruction, stopping here rather than guessing at a workaround. Guarded SQL (additive-only,
nullable, no backfill, no change to any existing read/write path) and the verification query to
confirm it landed:

```sql
alter table tasks add column if not exists due_provenance text
  check (due_provenance in ('explicit', 'derived', 'unresolved'));

alter table tasks add column if not exists due_source_document_id uuid
  references documents(id) on delete set null;

alter table tasks add column if not exists due_source_date date;

create index if not exists idx_tasks_due_source_document_id
  on tasks(due_source_document_id) where due_source_document_id is not null;
```

Verification query (run after, expect exactly 3 rows):
```sql
select column_name, data_type from information_schema.columns
where table_name = 'tasks' and column_name like 'due_%'
order by column_name;
```

**Read-only fact-finding done ahead of the blocker (no data changed), to save the next session a step —
the Greg/Rinconia acceptance-case record itself:**
- `tasks.id = 33677f42-d238-4348-a5bb-9b42839a98cb`, title "LADBS returned the soils report — Bob to
  review and resubmit an addendum", `source='next_steps:2650 Rinconia:2'`, `project_id=cbec1c85-c2d2-4ef8-824c-99b733023168`.
- Current stored state: `due='2026-09-08'`, `status='open'`, `last_touched='2026-09-11'`.
- Current stored `latest_note` (2026-09-04, verbatim): *"Greg Byrne of Grover-Hollingsworth confirmed
  on 26/8 he can have the addendum response ready late next week or early the week after."* — no
  occurrence of "committed" or "end of this week" anywhere in the stored note.
- **Implication for the next session:** the F-2 gap Noa found ("can have"/"expects" rendered as
  "committed", with an unanchored "end of this week") is confirmed to be a reasoning/evidence-display
  fabrication, not corrupted or overwritten stored data — `tasks.due`/`latest_note` themselves are
  intact and match the source. The fix belongs in whatever renders the prioritization "evidence
  block" text and the Due/Overdue badge, not in a data-repair step. This still needs the 0027 columns
  to express "this due date is derived/unresolved, do not phrase it as a commitment" structurally
  rather than via prompt wording alone.

**Exact next task, in order, once both gates are clear:**
1. Confirm the two-tab My Work interactivity check passes on the current build (Rotem or a
   connected Claude-in-Chrome session).
2. Rotem runs the guarded SQL above; re-run the verification query here to confirm 3 columns exist.
3. Implement: `extractComms` output → `due_provenance`/`due_source_document_id`/`due_source_date`
   write path; consistent display across task Details, My Work reasoning/evidence text, and the
   Due/Overdue badge; derived/unresolved dates never silently become `tasks.due`; "can have"/"expects"
   language never rendered as "committed". Acceptance case: reload the Greg/Rinconia record
   (`33677f42-…`) live and show its actual due date + provenance, with Overdue shown only if a
   confirmed (explicit) due date supports it.
4. Targeted tests → typecheck/lint → full suite → deploy → live browser verification → update this
   handoff with files/commit/deployment/evidence/rollback, same as every other item above.

No code, schema, or business data was changed in this session block.

## ✅ שוחזר ואומת — LLC task incident closed

Real task `afac2f3b-f4f2-4ca0-bb98-f60e82dcd72f` ("Set up LLC bank account and credit card") had a QA test note written to it by my automation mistake (see INCIDENT section below). Rotem ran the guarded revert (`guarded-revert-llc-task.sql`) at 2026-09-10 20:52:53 UTC. Verified two independent ways immediately after:
1. **DB**: `tasks.latest_note` is `null`, `last_touched` is `2026-09-07` (both match the pre-incident state exactly); `activity_log` now has the `manual:revert_qa_contamination` row with before/after JSON documenting the fix, actor `rotmmeir22@gmail.com`.
2. **Live browser** (`/work?view=all&task=afac2f3b-…`): the task card in My Work shows no note text at all (contrast with a neighboring card that legitimately displays a quoted note) — screenshot taken 2026-09-10, post-revert.

No further action needed on this task. It is safe to reference in links to Noa.

## Continuation pass (2026-09-10 late night → 2026-09-11) — Rotem's 6-item follow-up

Rotem's follow-up flagged a real gap in Parts 1–2's guards: the "check, then write" pattern used two separate DB round trips, leaving a gap where a write landing between them would still be silently overwritten. Fixed and re-verified below.

### Item 1 — Persistent undo + concurrency protection (LIVE-PASS, all 4 scenarios)

**Fix:** `applyCasGuard` (`lib/state-writer.ts`) folds the version guard into the UPDATE's own WHERE clause (compare-and-swap on `UNDO_RESTORE_KEYS`'s current values) instead of a separate check-then-write. Applied to `revertTaskHistoryEntry`, `updateTaskDetails`, **and** `undoWorkVerb` (the original toast-undo, which had no guard at all before this pass). Postgres evaluates the WHERE clause against whatever the row holds when the UPDATE executes — a write landing in the old gap now makes the UPDATE match zero rows (reported as a conflict) instead of being clobbered.

**Also fixed in the same pass:** a genuine Undo conflict was previously invisible — `SavedChip`'s branch never rendered `errorMsg` (task-editor.tsx, verb-menu.tsx), and `reopen-button.tsx`'s undo handler didn't even set an error state. `SavedChip` gained an `error` slot; all three callers now show it. And: `voidPriorityFeedback` (`lib/collect-priority-feedback.ts`) marks a reverted action's `priority_feedback` row `voided=true` (columns already existed, unused, from migration 0023 — no schema change needed) — an undone decision now cannot read as valid signal once learning starts consuming that table.

**Commit:** `db14a41`. Tests: 486/486 passing (+5 new for `applyCasGuard`'s null/non-null branching). Typecheck + lint clean.

**Live test log — QA task `0656c6be-…` only:**
1. **Normal undo**: History panel → Undo on newest "Edited details" entry (Changed: Owner) → owner correctly reverted, verified via SQL — **LIVE-PASS**.
2. **Undo-of-undo**: reopened History, the resulting "Undone" entry was itself the newest and independently revertible → clicked its Undo → owner correctly returned to the pre-first-undo value, verified via SQL — **LIVE-PASS**.
3. **Double-click**: fired two clicks on the same Undo button back-to-back (one `browser_batch`, no gap) → exactly one new `undo:history` activity_log row, not two — **LIVE-PASS**.
4. **Undo after a later update (conflict)**: same real two-tab race as Parts 1–2's original test, re-run against the new atomic implementation — tab A's History loaded (Undo ready on the newest entry); tab B (same task) added a note, creating a genuinely newer activity_log row; tab A's stale Undo click → **"Changed since — refresh to see the latest."**, and critically **no new activity_log row was created by the rejected click at all** (the old implementation would still have shown the conflict, but only after a slightly larger race window) — verified via SQL: tab B's write fully intact, zero corruption — **LIVE-PASS**.
5. **Undone decision excluded from learning**: applied "Waiting on…" (a `priority_feedback`-captured verb) via the SavedChip path → confirmed a `priority_feedback` row was created (`voided=false`) → clicked the chip's Undo → confirmed via SQL: `voided=true`, `retraction_kind='cancellation'`, `reverses_activity_log_id` correctly points at the new undo's activity_log row — **LIVE-PASS**. (Collection is live in production — `LEARNING_COLLECT=1` — confirmed via existing non-test rows; nothing reads `priority_feedback` for active ranking yet, so this is collection-side correctness, not yet an observable ranking change.)

### Item 2 — Draft staleness now also covers the target task itself (LIVE-PASS)

Rotem's exact ask: "if the target task or the proposal changed in the meantime, show the contradiction before approval." The original Part 3 staleness check (below) only compared the PROPOSAL's own state/targetTaskId/title — a draft pointed at task X would still restore silently even if X itself was renamed, closed, or merged elsewhere since the draft was saved.

**Fix:** `isDraftStale` (`lib/inbox-draft.ts`) now also compares the DRAFT's chosen target task's title at save time against its current title (looked up in `openTasks` at reopen time); a target no longer present in `openTasks` at all (closed/merged/deleted) reads as null, the same as "no target" — the strongest form of "this task changed." Commit `d199263`. Tests: 488/488 (+2 new). Typecheck + lint clean.

**Live test — real `not_sure` proposal `6a1781b4-…`, never decided:** in the drawer, picked "Sign up for PostScan Mail virtual mailbox" from Attach-to-task (a draft-only choice, never submitted) → confirmed via `localStorage` the draft's snapshot captured `targetTaskTitle: "Sign up for PostScan Mail virtual mailbox"` → **directly edited that saved value in localStorage via JS** to simulate the target task having been renamed elsewhere → closed and reopened: stale banner shown, "Attach to task" correctly reverted to "— none" (the row's real, untouched state) instead of restoring the draft's stale target choice — **LIVE-PASS**. Verified via SQL after: `agent_proposals.target_task_id` still `null`, `state='not_sure'`, `decided_by` still Noa's original — zero business data touched.

### Item 3 — Continuous import queue: real numbers, batch processing, resume, controlled retry (LIVE-PASS)

**Verified real numbers first, per Rotem's instruction not to trust the historical figure:** the "133 waiting" quoted earlier tonight was stale. Live SQL at the start of this item: **366 stored, 165 processed, 201 waiting.** Root cause confirmed by reading `app/api/upload/route.ts`: every upload has always hard-capped processing at `PROCESS_CAP = 10` documents, leaving the rest stored with `processed_at = null` forever — nothing ever revisited them.

**Built:** `lib/import-queue.ts` — `processImportBatch` processes a bounded batch of waiting documents (oldest first) through the *existing* `processDocument` (no new extraction logic, no re-upload, no re-insert — `documents.id` count never changes). Resumable by construction: "waiting" is just `processed_at is null`, so the next run picks up wherever the last one stopped, no separate progress table. Retries are controlled via `activity_log` (`action='ingest:failed'`) rather than a new `documents` column — no migration needed; a document past `MAX_ATTEMPTS` (3) stops being auto-retried but stays visible via a separate `failed` count, never silently dropped. Two ways to run a batch: a cron (`app/api/cron/process-import-queue`, added to `vercel.json` at a conservative once-daily schedule — kept conservative since this account's cron-frequency limits aren't known here, and breaking the two already-working crons was a worse risk than a slow automatic backstop) and a manual "Process next batch" button on `/upload` (`components/upload/import-queue-panel.tsx`), which is the primary, live-verifiable path below. `/upload` now also shows real stored/processed/waiting/failed counts instead of a fixed 8-row list with no aggregates.

**Commit:** `fbdf241`. Tests: 497/497 (+9 new for the pure batch-selection/retry-counting logic — `countFailuresByDocument`, `selectPermanentlyFailed`, `selectBatch`). Typecheck + lint clean.

**Live test — real production backlog (this is what the feature is FOR; it never touches a real task directly, see below):**
1. `/upload` loaded with **Stored 366 / Processed 165 / Waiting 201 / Failed 0** — matches SQL exactly — **LIVE-PASS**.
2. Clicked **Process next batch** → button showed "Processing…" and disabled itself → ~2 minutes later (15 documents, one LLM extraction pass each, run serially): **"15 processed, 0 failed this batch. More still waiting — run again to continue."** Panel updated to **Processed 180 / Waiting 186 / Failed 0** — **LIVE-PASS**.
3. Verified via SQL immediately after: `documents` — `total` still 366 (no re-insert/duplication), `processed` 165→180 (exactly +15), `waiting` 201→186 (exactly −15); `activity_log` — zero new `ingest:failed` rows (matches "0 failed") — **LIVE-PASS**.
4. Confirmed the batch's actual output landed in the review queue, not on any real task: 46 new `agent_proposals` rows created in the same window, all `state='pending'` — the human-approval gate is untouched; "ingestion is not automatic approval of a business change" holds — **LIVE-PASS**.

**Rotem caught a real gap right after step 4 above:** my "no duplicates" claim only checked `documents.id` count stayed at 366 — that proves nothing was re-inserted, but says nothing about a single document being *processed twice*, and the batch had zero protection against two overlapping runs (manual + cron, or two manual clicks) racing to select the same unprocessed document — the same class of check-then-write gap Part 1 fixed for task undo, reintroduced here in new code.

**Fix (commit `7f8af99`):** each document is now claimed with one atomic `UPDATE documents SET processed_at=now() WHERE id=$1 AND processed_at IS NULL` before processing — only the first concurrent caller gets a non-null row back; every other caller skips the document without processing it. A failed attempt releases the claim (`processed_at` back to `null`) so it stays retryable.

**Live test — two intentionally overlapping runs, per-document verification (not just aggregate counts):**
1. Captured the exact 35 oldest-waiting document ids via SQL before the test (the full candidate pool both runs would compete over).
2. Opened two browser tabs on `/upload`, clicked **Process next batch** in both within the same batch of tool calls (minimal gap, genuine overlap — both requests run concurrently for ~2 minutes each).
3. **Direct per-document proof**: of the 35 pre-captured candidate ids, querying afterward showed exactly **15 now processed, 20 still waiting** — precisely one batch's worth, not two. If the claim hadn't worked, both runs would have raced through the same 15-document SELECT and this would show up to 35 processed (or duplicated proposals on the same 15).
4. Checked `agent_proposals` grouped by `document_id` for those 15: counts ranged 1–5 per document (11 of the 15 produced at least one), consistent with normal single-pass extraction — no doubled/paired counts that would indicate the same email got extracted twice — **LIVE-PASS**.
5. **Failure-counter semantics** ("first or second attempt stays Waiting, only the third becomes Failed"): confirmed correct by construction (`selectPermanentlyFailed`'s unit test) AND then confirmed **LIVE**, for real, without forcing anything — one real document in the backlog (`2a37479a-…`) failed extraction naturally on its own during normal batch runs: after its 1st failure the panel correctly showed Failed 0 (its 2nd batch attempt then found a real UI bug, see next point); after being re-attempted and failing a 2nd time (`count(*) from activity_log where action='ingest:failed' group by entity_id` → 2), the panel again correctly showed **Failed 0** (2 < MAX_ATTEMPTS 3, still Waiting) — **LIVE-PASS**.

**Second real bug, caught live and fixed in the same pass:** right after that document's 1st failure, the panel showed "Failed 1" — but a fresh page reload showed "Failed 0" (the correct value). The client's optimistic update after a batch conflated "attempts that failed THIS batch" (`res.failed`) with "documents that stopped being retried" (`stats.failed`, requiring `MAX_ATTEMPTS`) — two different counts sharing a field name. **Fix (commit `61992e9`):** the panel now refetches the real, server-computed stats (`fetchImportQueueStats`) after every batch instead of approximating the split client-side. Re-verified live on the SAME document's 2nd failure above — correct both times now.

**Also fixed in the same pass:** a live batch took 6+ minutes for one 15-document run (an invoice_pdf's storage download, or just a slow model response, can stretch past the platform's default Server Action timeout, which is inherited from the PAGE, not the action file, and had never been raised). Added `export const maxDuration = 300` to `/upload`'s page — without it, a slow batch risked being killed mid-document, leaving that one document claimed (`processed_at` set) but never actually processed or released for retry.

**Known gap, documented not silently skipped:** the cron's schedule (once daily) hasn't been live-verified as actually firing — Vercel's cron execution isn't something this session can trigger on demand or observe outside a real scheduled tick, and the account's plan-tier cron limits are unknown, which is exactly why the schedule was kept conservative rather than guessed at aggressively. The manual button above is the proven, immediately-usable path to keep draining the remaining backlog (366 stored / 223 processed / 143 waiting / 0 failed as of this line — down from 201 waiting at the start of this item).

### Item 4 — Date provenance (PARTIAL — deterministic resolution done, storage/UI blocked on migration)

**What "end of week isn't a new date each run, and a forecast isn't a commitment" required:** confirmed by reading `agents/extract-comms.ts` that no reference date was ever given to the model at all — nothing anchored a relative phrase to anything, so the SAME communication re-extracted (now genuinely possible via the item-3 retry batch) could resolve "end of week" to a different concrete date depending on when extraction happened to run.

**Built (commit `0760339`), no migration needed:** `extractComms` now receives the document's own `received_at` and passes it as `REFERENCE_DATE` in the prompt, with an explicit instruction to resolve relative phrases against it — never against the real current date — so the same document always resolves the same way. The prompt also now explicitly distinguishes EXPLICIT (stated outright) from DERIVED (inferred from relative language) dates, and instructs the model never to write a derived estimate into a task's own `due` as if it were a commitment. `lib/date.ts` gained `laDate()` (an arbitrary-instant analogue of the existing `laToday()`) to compute the anchor; threaded through `processDocument`/`processImportBatch` specifically — the one path where the same content can genuinely be re-processed days later. Tests: 500/500 (+6 new for `laDate`). Typecheck + lint clean.

**Already true, confirmed by reading the code (not new work):** "business contradiction goes to clarification, never auto-change Due automatically from a note interpretation" already holds structurally — `routeExtractResult` (`lib/proposals.ts`) always pushes a `deadline_update` as an `agent_proposals` row; nothing in the ingest pipeline writes `tasks.due` directly. A changed due date only ever reaches a real task through the SAME human-approval Apply flow every other proposal type goes through.

**Not implemented — genuinely blocked on schema, not silently skipped:** persisting the explicit/derived/unresolved classification itself, a source document + source date per task, and surfacing that consistently across the note/Due/Overdue badge/prioritization reasoning/view splits Rotem asked to test — none of this has anywhere to live without new columns. Prepared and sent as a file: `0027_date_provenance.sql` — three additive, nullable columns on `tasks` (`due_provenance`, `due_source_document_id`, `due_source_date`), no backfill, no change to any existing read/write path until application code is written against them. **NOT run** — this is a genuine blocker for the rest of item 4, not a task left for later without saying so.

### Item 5 — Confirmatory regression pass on final production (LIVE-PASS)

Re-ran the core Edit-details path on the CURRENT deployed version (after every fix above) rather than trusting earlier-session results: QA task, Edit details → renamed title → changed Phase from Plan Check to Financing (Sub-stage correctly cleared to "—", confirming the stale-substage-clear fix still holds) → picked "Loan application" → Save → **full page reload** → reopened → card showed the new title and "Financing / Loan application" — verified via SQL immediately after: `title`, `substage_template_id`, `category` all matched exactly what was set — **LIVE-PASS**.

### Item 6 — Association tested on two SEPARATE paths, per Rotem's explicit requirement

**Inbox review queue path — full cycle, LIVE-PASS, using a genuinely QA-scoped proposal (not a real one):** used the paste-update intake (`/upload` → "Paste an update instead"), naming the QA project by its exact name so attribution resolved correctly — this creates a REAL `agent_proposals` row, safely isolated, that's actually safe to Approve/Undo end-to-end (unlike a real proposal, which was never touched all night).
1. Pasted "QA — SiteKick internal testing: Claude QA confirmed the regression pass is complete and will follow up with the vendor by end of week." → dedup correctly found **"Match found (50%)" against the QA task** — confirms target-task matching (source: title similarity).
2. Opened the review drawer: SOURCE SAYS showed the exact pasted text (evidence), treatment preselected to "Existing task is completed", Attach-to-task preselected to the matched QA task with "This update will be applied to the task above — no duplicate is created."
3. **Preview shown before Apply** (Rotem's explicit ask): "APPLYING UPDATES 'QA TEST TASK — REGRESSION PASS VERIFIED': Owner → Claude QA / Due → 2026-10-01 / Note added / Marked done."
4. Clicked Apply → "Task updated from the suggestion." Verified via SQL: `tasks.status='done'` (exactly the previewed change) — **LIVE-PASS**.
5. **The human choice is saved WITH the corrected proposal**, confirmed via SQL: `agent_proposals.state='accepted'`, `change_type='complete_existing'`, `target_task_id` correctly set, `result_note` preserved, `decided_by='rotmmeir22@gmail.com'` — this row is now exactly what `loadMatchDecisions` (`lib/feedback-context.ts`) reads for future association learning, gated by the SAME test-exclusion (`loadTestTaskIds`) verified earlier this session — a QA decision like this one is real, auditable data, but structurally excluded from influencing real recommendations.

**Notes Center path — NOT TESTED this pass, for a real reason, not an oversight:** search/candidate-ranking were already verified live in the earlier part of this session (see Part 3's underlying `notes-center.ts` history). The WRITE cycle specifically (change association, correct interpretation, save, reopen, undo) was not exercised tonight because of a genuine conflict between two of Rotem's own rules: test-isolation correctly EXCLUDES every QA note from Notes Center by design (verified earlier — a QA note there would be a real bug, not a feature), so there is no QA-safe note to test the write path against without touching a real one, which the "never change real records for testing" rule forbids. This needs either explicit authorization to use one specific, low-stakes real note, or a small design change to make a QA note visible there for testing purposes only. Flagged in the acceptance matrix (item 34) rather than silently skipped or falsely marked passing.

**Real bug found and fixed live in the same pass:** clicked "Restore to review" (undo the decision, from the Approved tab) — it silently did nothing; SQL confirmed the proposal's `state` stayed `accepted`. Root cause: `targetTaskError`'s "target task must still be open" validation (`app/actions/proposals.ts`) ran for EVERY decision type, including `'pending'` (Restore) — but restoring a proposal's own review state never writes to the task at all, only an actual approve does. The exact moment someone is most likely to click Restore (right after Applying, to undo a mistake) is exactly when the target task's status just changed to no longer be open, so the check always failed there. **Fix (commit `a98f4cf`):** scoped the validation to `decision === 'approved'` only. Redeployed, re-verified live: same click now correctly sets `state='pending'`, `decided_by=null`, `decided_at=null` — **LIVE-PASS**. (The task's own `status` correctly stays `'done'` — Restore resets the proposal's review state, not the already-applied task write; a full task-level undo is the separate toast Undo mechanism, tested extensively elsewhere in this handoff.) QA task reopened afterward for future reuse.

## Part 3 — Inbox review-drawer draft persistence + staleness detection (LIVE-PASS)

**Scope:** the Inbox review drawer's `open(row)` always re-seeded every field from the row — closing the drawer (even just switching to another item and back, no reload needed) silently discarded whatever was typed. Adds localStorage-backed draft persistence keyed per proposal, with a staleness guard so a draft is never silently applied if the underlying proposal moved on since (decided elsewhere, re-matched) — matching the guard pattern proven in Parts 1–2, extended to a case with no server-side signal at all (`agent_proposals` has no `updated_at` column).

**Code:** `lib/inbox-draft.ts` (pure — `draftKey`, `isDraftStale`, `parseDraft`; 11 unit tests), wired into `components/inbox/review-board.tsx` (debounced auto-save effect, `open()` restores-or-detects-staleness, `discardDraft()`, draft cleared on `decide()`/`bulkDecide()`).

**Commit deployed:** `9a5a732`.

**Tests:** 11 new unit tests (`lib/inbox-draft.test.ts`) covering staleness on each snapshot field independently, JSON round-trip, and rejecting malformed/foreign localStorage content (old app version, hand-edited, non-object). Full suite: 481/481 passing. Typecheck clean. Lint clean.

**Live test — real pending item, never decided, zero business data touched:**
1. Opened a real `not_sure` proposal ("Confirm Deemed Complete letter status for Gray hearing", id `6a1781b4-…`), appended a test marker to the Result field, confirmed via `localStorage` a draft was auto-saved (debounced) — **LIVE-PASS**.
2. Closed via the drawer's × (never clicked Approve/Reject/Ignore/Restore — no server write). Reopened the same item: banner **"Restored your unsaved notes from before — pick up where you left off."** shown; verified via `document.querySelector('textarea').value` that the exact edited text (including the test marker) came back — **LIVE-PASS**.
3. Clicked **Discard draft**: field reverted to the row's real original text, `localStorage` draft key removed — **LIVE-PASS**.
4. Re-typed a second test marker, let it auto-save, then **directly edited the saved draft's `snapshot.state` in localStorage via JS** (`'not_sure'` → `'accepted'`) to simulate the proposal having been decided elsewhere while the draft sat unsaved — a deliberate, client-side-only way to exercise the staleness path without writing to any real record. Closed and reopened: banner **"This item changed since your last visit, so your earlier notes weren't restored — showing the latest data instead."** shown; textarea held the row's real fresh text (no trace of the test marker); the stale draft was auto-removed from `localStorage` — **LIVE-PASS**.
5. Verified via SQL after all of the above: `agent_proposals.state='not_sure'`, `decided_by='noa.m@hillagroup.com'`, `result_note` exactly matches Noa's original 2026-09-06 text — this real item was never touched by any of the testing above.

## Part 2 — Concurrent-update protection on Edit details Save (LIVE-PASS)

**Scope:** extends Part 1's already-proven guard mechanism (`getLatestActivityLogId` as a version token) to the Edit details Save path — the update Rotem specifically asked to also be covered, not just Undo. An "old" Save (form opened, someone/something else changed the task since, then this stale form is submitted) now conflicts instead of silently overwriting.

**Code:** `app/actions/tasks.ts` — `getTaskVersion(taskId)` (tiny read, the version token) and `updateTaskDetails` extended with a required `baseVersion` param, checked against the task's current version immediately before writing. `components/work/task-editor.tsx` — fetches `getTaskVersion` on mount (parallel with the user filling the form, not gating it), awaits it only when Save actually fires, and shows a distinct conflict message (`work.error_conflict`) instead of the generic save-error text.

**Commit deployed:** `107df75`.

**Tests:** full suite still 470/470, typecheck clean, lint clean. (The guard itself is a one-line `!==` comparison on two already-tested values — getLatestActivityLogId has no independent logic to unit-test beyond what Part 1 already covers; correctness here rests on the live concurrency test below, the same way Part 1's history-undo guard was proven.)

**Live test log (QA task `0656c6be-…` only), two real browser tabs, no data faked:**
1. Tab A: opened Edit details (captures baseVersion on mount).
2. Tab B (same task): used "Add note" to write a genuinely concurrent activity_log entry, succeeded normally.
3. Tab A (still on the now-stale form): edited Owner to "Claude QA (stale edit)", clicked Save.
4. **Result: "This task changed since you opened it — refresh to see the latest before saving."** shown inline; drawer stayed open; the typed edit was NOT lost from the input (visible on screen, matching every other save-failure path tested tonight) — **LIVE-PASS**.
5. Verified via SQL immediately after: `owner` still `"Claude QA"` (tab A's stale write never landed), `latest_note` still tab B's `"QA note v4: Edit-details concurrency guard test"` — zero data loss, and no phantom `edit:details` activity_log row was created by the rejected attempt — **LIVE-PASS**.
6. **Happy path, same session:** fresh reload → fresh Edit details open (fresh baseVersion, nothing concurrent this time) → edited Owner → Save → "Update recorded · Details updated." — normal saves are unaffected by the guard, no false positives — **LIVE-PASS**.

## Part 1 — Persistent Undo from history (LIVE-PASS)

**Scope:** the toast-based Undo only survives while its SavedChip stays mounted — once closed, or the page reloads, the undoId is gone and the action is permanently unrecoverable. This adds a "History" panel inside Edit details (task-editor.tsx) that lists the task's real activity_log trail and keeps Undo reachable on the single newest entry, guarded against clobbering a newer change.

**Code:** `lib/task-history.ts` (pure entry-shaping, unit-tested), `lib/state-writer.ts` (`getLatestActivityLogId` — the concurrency guard), `app/actions/tasks.ts` (`getTaskHistory`, `revertTaskHistoryEntry`), `components/work/task-history.tsx` (UI), wired into `components/work/task-editor.tsx`.

**Commits deployed:** `adeee66` (feature), `0da00b1` (live-caught fix — see below).

**Tests:** 7 new unit tests (`lib/task-history.test.ts`) — canUndo is positional (only index 0), a create-shaped entry with no before_json isn't undoable, last_touched never counts as a changed field, and the live-caught partial-after_json bug below has a regression test. Full suite: 470/470 passing. Typecheck clean. Lint clean.

**Live-caught bug, fixed same session:** first deploy showed "Changed: id, Due, admin, Owner, Task name, source, Status, is_test, planned, Category, priority, created_at, Project, Note, Waiting on, Impact on process, Sub-stage" for a plain Reopen — 17 fields, because before_json is a full-row snapshot but after_json for most task actions is a small patch naming only the touched fields; reusing invoices' `diffChangedKeys` (which assumes both sides are full rows) treated every populated-but-untouched column as "changed." Fixed with a task-specific `taskChangedKeys` that only reports keys after_json itself names. Redeployed (`0da00b1`), re-verified live: same Reopen now correctly shows "Changed: Status" only.

**Live test log (QA task `0656c6be-c2a2-4090-a85d-a447a7a77550` only):**
1. Opened Edit details → History panel → loaded real entries (Reopened, Completed, Add note, ...) with correct actor/timestamp/changed-fields, only the newest entry showing an Undo button — **LIVE-PASS**.
2. Clicked Undo on the newest entry ("Reopened") → drawer closed, no error. Verified via SQL: `status` reverted from `open` back to `done` (undoing exactly that action), owner/project/substage/latest_note all correctly preserved (untouched by this action) — **LIVE-PASS**.
3. Undo-of-undo (chain revert): reopened again via the Completed view's Reopen button, reopened History — the earlier `undo:history` entry correctly showed action label "Undone", and was itself revertible (it carries a real live-row snapshot, not a placeholder) — **LIVE-PASS**.
4. **Concurrency conflict guard — real two-tab race, not simulated:** opened History in tab A (top entry: "Reopened", Undo visible). Without refreshing tab A, switched to tab B on the same task and used "Add note" to write a genuinely concurrent activity_log entry. Switched back to tab A and clicked its now-stale Undo button. Result: **"Changed since — refresh to see the latest."** shown inline, drawer stayed open, no error toast, no false success. Verified via SQL immediately after: `status='open'`, `latest_note='QA note v3: concurrent-edit conflict guard test'` — tab B's write was fully preserved, zero data loss from tab A's stale click — **LIVE-PASS**.

**Known scope limits (acceptable, not blocking):** the changed-field label map covers the fields exercised by Edit details/verb actions/reopen/undo; `pin`/`snooze` actions' after_json keys (`manualPriority`/`until`) don't match DB column names 1:1 and would show their raw key names if ever displayed here — neither action is reachable from this panel today, so this is a latent cosmetic gap, not a live-visible one. History is capped at the 10 most recent entries per task (mirrors the existing invoice history panel's own cap).

**Last updated:** 2026-09-10, ~23:35 UTC (America/Los_Angeles ≈ 16:35 — LA is the app's reference timezone; times below are UTC unless noted)
**Site:** https://sitekick-ecru.vercel.app (production alias)
**Production version at start of this pass:** `e9ab420`
**Production version at end of this pass:** `158c142` (READY, verified)
**Tester:** Claude, driving Rotem's authenticated browser session (never touched his password/credentials)

## Test isolation state

- Migration `0026_test_isolation_and_notes_status.sql`: **applied, all 4 columns present** (`tasks.is_test`, `projects.is_test`, `comments.is_test`, `comments.status`), verified via `information_schema.columns`.
- QA project created (Rotem, via the minimal insert SQL):
  - id `1d3f44cd-047b-4a77-9255-73be26f07fdc`
  - name `🧪 QA — SiteKick internal testing (not a real property)`
  - `active=false`, `is_test=true`
- Isolation design: a task under this project is excluded from `selectOpenTasksExcludingTest` (prioritization, digest, extractor context) via the project cascade — **the task itself does not need `is_test=true`**; confirmed live (see below). The project stays invisible on every `active`-gated screen (Overview, Weekly Review, Notes Center project list, notes-assistant widget, Project Process list) — only Add Action's project selector was scoped to also offer it (commit `e9ab420`).
- Rollback for all test data: delete the QA project's tasks/comments and the project row itself (all traceable by `project_id = 1d3f44cd-…` or `is_test=true`). Nothing else needs reverting — no business record was touched.

## Test log

Legend: **LIVE-PASS** (verified in the browser, production) / **CODE-ONLY** (verified by reading code/tests, not clicked live) / **FAIL** / **NOT IMPLEMENTED** / **NOT TESTED**.

### T1 — Create a task via Add Action under the QA project
- Screen/action: My Work → **+ Add action** → title "QA test task — save/edit/undo verification", project = QA (offered correctly despite `active=false` — confirms `e9ab420`'s fix), owner "Claude QA" → Save.
- Record: task `0656c6be-c2a2-4090-a85d-a447a7a77550`.
- Expected: task created under the QA project, visible in My Work.
- Actual: **LIVE-PASS**. Verified via SQL: `project_id=1d3f44cd-…`, `is_test=false` (correctly inherits isolation from the PROJECT, not its own flag — the cascade design working as intended, no per-task action needed). Verified in browser: card renders under its own "🧪 QA — SiteKick internal testing" section in My Work → All view, title/owner correct.
- Evidence: task id above; screenshot of the card in My Work.

### T2 — Edit every field via Edit details, save, hard reload, reopen
- Steps: title, owner, waiting_for, due, Phase→Financing→Sub-stage(Loan application)→**Phase→Plan Check (testing the stale-substage-clear fix)**→Sub-stage(Soils review/addendum), Impact=Verify, Category=Administrative → Save.
- **LIVE-PASS, verified two ways:**
  1. Direct SQL read after save matched every field exactly (title, owner, waiting_for, due=2026-10-01, substage_template_id=Soils review/addendum's real id, process_impact=verify, category=admin).
  2. Full page navigation (`/work?view=all&task=<id>`, a fresh load, not a soft nav) → task card shows all edited values correctly: renamed title, ADMINISTRATIVE tag, "Plan Check / Soils review / addendum", owner, waiting-on, due 10/01/26.
- **Stale sub-stage fix (item #11) confirmed live**: after switching Phase from Financing→Plan Check, "Loan application" was gone from the Sub-stage list and the field had cleared to "—" — read the live DOM before/after, not inferred.

### ⚠️ INCIDENT — my own interaction error wrote test text to a REAL task
- What happened: after saving T2, the row list revalidated and reflowed (rows shift position after any write — expected app behavior). I then clicked "Add note" on the QA task's row using a **stale coordinate** from before the reflow, which actually landed on a different row: **"Set up LLC bank account and credit card"** (`afac2f3b-f4f2-4ca0-bb98-f60e82dcd72f`, tracker:OT-37, a REAL business task, `is_test=false`). Its `latest_note` was set to my QA test text; `last_touched` was bumped.
- This was **my automation mistake** (coordinate reuse after a layout shift), not an app bug — no app defect is implicated.
- **Caught immediately** via direct SQL confirmation before assuming success from the UI alone (`select ... where latest_note ilike '%QA note%'`).
- Revert: **superseded** — the original `revert-real-task-contamination.sql` was never run. Replaced with a guarded version, `guarded-revert-llc-task.sql`, which only wrote if `latest_note`/`last_touched` still held exactly the contaminated values (protects against clobbering any real edit made since), restored `latest_note=null`/`last_touched='2026-09-07'` (the exact before-state from `activity_log`'s own `before_json`, action `verb:note`, 2026-09-10 20:15:21 UTC), and logged a `manual:revert_qa_contamination` activity_log entry. **Status: RUN by Rotem 2026-09-10 20:52:53 UTC, verified via DB + live browser — see "✅ שוחזר ואומת" at the top of this file.**
- Process fix applied for the rest of this session: every click from here on is anchored by `find()` / a fresh `read_page` ref taken AFTER the most recent save, never a coordinate carried over from before one — coordinates go stale the instant a list re-renders.

### T3 — Add note (My Work verb) on the correct task, after the incident above
- Redone carefully: every click re-anchored via a fresh screenshot/find() immediately before clicking, never a coordinate from a prior step.
- **LIVE-PASS**: `tasks.latest_note = "QA note v2: confirmed on correct row before submit."` on the QA task id, verified by direct SQL immediately after.

### T4 — Notes assistant widget → linked note → REAL BUG found and fixed live
- Opened the widget, selected link type "My Work" (task), picked the QA task by its listed option (`0656c6be-…`), wrote "Generally I check QA test items every time before pushing." (deliberately phrased with a preference cue), Send.
- **LIVE-PASS on the write itself**: `comments` row created, `entity_type=task`, `entity_id`=QA task, `suggested_intent=preference`, `intent=preference` — correct classification, correct association.
- **REAL BUG found live, fixed, deployed** (`158c142`): the Notes Center page's own queries (`app/(dash)/(standard)/notes-center/page.tsx`) had NO test-data exclusion — this note would have shown mixed into Noa's real note list with no distinction. Fixed: tasks query switched to `selectOpenTasksExcludingTest`; `commentsForMerge` now drops a comment if `is_test`, or linked to an excluded task, or linked to a project outside the active list. 463 tests still pass, typecheck+eslint clean, deployed. **Re-verification after deploy: pending** (next step).
- Noted, not fixed (lower priority, doesn't currently manifest): the header/My-Work "Notes Center" badge counts still derive from an unfiltered task list for their own "needs review" count — only matters if a test note's text happens to match the historical-attribution pattern, which this one didn't.

### T5 — Status change: Completed → reflection → Reopen
- Update → **Completed** showed a confirm guard ("Mark completed? Press again") — clicked again to confirm.
- **LIVE-PASS**: `status='done'` verified by SQL. My Work "Completed" counter went 73→74 (live-observed, exact +1). Task appeared at the top of the Completed view with a DONE badge, correct project/date/owner.
- Clicked **Reopen** from the Completed view. **LIVE-PASS**: `status='open'` verified by SQL immediately after.
- This also positively answers part of item #08 (double-click protection): at least the Completed verb has a real "press again" confirm step, not a bare fire-on-first-click.

### T6 — Reflection in Project Process
- Navigated to the QA project's own detail page (`/projects/1d3f44cd-…`) directly — renders correctly (the existing "always show the task's own current project even if inactive" mechanism naturally makes a test project's own page reachable — a usable "explicit view for the tester" with zero extra UI built).
- The Plan Check phase view didn't show the task under its default-selected sub-stage (Submission/intake screening — the task is on a different one, Soils review/addendum) — used the same `?substage=<id>` deep link Project Process's own "View register" button generates (confirmed the exact id via the sub-stage picker on the page) → **LIVE-PASS**: task appears, confirming the same cross-reference mechanism a real "View register" click would use.

### T7 — Save failure: empty task name
- Edit details → cleared Task name → **Save** → **LIVE-PASS**: red inline error "Task name can't be empty", drawer stayed open, input preserved for correction, no success toast. Verified via SQL: title unchanged in the DB — no partial/fake write.
- (First two clear attempts — triple-click+Delete, then Cmd+A+Backspace — didn't actually clear the field; a browser-automation quirk with this input, not an app bug. Confirmed by replacing the selection via typing a single space instead, which DID clear it and correctly triggered the empty-title rejection.)
- Title restored to the correct value afterward and saved cleanly; verified via SQL.

## What's NOT implemented (explicitly, per Rotem's own rule — a capability that wasn't built stays marked missing, not silently attempted under time pressure)

- ~~Persistent undo in history~~ — **DONE, see Part 1 above.**
- ~~Concurrent-edit / stale-target conflict detection~~ — **DONE for tasks (Edit details Save + persistent Undo), see Part 2 above.** Not extended to the Inbox review-queue's Apply/proposal-decision writes, or to invoices — out of scope for tonight's ordered list.
- ~~Draft persistence across the Inbox review drawer's close/reopen~~ — **DONE, see Part 3 above.**
- **Continuous import processing queue** — 149 documents stored, 16 processed, 133 waiting, confirmed live earlier tonight; no resumable batch worker exists. Not started.
- **Explicit date-provenance categories** (explicit/derived/unresolved). Not started.

Parts 1–3 were built, tested, and live-verified this pass (see above). Parts 4–5 were judged too large to responsibly ship, test, and verify live within this session's remaining scope (a resumable background queue, and a new classification dimension threaded through ingest+display) — the user's own instruction explicitly permits leaving an unbuilt capability marked as missing rather than attempting a rushed, undertested version of it.

(Log continues below as each subsequent test runs — this file is updated incrementally, not only at the end, so state survives an interruption.)

## Status of the 32-item acceptance matrix

See `/Users/rotemmeir/Documents/Codex/2026-09-07/referenced-chatgpt-conversation-this-is-an/output/pdf/noa-fixes-test-results.csv` for the full, current per-item table (updated throughout tonight). This file records the LIVE browser evidence behind whichever rows move from "לא אומת" to "עבר" during this pass.

## Final state of test records

- QA project `1d3f44cd-047b-4a77-9255-73be26f07fdc` — kept, `active=false, is_test=true`, safe to keep reusing for future sessions rather than creating a second one.
- QA task `0656c6be-c2a2-4090-a85d-a447a7a77550` — status `open`, title restored to "QA test task — RENAMED via Edit details", carries a real comment (preference) and a `latest_note` — all clearly test data, isolated by the project cascade.
- **Incident, RESOLVED**: a coordinate-click automation error (mine, not an app bug) wrote test text to a REAL task ("Set up LLC bank account and credit card", `afac2f3b-f4f2-4ca0-bb98-f60e82dcd72f`). Caught immediately via direct SQL verification. Guarded revert run by Rotem 2026-09-10 20:52:53 UTC, confirmed via SQL and live browser. See "✅ שוחזר ואומת" at the top of this file for full evidence.
- Rollback for all of tonight's test data: delete the QA task, delete the QA comment(s) tied to it, delete the QA project row. Nothing else needs touching — no other business record was affected once the incident above is reverted.

## Rollback path for tonight's CODE changes

`git revert <sha>` or redeploy an earlier commit via Vercel — used successfully multiple times tonight already (e.g. the brown-logo revert earlier in this project's history, and simply superseding a commit with a corrected one, as with `f042497`→`373c080` for the feedback-isolation fix). `FEEDBACK_USE=off` in Vercel's env vars is the documented, NOT live-tested, business-logic kill switch — it requires a redeploy to take effect in already-running functions, per Vercel's own documented behavior; this was never verified live tonight.

## Instructions for the next Claude, if this session stops mid-way

1. Read this file top to bottom — the Test log section is the source of truth for what's actually been clicked live vs. only code-verified.
2. Check `git log --oneline -20` in `/Users/rotemmeir/Documents/sitekick` for any fix committed after this file's "Last updated" line that isn't yet reflected here.
3. The QA project/tasks above are safe to keep using — don't create a second one.
4. Continue the test log in place; don't restart from T1 if later entries exist below.
