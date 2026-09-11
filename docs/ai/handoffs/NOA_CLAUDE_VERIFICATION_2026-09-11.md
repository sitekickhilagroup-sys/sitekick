# Verification script for Noa's Claude — Date provenance + Agent Review Inbox (2026-09-11)

**Read this whole file before touching anything. Do not trust the claims below — verify each one
live, in the browser, against Production. Where a step says "expected," that is what the previous
session reports finding; your job is to confirm or contradict it with fresh evidence.**

## Rules

- No writes to real business records. If a step needs a write, use the existing QA project/tasks
  only (`🧪 QA — SiteKick internal testing`, `active=false, is_test=true`) — do not create a new one.
- No direct SQL writes. Any write goes through the app's own UI/actions.
- If any check fails, stop, document exactly what you saw (screenshot/quote), and do not "fix
  forward" without asking — this script is for verification, not new development.
- Site: https://sitekick-ecru.vercel.app (Production). Confirm you're not sharing the site with
  another active tester/deploy before writing anything (ask, or check for very recent unexplained
  activity_log rows).

## Part A — Date provenance (functional core)

1. Open My Work (`/work?view=all`), find task **"LADBS returned the soils report — Bob to review
   and resubmit an addendum"** (2650 Rinconia project). This is the Greg/Rinconia acceptance case.
   - **Expected Due badge:** `Unconfirmed · 09/08/26` (muted styling, NOT the red "Overdue" chip).
   - Expand **Details**. **Expected EVIDENCE section:** the reasoning text should NOT contain the
     word "committed" (unhedged) or present the 9/8 date as confirmed fact. It should also contain
     a plain sentence stating the date is not confirmed by any source.
   - **If you see "committed" or "confirmed" used as a plain assertion (not negated, e.g. not "not
     confirmed") anywhere in that panel: this is a real regression. Screenshot it and stop.**

2. Pick 2-3 OTHER tasks with a Due date in My Work (any project). Confirm:
   - A task whose due date has always been "Overdue" the old way (no provenance classification yet)
     still shows the normal red "Overdue · <date>" badge — i.e. legacy behavior is unchanged for
     tasks nobody has touched with today's write paths yet.
   - The date is always shown next to the word ("Overdue · 9/08/26", not just "Overdue" alone).

3. On the QA project only: use "Update → Delayed to…" on a QA task to set a date in the past.
   **Expected:** badge shows `Overdue · <date>` (full alarm treatment) — a human-typed date is
   always treated as explicit/confirmed, this is correct, not a bug.

4. On the QA project only: use "Data inbox → Paste an update instead," naming the QA project by its
   exact name, with text like *"SiteKick internal testing QA update: the inspector expects to send
   the corrected report by end of this week."* Then open the Review Inbox, find the resulting
   proposal, and Apply it.
   - **Expected:** the target QA task's Due badge becomes an "Estimated"/muted style (not alarming),
     and Details' evidence explicitly says the date is estimated, not confirmed — even once that
     date is in the past.

## Part B — Agent Review Inbox

1. Open `/inbox`. Note the 4 tab counts (Needs review / Not sure / Approved / Applied
   automatically) and compare "Needs review" to the badge on My Work ("Agent review inbox · N") —
   **they must match exactly.**
2. Click **"Preview (no changes)"**. **Expected:** a toast like *"Preview of N pending: would apply
   0, would ignore 0, N would stay for review — nothing was changed"* — and the pending count must
   be IDENTICAL before and after (refresh and recheck the badge/tab count to confirm zero writes
   happened).
3. Confirm no row in the "Needs review" list shows the 🧪 QA project — QA proposals should be
   completely absent from this real list and its counts.
4. **Do not click "Auto-triage now" for real** without asking Rotem first — it's a genuine sweep
   over the whole real backlog, not a dry run.

## Part C — Quick regression pass on My Work (QA project only)

1. **Add Action** → fill all fields → Save → hard-reload the page → reopen the task. All fields
   must have survived exactly.
2. **Edit details**: change title, owner, due, Phase→a different phase→confirm Sub-stage clears to
   "—" and repopulates with the new phase's own list (not the old phase's options), Impact,
   Category → Save → hard-reload → confirm every field persisted.
3. **Completed → Reopen**: mark the task Completed (note the "press again to confirm" step), confirm
   it moves to the Completed view and the My Work counters update, then Reopen and confirm it moves
   back and counters revert.
4. **Persistent Undo**: open Edit details → History panel → the newest entry should have an Undo
   button; click it, confirm the field it changed reverts correctly.
5. **Two-tab conflict**: open Edit details on the SAME task in two browser tabs. In tab B, use "Add
   note" (a real concurrent write). In tab A (now stale), edit a field and Save.
   **Expected:** tab A shows *"This task changed since you opened it — refresh to see the latest
   before saving"* — the save must be REJECTED, not silently overwrite tab B's note. Verify tab B's
   note is intact afterward.

## Known gaps — NOT done today, do not report these as new findings

These were explicitly out of scope for today's session and remain exactly as documented in earlier
QA rounds (`LIVE_FUNCTIONAL_QA_HANDOFF.md`, Noa's own `NOA_LIVE_ACCEPTANCE_RESULTS.md`):

- Notes Center's write path (association, reinterpretation, save/undo) — still not tested end to
  end.
- Duplicate-matching safety (a QA record ever suggesting a merge into a real one, F-5) — not
  touched.
- Project Process consistency (sub-stage bank mismatch, "Not activated" vs. an open connected
  action, F-7) — not touched.
- Digest freshness / "days stuck" contradiction (F-8) — not touched.
- Deep link `?task=<uuid>` (F-10) — still doesn't work; the `#task-<uuid>` hash form does.
- Import queue draining, cron actually firing, `FEEDBACK_USE=off` kill-switch — not touched today.
- Undo-of-undo (chained revert) and the Workstream field — not exercised this session (the QA
  project has no workstream options configured, so that field can't be meaningfully tested against
  it without adding real config).
- Whether any human decision has yet measurably changed a future recommendation — not proven. See
  the separate learning-engine note below.

## If everything in Parts A–C passes

Tell Rotem plainly: "Date provenance and Agent Review Inbox verified independently — both hold."
If anything fails, quote the exact screen text/screenshot and stop there — do not attempt a fix in
the same pass as verification.
