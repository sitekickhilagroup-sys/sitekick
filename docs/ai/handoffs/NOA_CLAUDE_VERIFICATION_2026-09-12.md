# Verification script for Noa's Claude — tonight's session (2026-09-11/12)

**Read this whole file before touching anything. Do not trust the claims below — verify each one
live, in the browser, against Production. Where a step says "expected," that is what this session
reports finding; your job is to confirm or contradict it with fresh evidence.**

## Rules (unchanged from the last verification script)

- No writes to real business records. If a step needs a write, use the existing QA project/tasks
  only (`🧪 QA — SiteKick internal testing`, `is_test=true`) — do not create a new one.
- No direct SQL writes. Any write goes through the app's own UI/actions.
- If any check fails, stop, document exactly what you saw (screenshot/quote), and do not "fix
  forward" without asking — this script is for verification, not new development.
- Site: https://sitekick-ecru.vercel.app (Production). Confirm you're not sharing the site with
  another active tester/deploy before writing anything.
- Commit range covered: `715f727..d8361f7` on `main` — every commit in this file was pushed and
  independently confirmed `READY` via `gh api repos/sitekickhilagroup-sys/sitekick/commits/<sha>/status`
  before being reported as live, not assumed from a page reload.

## Part A — Milestone 1.5: the pin/unpin control (`715f727`)

**What it is:** the single highest-leverage missing piece the learning-model design
(`LEARNING_MODEL_IMPROVEMENT_DRAFT.md`) identified — `pinTask`/`snoozeTask` already existed
server-side and already logged correctly, but no UI ever called them, so Noa had no way to tell
the system "this should be ranked #1" explicitly. This closes that gap.

**Where it is — important, this is not where a first guess would look:** My Work → scroll past
"Most urgent across projects" (the numbered 01/02/03 list) → down to the per-project task tables
(3375 Blair Dr, San Marco, etc.) → each row's green **"Update"** button in the STATUS & UPDATE
column → the dropdown menu, below a divider after "Edit details…". **It does not appear in the
numbered "Most urgent" list above the project tables.**

**One control, two labels, not two buttons:** unpinned shows **"Move to top"**; after clicking it,
the same menu slot shows **"Unpin"** for that task. There is no separate "Pin" button.

1. Open a QA-project task's Update menu on `/work?view=all`. Confirm you see "Edit details…" then
   "Move to top" below a divider, after the seven verb items (Completed / Sent email / Waiting
   on… / Delayed to… / Scheduled for… / Not applicable / Add note).
2. Click "Move to top". Expected: a result chip reading "Moved to the top — this is now the
   strongest signal the ranking can learn from," with an Undo button.
3. Reopen the same task's Update menu. Expected: the item now reads "Unpin" in the same slot.
4. Click Undo (or "Unpin"). Expected: the chip clears / the menu reverts to "Move to top".
5. Read-only, live-verified already this session: pinning a QA task wrote one `priority_feedback`
   row with `event='reordered'` and the correct `proposed_global_rank`; unpinning did not add a
   second row (by design — see the commit's own note on this). If you want to re-check, query
   `priority_feedback` filtered to a QA task id and confirm the row shape, then confirm the task's
   `manual_priority` returned to `null` after unpinning — do not leave a QA task pinned.

**Separate document already sent to Noa herself, in Hebrew, simple language:**
`docs/ai/handoffs/NOA_LEARNING_PIN_GUIDE_2026-09-11.md` — use that one if you need wording to
explain this feature to her directly; this file is for your own verification, not for her.

## Part B — the six items from your own QA acceptance-run note

Your note (`comments` row `d67d7331-80d5-4013-9f54-d8414b519b79`, written via Notes Assistant,
intent `issue`) reported six problems. All six are now addressed. Verify each:

1. **"Overdue" rendered from an estimate, no date shown.** Could not be reproduced against current
   live data this session (the due-date-provenance work from earlier in the week appears to already
   cover it). The one code path that could render "Overdue" with literally no date —
   `components/work/work-row.tsx` — was found to have **zero imports anywhere in the app**: dead
   code, not something reachable through any live screen. If you can reproduce the original
   scenario (ideally note which task/screen), that would be a real, new finding — please do.
2. **Dedup ignoring project boundary** (`183e579`). Verify: create a QA-project task with a title
   similar to a real open task's. Expected: no "possible duplicate" suggestion crossing into real
   tasks.
3. **Digest served stale, no marker** (`825ac52`). Verify on `/digest`: if the latest digest's
   `for_date` is more than 1 day old, an amber badge should read "{n} days old — not today's
   digest" next to the date. (If the digest is current, you will not see this badge — that is
   correct, not a miss.)
4. **QA tasks visible/counted in real My Work** (`ad72ded`). Verify on `/work?view=all`: no QA-project
   task should appear in the list or count toward any of the 6 view-tab badges (Today/Blocking/
   Follow-ups/Waiting/All/Completed).
5. **Empty-name Save silently does nothing** (`fbf93ed`). Verify: open "+ Add action", leave the
   name blank, click Save. Expected: a red "Task name can't be empty" message appears (the button
   is no longer pre-emptively disabled).
6. **Deep link `?task=<uuid>` doesn't work** (`81d3f11`). Verify: take any task's id, visit
   `/work?task=<id>` (no `view=` param, no `#` hash) directly. Expected: lands on `view=all` and
   scrolls to/highlights that task, even though the URL you typed has neither.

## Part C — a bug you should know about even though it's not a feature

**`F-8` (`20d517f`):** `blockers.days_stuck` was frozen at whatever value it had when the row was
created — never advanced. This fed the priority scorer (`lib/priority.ts`'s `scoreBlocker`) and the
prioritization prompt, not just display. Fixed at all 4 fetch sites (`work/page.tsx`, `lib/queries.ts`,
`daily-digest.ts`, `prioritize-tasks.ts`). Live-verified: one specific blocker went from showing
"9d stuck" to "31d stuck" after the fix, matching a direct SQL computation of its real age. If you
check `/` (Overview) or `/work`, any blocker's "days stuck" figure should now reflect real elapsed
time since its `created_at`, not a frozen snapshot.

## Part D — still open, not done this session (say so if asked, don't imply otherwise)

- **F-7** — a sub-stage can show "Not activated" in Project Process while a real, open task is
  already tagged with that exact sub-stage (a task can carry `substage_template_id` without a
  corresponding `project_substages` instance ever being created). Root-caused, not fixed — the
  obvious fix risks resetting an already-`done` sub-stage back to `active` if done carelessly.
- **Notes Center's reinterpretation fix** (`5b106cd`, changing "We read this as…" now actually
  saves the intent, not just the association) is code-reviewed and type-checked but **not
  live-UI-verified** — Notes Center correctly excludes `is_test` notes by design, so there is no
  QA-safe note reachable through its own filters to click-test against. If you find a way to verify
  this safely, or if Rotem authorizes testing against a real note, that would close a real gap.
- **Notes Center has no Undo** on save at all (unlike My Work's verb menu) — known, not built.
- Data Inbox bulk upload (a separate, larger track) — not started this session.
