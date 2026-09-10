# Live Functional QA — handoff (in progress)

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
