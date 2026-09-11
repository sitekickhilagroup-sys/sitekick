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

---

## Part D — Domain-knowledge review (for Noa, via her Claude)

**Purpose:** while working today's task, I (Claude, working with Rotem) read a lot of real project
data — task titles, notes, pending review-inbox items, blocker/relationship proposals, document
excerpts — as a side effect of building and testing date provenance. That reading surfaced a
picture of how Hilla Group's projects actually work: who does what, what blocks what, and some
patterns in how Noa herself seems to run the portfolio. None of this was verified WITH Noa — it's
inferred from data, and inferred facts are exactly the kind of thing this whole session was about
NOT treating as ground truth without a human confirming it first.

**What I need from you (Noa's Claude):** show Noa each claim below (or read them together) and
record, for every single one, exactly one of:

1. **Correct** — matches reality as Noa knows it.
2. **Incorrect** — wrong, and if you can, say what's actually true instead.
3. **Unknown / needs verification with Noa** — you're not sure either, needs Noa herself to answer.

Record answers inline in this file (edit a copy, or add "→ Noa: 1/2/3, note" after each claim), then
commit it back (or hand the completed file back to Rotem) so a future session can read the graded
answers. Don't spend time re-deriving these from scratch — they come from data already in the
system; the job here is judgment, not investigation.

### D.1 — People and their real roles (per project)

- Rowan Kelshaw (Premise) is the architect/designer of record across at least Blair, San Marco, and
  Rinconia — he shows up requesting submittal packages and retaining consultants on all three.
- Serena Feit (ReDefined Consulting LA) is the permit expediter who actually files with LADBS and
  tracks intake screening — seen on Rinconia specifically ("still screening the intake," no payment
  link yet).
- One of the raw email threads addressed a "Serena Shlomof" on an LADBS reply about the same
  submittal Serena Feit was handling — is this the same person under a different/married name, a
  typo, or a genuinely different person? (Flagging as likely **unknown** rather than asserting
  either way.)
- Greg Byrne of Grover-Hollingsworth is the soils/geotechnical engineer for Rinconia. His verbal
  estimates (e.g. "late next week or early the week after," given 8/26) have historically not
  translated into an actual delivered report on the estimated date, and a later "correction" from
  him was itself just another verbal estimate, not a firm confirmed date.
- "Bob," named as the one who must "review and resubmit an addendum" on the Rinconia soils task —
  role and company are **unknown** to me; possibly someone at Grover-Hollingsworth, possibly someone
  on Hilla's own side. Needs Noa to say who this is.
- Thang Le is a civil engineer who worked on San Marco's grading proposal, and appears to coordinate
  with Serena on some deliverables.
- Mid-Cities is an engineering/contracting firm that formally refused to sign Hilla's MSA for San
  Marco's civil engineering scope, over a scope/pricing disagreement — this is the actual blocker
  behind San Marco's stalled grading plan and Hold Letter response, not a scheduling delay.
- Amin is a surveyor who did a joint San Marco/Rinconia topo survey and was owed $500 for the CAD
  format specifically (the survey itself was already delivered).
- Refael (Hilla Group) appears both on entity-level financial/banking items (LLC accounts, wire
  transfers) AND on at least one project-level item (Rinconia's 100B tax appeal continuation) —
  is he a portfolio-wide finance/ops person rather than tied to one property?
- Gibbs Giden is outside legal counsel, currently owed on an invoice unpaid 90+ days.
- Or Politzer is a foundation-bid/contractor contact on Blair Dr.
- Tony Russo / Abhi (Crest) are tied to Blair Dr's Planning-call/extension-outcome tracking.
- Dor sets cross-cutting process/product rules (e.g., "admin work tracked separately from project
  work," "reduce the review queue to almost nothing") but is not the person doing day-to-day task
  management — that's Noa. Rotem is the technical decision-maker (architecture, migrations, what
  gets built).

### D.2 — What blocks what (per project)

- **Rinconia:** the soils addendum (Greg Byrne/Grover-Hollingsworth) is the SAME root cause behind
  two separately-tracked items: the LADBS resubmittal blocking Plan Check, and the "Obtain the soil
  approval letter from LADBS" task (tracker EM-03) — these are two downstream effects of one
  blocker, not two independent problems that both happen to be stuck.
- **Rinconia:** retaining a civil engineer for grading was gated on three separate preconditions
  clearing together (basement scope, pricing parity across two consultants, and Rowan confirming
  Thang reviewed the soils report) — nothing gets signed until all three clear, not just the
  cheapest/fastest one.
- **San Marco:** the civil engineer/grading blocker (Mid-Cities MSA dispute) is upstream of the Hold
  Letter response — Hold Letter can't move until grading scope is settled.
- **Alta Mesa:** the Deemed Complete Letter is a hard precondition for scheduling the ZAD hearing —
  no letter, no hearing date, regardless of anything else being ready.
- **Blair Dr:** the Plan Check extension has a real, hard expiration (around 9/1/2026) with no new
  filing appointment yet booked — as of today this reads as the single most business-critical
  blocker across the entire portfolio, ahead of anything on the other three projects.
- **Blair Dr:** a separate, ongoing legal proceeding ("Gray v. City") is procedurally tied to the
  Plan Approval process — a continuance decision on that case has direct schedule impact on Blair's
  entitlement timeline.
- **Blair Dr:** case files have not been transferred from City Planning to OZA yet — an inter-
  department handoff that is itself blocking further progress, independent of any consultant's work.

### D.3 — Workflow / decision-making patterns

- Noa periodically does "status refresh" passes across open items — logging that nothing material
  changed rather than only logging genuinely new facts. (Seen as a recurring note pattern: "Status
  refresh, no change to owner or task name.")
- A financial/legal item (an invoice 90+ days overdue, an entity-level fund transfer >$65K) gets
  treated as high-priority even with no hard calendar deadline — dollar amount + counterparty risk
  is itself a priority signal, not just dates.
- A vendor/consultant's name is deliberately NEVER treated as evidence for which property a task
  belongs to, because the same people (architect, surveyor, soils engineer) work multiple
  properties at once — this is already enforced in the extraction logic, but worth Noa confirming
  it still matches how she actually thinks about attribution.
- **Known, not-yet-fixed gap, not a claim to confirm as true:** today the system CAN still suggest
  merging two tasks as duplicates based on a weak, generic shared word (e.g. a possessive name) even
  across different projects — this is a real bug (Noa's own earlier finding), still open, and the
  opposite of the rule above. Flagging it here so Noa's Claude knows it's tracked, not forgotten.

### D.4 — My plan for using your answers to improve the learning engine (asking for your read on this)

Once this is graded, here's what I'd propose doing with it — genuinely asking for pushback, not
just informing:

1. **Correct (1) answers** become a durable, portfolio-level "verified domain knowledge" block —
   similar to how `lib/feedback-context.ts` already feeds Noa's confirmed facts into the extraction
   and prioritization prompts, but at the level of "who does what, what blocks what" rather than
   per-task corrections. The extractor and prioritizer would read this as settled ground truth
   instead of re-inferring it from raw text every single time.
2. **Incorrect (2) answers** become explicit negative constraints, the same way
   `rejectedPatterns` already tells the extractor "don't re-assert this, a human already said no."
3. **Unknown (3) answers** go into `docs/ai/OPEN_QUESTIONS.md`-style tracking until someone
   resolves them directly with Noa — never silently guessed into becoming "known."
4. This would be a genuinely NEW kind of learning input, distinct from `priority_feedback` (which
   only captures reactions to something the agent already suggested). This captures structural,
   relational truth about the business that today's pipeline has no persistent memory of at all —
   it re-derives "who does what" from scratch on every single document.
5. Because this touches schema/architecture (a new table or a real extension of an existing one),
   I would NOT build this without Rotem's explicit sign-off first — that's a hard rule on this
   project, not a formality.

**Question back to you (Noa's Claude) and to Noa directly:** does this general shape make sense —
turning confirmed domain knowledge into a standing reference the AI reads, rather than something it
re-guesses every time? Is there a simpler representation you'd actually want (e.g. something visible
and editable on a screen, vs. an invisible prompt input only engineers can see)? And is there
anything in section D.1–D.3 that, once corrected, would change how you'd want the AI to prioritize
or attribute work — anything where today's wrong assumption is actively causing bad suggestions you
have to keep rejecting?

---

## Part E — Planned, NOT YET BUILT: "Report a problem" in the Notes Assistant

**Status as of this writing: planned and agreed with Rotem, not built, not deployed.** This section
is being sent to Noa before any code is written, at Rotem's explicit request — so she sees what's
coming before it ships, not after.

**What's changing for Noa:** the floating Notes Assistant she already uses (the 💬 button, bottom of
every screen) gets a fourth option alongside Fact / Instruction / Preference: **"Report a problem."**
Same place, same flow — she writes what happened in her own words; nothing new to learn.

**What happens to a problem report after she sends it:**
1. It's stored exactly like her other notes are today — nothing is silently acted on.
2. **Twice a day**, an automated pass collects every new, not-yet-handled problem report and writes
   ONE prioritized, plain-language document: what the problem is, a time estimate to fix it, and how
   significant it is. Rotem can read this document whenever he asks for it — it's always current as
   of the last twice-daily pass, not something he has to go hunting through raw notes for.
3. **Hard boundary, by design:** that automated pass only ever WRITES the report. It never touches
   code, never deploys anything, never fixes anything on its own. Rotem decides which items actually
   get worked on and when — the same human-approval discipline every other part of this system
   already follows (an AI suggestion is never a business action until a person says yes).

**What this does NOT do (today, or as currently planned):** it does not send Rotem or anyone a live
push notification the instant Noa writes something — the twice-daily pass is a check, not an alert.
If instant notification ever matters, that's a separate, materially bigger piece of work (this system
has no way to send outbound email/Slack/etc. today, only to receive incoming mail) — flagging this
now so nobody assumes it already works that way once this ships.

**Question for Noa (via her Claude):** is there anything about HOW she'd want to report a problem
that this plan is missing — e.g., attaching a screenshot, rating the severity herself instead of
leaving it to the automated pass, or wanting to be told once something she reported has actually been
fixed? Any of these would be easy to fold in now, before it's built, rather than retrofitted later.
