# Live Functional QA — handoff (in progress)

## ✅ שוחזר ואומת — LLC task incident closed

Real task `afac2f3b-f4f2-4ca0-bb98-f60e82dcd72f` ("Set up LLC bank account and credit card") had a QA test note written to it by my automation mistake (see INCIDENT section below). Rotem ran the guarded revert (`guarded-revert-llc-task.sql`) at 2026-09-10 20:52:53 UTC. Verified two independent ways immediately after:
1. **DB**: `tasks.latest_note` is `null`, `last_touched` is `2026-09-07` (both match the pre-incident state exactly); `activity_log` now has the `manual:revert_qa_contamination` row with before/after JSON documenting the fix, actor `rotmmeir22@gmail.com`.
2. **Live browser** (`/work?view=all&task=afac2f3b-…`): the task card in My Work shows no note text at all (contrast with a neighboring card that legitimately displays a quoted note) — screenshot taken 2026-09-10, post-revert.

No further action needed on this task. It is safe to reference in links to Noa.

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

- **Persistent undo in history** (reachable after the save toast/chip disappears) — confirmed live tonight that the chip's Undo window is short-lived (missed it once myself while verifying via SQL in parallel). No history-based undo screen exists.
- **Concurrent-edit / stale-target conflict detection** — no version check exists; a later edit silently wins.
- **Draft persistence** across the Inbox review drawer's close/reopen.
- **Continuous import processing queue** — 149 documents stored, 16 processed, 133 waiting, confirmed live earlier tonight; no resumable batch worker exists.
- **Explicit date-provenance categories** (explicit/derived/unresolved).

These were NOT built in this session — building all four properly (each is a real, multi-step feature: a persistent-undo screen, an optimistic-concurrency check wired through every write path, draft auto-save + staleness detection, and a resumable background queue) was judged too large to responsibly ship, test, and verify live within this session's remaining scope, and the user's own instruction explicitly permits leaving an unbuilt capability marked as missing rather than attempting a rushed, undertested version of it.

(Log continues below as each subsequent test runs — this file is updated incrementally, not only at the end, so state survives an interruption.)

## Status of the 32-item acceptance matrix

See `/Users/rotemmeir/Documents/Codex/2026-09-07/referenced-chatgpt-conversation-this-is-an/output/pdf/noa-fixes-test-results.csv` for the full, current per-item table (updated throughout tonight). This file records the LIVE browser evidence behind whichever rows move from "לא אומת" to "עבר" during this pass.

## What's NOT implemented tonight (stays marked missing, not "not tested")

- Persistent undo in history (after the toast disappears)
- Concurrent-edit / stale-target conflict detection
- Draft persistence across drawer close/reopen (Inbox review)
- Continuous import processing queue (149 documents stored, 16 processed, 133 waiting — confirmed live earlier)
- Explicit date-provenance categories (explicit/derived/unresolved)

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
