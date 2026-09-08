# SiteKick — Learning Model Improvement (Draft Handoff)

**Status:** Draft / design proposal, not authorized. **Date:** 2026-09-08. **Author:** local Claude
Code CLI, at the Product Owner's request. **This is documentation only** — no application code,
database schema, production data, or deployment configuration was changed to produce this
document, and it introduces no commit. Follow `docs/ai/DECISIONS.md`'s evidence discipline: every
claim below is tagged implemented-and-verified, implemented-but-not-verified, partially
implemented, or proposed — never blurred.

**Revision 3 (2026-09-08):** added §9.6 (the verified My Work UI action→signal map, and the finding
that `pinTask`/`snoozeTask` exist server-side but have **no UI caller** — the strongest signal is
currently impossible to produce), Milestone 1.5 (add the reorder/pin control), and **§10 — a full
model of every user action across every tab**, at the Product Owner's request that *every button
click be measured and learnable, not only My Work*. §10 also surfaces which actions are **not logged
at all today** (drafts, blockers) — real gaps in the "record everything" substrate. New Open
Decisions #9–#11. Still design-only.

**Revision 2 (2026-09-08):** added §1a (live-data reality check) and §9 (Path B). A read-only query
of production `activity_log`/`tasks` found that the explicit **correction signal the original design
(§3, "Corrected") is built on — the manual pin — has never once occurred in real use** (zero pins,
zero snoozes, ever). This does not invalidate the loop, but it moves the centre of gravity: the
signal is not in the one action Noa doesn't take (pin), it is in the ~300 actions she does take
(complete / note / not-applicable / merge / set-waiting). §1a records the numbers; §9 designs the
richer alternative ("Path B") that learns from those; a new Open Decision #8 makes **Path A
(original, pin/threshold counting) vs Path B (action-derived signal) the primary fork** to resolve
before any milestone is scoped for build. Everything remains design-only.

**Scope:** task prioritization only (`priority_runs` / `task_priorities` / `tasks.manual_priority`).
Auto-triage's own learned thresholds (`lib/auto-triage.ts`) are a separate, already-implemented
system — referenced here only as the design pattern to reuse, not as something this document
proposes changing.

**Relationship to existing `docs/ai/` records:** this elaborates the "Execution Memory" item listed
as planned/not-implemented in `CURRENT_STATE.md`, and is downstream of the bug history in
`DECISIONS.md` D-011/D-013 and `OPEN_QUESTIONS.md` Q-007. Nothing here supersedes those entries;
read them first for the prioritization-run integrity history this design builds on top of.

---

## 1. What already exists and is verified

Verified means: confirmed either by direct source read, or by an actual run/query recorded in
`docs/ai/` (typecheck/build/test, or a live Supabase read via the now-connected MCP — see
`OPEN_QUESTIONS.md` Q-001/Q-005/Q-008, `DECISIONS.md` D-013).

- **`activity_log`** (`supabase/migrations/0002_proposals_activity.sql`) — every task/invoice/
  proposal/blocker/decision action is logged: `actor`, `action`, `before_json`/`after_json`,
  `created_at`. Written via `lib/state-writer.ts`'s `logActivity`, called from `app/actions/work.ts`
  (`applyWorkVerb`, `undoWorkVerb`, `reopenTask`, `snoozeTask`, `pinTask`) and several other action
  files (`proposals.ts`, `invoices.ts`, `tasks.ts`, `profile.ts`). **Verified against live data**:
  the connected Supabase MCP's `list_tables` call returned 1,140 real rows in this table (D-013).
  This table is the raw substrate an Execution Memory layer would consume — it already records
  "what did the human do," system-wide, today.
- **`priority_runs` / `task_priorities`** (`supabase/migrations/0022_prioritize_learn.sql`) — the
  AI's proposal layer: one `priority_runs` row per prioritization run, one `task_priorities` row per
  ranked task within it (`global_rank`, `project_rank`, `score`, `urgency`, `reason`). Append-only
  by design — a re-run inserts a new run and never rewrites history (migration's own comment).
  **Verified against live data**: 22 runs / 2,600 linked rows confirmed via live query (D-013);
  every existing run has at least one linked `task_priorities` row (`OPEN_QUESTIONS.md` Q-007
  item 3).
- **`tasks.manual_priority` / `tasks.snoozed_until`** (same 0002 migration) — the existing explicit
  correction/deferral signals. `manual_priority` always outranks the AI/deterministic order at
  render time (`lib/priority.ts:18`, `app/(dash)/(standard)/work/page.tsx:294`). Write path:
  `pinTask(taskId, manualPriority)` / `snoozeTask(taskId, until)` in `app/actions/work.ts`, each
  already logging to `activity_log` on every call.
- **The prioritization empty-run bug — fixed in code, not yet committed.** `agents/
  prioritize-tasks.ts`'s `applyPrioritization` used to leave an orphaned empty `priority_runs` row
  if the following `task_priorities` insert failed; `app/(dash)/(standard)/work/page.tsx`'s "latest
  run" query used to pick strictly the newest run with no check for linked rows, so an empty run
  could silently replace a good one in the UI. Both halves are now fixed (write-side: delete the
  orphaned run on insert failure; read-side: pick the newest run that actually has linked rows).
  **Verified**: `npm run typecheck`, `npx eslint`, `npm run build` (`next build`), and `npm run
  test` (`vitest run`, 370/370 passing) all ran clean against this change (`DECISIONS.md` D-011/
  D-013). **Not yet verified**: still sitting as an uncommitted working-tree change as of this
  writing (`git status` shows `agents/prioritize-tasks.ts` and `app/(dash)/(standard)/work/
  page.tsx` modified, not committed) — see Milestone 0 below and Open Decision #7.
- **The auto-triage learned-threshold pattern** (`lib/auto-triage.ts`) — a working, deterministic
  example of exactly the kind of loop this document proposes generalizing: `proposalClass()`
  buckets a proposal into a situation class; `computeClassStats()` aggregates human accept/reject
  history per class **excluding any row whose `decided_by` starts with `agent:`** (line 103 — the
  self-learning guard referenced in §6); `classifyProposal()` promotes a class to `auto_apply`/
  `auto_ignore` once it crosses `MIN_CLASS_N = 5` samples and an `AUTO_APPLY_RATE = 0.85` /
  `AUTO_IGNORE_RATE = 0.85` confirmation rate. This is confirmed by direct code read and has its
  own test file (`lib/auto-triage.test.ts`). **Not verified against real production behavior** —
  wired end-to-end from `api/cron/triage`, but no session has checked whether its actual
  classifications have been correct at scale (`CURRENT_STATE.md`'s own tagging).
- **`review_rules`** (same 0022 migration) — durable, human-taught rules, currently only for
  `attribute_project`. Has `active`, `hits`, `learned_from` — the inspect/disable/rollback shape
  this document's proposed `priority_rules` table (§5) deliberately mirrors.

## 1a. Live-data reality check (2026-09-08) — verified against production

Source: read-only `SELECT`s against the connected production Supabase (no writes), covering the
window **2026-08-23 → 2026-09-07** (~16 calendar days). Reproduce with the queries noted inline.

**The decisive finding — the original design's correction signal is empirically absent:**

| Metric | Value |
|---|---|
| Tasks currently pinned (`tasks.manual_priority IS NOT NULL`) | **0** |
| Tasks ever snoozed (`tasks.snoozed_until IS NOT NULL`) | **0** |
| `activity_log` actions that are pins/snoozes | **0** |
| `activity_log` action = `prioritize` (a human triggering a run) | 7 (noa 3, dor 2, rotem 2) |
| **Total human task-actions in window** | **301** |
| Distinct days with any human task-action | **10** (of 16) |

So the loop in §3 — which keys "Corrected" off `pinTask` — would, on current behaviour, collect
**zero** corrected rows. Noa runs the prioritizer and then simply *works the list*; she does not
reorder it by hand. The rich signal is in the actions she actually performs.

**What Noa actually does (human actions on tasks, `entity_type='task'`, window above):**

| Action | n | What it plausibly says about the ranking |
|---|---|---|
| `review:new_task` | 49 | triage/creation — not a ranking signal per se |
| `edit:details` | 41 | context edit — weak/ambiguous ranking signal |
| `verb:completed` | 33 | **completion order vs. rank — the richest ranking signal (§9)** |
| `verb:note` | 30 | progress — mild "confirmed / still active" |
| `review:update_existing` | 27 | enrichment — not a ranking signal |
| `verb:not_applicable` | 22 | **high-ranked → NA = the AI surfaced the wrong thing (§9)** |
| `merge` / `merge:absorb` | 18 / 18 | a ranked task was a duplicate — data-quality noise |
| `set_waiting` / `verb:waiting` | 13 / 9 | **high-ranked but blocked = over-ranked non-actionable (§9)** |
| `review:merge_duplicate` | 10 | dedup — data-quality, not ranking |
| `verb:completed` (small tail: scheduled/sent_email/reopen/…) | ~10 | disposition signals |

(Agent/system actions in the same window — `accept:task_update` 142, `create` 62, `set_category`
32, etc. — are **excluded** from all of the above by the §5 self-learning guard, and are listed here
only to show they dominate raw volume; they must never count as feedback.)

**Three consequences for the rest of this document:**
1. §3's "Corrected" branch is now labelled *empirically-zero* below — it stays in the design as the
   path that fires *if* Noa ever starts pinning, but it cannot be the primary signal.
2. The `MIN_CLASS_N = 5` threshold reused from auto-triage is re-examined against real cadence in §9:
   at ~300 actions over 10 active days, spread across many situation-classes, a *common* class can
   reach 5 samples in a week or two, but a *rare* class may take months or never — which is exactly
   why exact-match bucketing (Path A) is slow, and why Path B's generalization matters.
3. This is the empirical basis for **Open Decision #8 (Path A vs Path B)**.

## 2. What is only partially implemented

- **The "pinned corrections" prompt feedback** (`agents/prioritize-tasks.ts` lines 95–97, 199–200)
  — Noa's last 10 `manual_priority` pins are already fed back into the ranking prompt as "HUMAN
  CORRECTIONS." This is a real feedback path, but a crude one: unlinked to which specific AI run or
  rank it corrected, unweighted, capped at 10, and its actual effect on ranking quality has never
  been measured. It is the ad hoc precursor to §3 below, not a separate thing to remove.
- **`manual_priority` as a correction signal is captured, but not attributed to a specific AI
  proposal.** `pinTask` logs `{ manualPriority }` to `activity_log` on every call, but nothing
  today records what the AI's `global_rank`/`reason` for that task was at the moment of the pin —
  so it is currently impossible to compute "how often does Noa's manual order agree with the AI's
  most recent proposal for that task" from existing data alone.
- **Auto-triage's learning is implemented and wired, but confidence in its real-world accuracy is
  unverified** (see §1) — relevant here only as the pattern being reused, not as something this
  document changes.
- **Execution Memory itself — not implemented.** `CURRENT_STATE.md` states this directly: "`priority_
  runs`/`task_priorities`/`digests` exist but no structured outcome-learning mechanism does." This
  document is the design for closing that gap, scoped to prioritization only.

## 3. Proposed event-to-feedback-to-learning flow

```
[situation]              [proposal]                [action]                [feedback]
 open task,          →   task_priorities row    →   Noa's next real     →   priority_feedback
 project, phase,         (run_id, global_rank,       action on that          row: confirmed /
 due date, blockers      urgency, reason)            task (or none)          corrected /
                                                                              reverted / ignored
```

1. **Situation + proposal** — already fully captured by `task_priorities` (§1); no change needed.
2. **Action** — already logged by `activity_log` for every verb, pin, snooze, undo, reopen (§1); no
   new logging infrastructure needed for the raw event stream.
3. **Feedback (new)** — a `priority_feedback` row is derived per (run, task) pair, classifying what
   happened next:
   - **Confirmed** (implicit, no new UI) — the task was acted on (any `WorkVerb`) in a way
     consistent with its `urgency` tier (e.g. a `'now'`-tier task worked same day). Derived by a
     background pass diffing `task_priorities` against later `activity_log` rows for the same task
     — the default outcome, not a user-initiated event.
   - **Corrected** *(empirically-zero as of 2026-09-08 — see §1a)* — `pinTask` is called on a task
     that currently has a `task_priorities` row in the latest run, with a `manual_priority` that
     reorders it against the AI's `global_rank`. The one real code touch this requires: `pinTask`
     looks up the task's current run/rank before writing, and records the AI's proposed numbers
     alongside the correction. **Reality:** Noa has never pinned a task, so under current behaviour
     this branch fires zero times. It is retained as a valid path *if* pinning ever starts, but it
     cannot be the primary signal — that role moves to §9's action-derived signals.
   - **Reverted** — `pinTask(taskId, null)` after a prior `'corrected'` row exists for that task.
     Kept as its own value, not folded into `'confirmed'`, so "Noa changed her mind" is never
     miscounted as "the AI was right."
   - **Ignored** — a `'now'`/`'high'`-tier task still open, unpinned, and untouched N days after
     its run. Found by the same background sweep as "confirmed," not a user action. (N is an open
     product decision — see §8.)
4. **Learning (aggregation)** — feedback rows are grouped by a `rule_key` (a situation class,
   analogous to `proposalClass()` — e.g. `category=admin|urgency=now|has_hard_due`), and a
   confirm/correct rate per class is computed **on the fly**, the same way `computeClassStats()`
   already works for triage — no premature persistence of stats until a class actually graduates
   (§5's ladder).

## 4. Database tables and code areas involved

**Reused as-is (no schema change):**
- `priority_runs`, `task_priorities` — `supabase/migrations/0022_prioritize_learn.sql`
- `activity_log` — `supabase/migrations/0002_proposals_activity.sql`
- `tasks.manual_priority`, `tasks.snoozed_until` — same migration
- `agents/prioritize-tasks.ts` — `prioritizeTasks`, `applyPrioritization`, `runPrioritization`
- `app/actions/work.ts` — `pinTask` (the one function that needs a small addition, §3), `snoozeTask`
- `lib/state-writer.ts` — `logActivity`
- `lib/priority.ts` — deterministic scoring/ordering (`manual_priority` always wins, line 18)
- `app/(dash)/(standard)/work/page.tsx` — "latest AI prioritization run" read (already fixed per §1)
- `lib/auto-triage.ts` — `proposalClass`, `computeClassStats`, the self-exclusion filter (pattern
  to copy, not code to modify)

**New, proposed (not created by this document):**
- **`priority_feedback`** — append-only fact table. Columns: `id`, `run_id` (fk `priority_runs`),
  `task_id` (fk `tasks`), `proposed_global_rank`, `proposed_urgency`, `proposed_reason`
  (denormalized copies from `task_priorities` at feedback time, so history survives even if
  `task_priorities` rows are later pruned/summarized), `noa_action` (`'confirmed'|'corrected'|
  'reverted'|'ignored'`), `correction_detail` (jsonb), `source_activity_log_id` (fk `activity_log`
  — every feedback fact traces to one real logged action), `decided_by`, `decided_at`.
- **`priority_rules`** — only for rule classes that graduate past pure observation (mirrors
  `review_rules`'s existing shape). Columns: `id`, `rule_key`, `stats` snapshot (`n`, `confirmed`,
  `corrected`), `stage` (`'observing'|'suggesting'|'auto'`), `active`, `created_at`/`updated_at`,
  `last_applied_at`.

Neither table has been created; this is a proposal for `docs/ai/` review, not a migration.

## 5. Safeguards against learning from automated actions

Directly reusing the guard already proven in `lib/auto-triage.ts:103`
(`if (!h.decided_by || h.decided_by.startsWith('agent:')) continue;`), not inventing a new one:

- Every aggregation query over `priority_feedback` (the on-the-fly stats in §3 step 4, and any
  persisted `priority_rules.stats` snapshot) must apply the identical filter: only rows whose
  `decided_by` names a real human actor count.
- Any write the automation itself performs (Milestone 3, §6) must log its actor with a fixed,
  greppable prefix — `agent:priority-learner` — structurally excluded from ever feeding its own
  stats, by construction, not by a runtime check that could be forgotten at a new call site.
- The "ignored" sweep (§3) must skip any task whose most recent `activity_log` row was itself
  agent-authored, so an automated pin/unpin cannot manufacture a false "ignored" or "confirmed"
  signal about itself.
- Proposed test (see §6, Milestone 1): a poisoning test — feed the aggregation function a synthetic
  history where 100% of `agent:*`-authored rows are "wrong" and assert the computed confirm rate is
  unaffected. This is the kind of guarantee that should be enforced by an automated test, not by
  code review alone, before any automation rung is enabled.

## 6. Milestones, tests, rollout, rollback

**Milestone 0 — prerequisite, not new work: commit the existing D-011/D-013 fix.**
The empty-run bug fix in `agents/prioritize-tasks.ts`/`work/page.tsx` is implemented and validated
(§1) but uncommitted. Feedback data built on top of a still-buggy write path would be tainted by
empty-run noise from the moment collection starts. This should land (as its own, separately
authorized commit — unrelated to this design) before Milestone 1 begins. See Open Decision #7.

**Milestone 1 — instrumentation only, no behavior change.**
- Add `priority_feedback` (migration). Extend `pinTask` to look up the task's current run/rank and
  write a linked `'corrected'`/`'reverted'` feedback row alongside its existing `activity_log`
  write. Add the "confirmed"/"ignored" background sweep as a read-only job that only writes
  `priority_feedback` rows — it changes no other table and nothing yet reads this table back.
- Tests: a pure `rule_key` classification function, unit-tested the same way `proposalClass` has
  its own tests in `lib/auto-triage.test.ts`. The self-exclusion poisoning test from §5. A test that
  a `'reverted'` row is never miscounted as `'confirmed'`.
- Rollout: before writing the migration, run a **read-only** query against live `activity_log`/
  `task_priorities` (via the already-connected, read-only Supabase MCP) to sanity-check what the
  real `rule_key` distribution looks like — catches a badly-designed class scheme before any schema
  commitment.
- Rollback: drop the two new tables, stop the sweep job. Zero impact on existing behavior, since
  nothing yet reads `priority_feedback`.

**Milestone 1.5 — add the reorder / pin control to My Work (the missing strongest signal).**
Per §9.6, `pinTask`/`snoozeTask` already exist and already log (`pin`/`snooze`) but have no UI, so
the strongest, unambiguous ranking correction is impossible to perform today. This milestone adds a
drag-to-reorder (or "move to top / move up-down") control on the My Work list that calls the
existing `pinTask`, plus a snooze control calling `snoozeTask`. It is UI-plus-forward-capture only:
each reorder writes a `priority_feedback` row of type `corrected` (§3), linked to the live run/rank.
- Scope note: this is a small, contained UI change to existing server actions — but it is still a
  product change to the operator's core screen, so it is called out as its own milestone for the
  Product Owner to authorise, not folded silently into Milestone 1.
- Tests: a reorder produces exactly one `corrected` feedback row with the correct rank delta; a
  reorder-then-revert produces a `reverted` row, never a second `corrected`.
- Rollout: Preview first; ask Noa to use it in her daily session so the signal starts flowing.
- Rollback: hide the control; `pinTask`/`manual_priority` behaviour is unchanged from today (still
  wins at render), so removing the button loses only new signal, breaks nothing.

**Milestone 2 — suggestion-strength surfacing (UI only, no automation).**
- Compute per-`rule_key` stats on the fly from `priority_feedback` (mirrors `computeClassStats`).
  Surface a confidence indicator in the Work UI (e.g. "AI has been right about this Nx running")
  once a class crosses the sample threshold — display only, no data mutation.
- Tests: stats computation tested against synthetic feedback histories, same shape as `lib/
  auto-triage.test.ts`'s `ClassStats` tests.
- Rollout: Vercel Preview first; at least one full real review cycle with Noa's actual usage before
  deciding whether to proceed to Milestone 3 (this is a genuine go/no-go gate, not a formality —
  Milestone 2's real-world signal is what §8's open questions need answered before Milestone 3 can
  be scoped concretely).
- Rollback: remove the badge; no data impact, read-only display.

**Milestone 3 — narrow auto-apply (requires explicit Product Owner authorization; not started).**
- Restricted to the single safest action identified during design (e.g. auto-clearing a stale pin
  once its task is done) — not broad reordering. Gated by `priority_rules.active`, defaulting to
  inactive; the Product Owner turns on individual rules explicitly, never as a side effect of a
  deploy.
- Tests: the §5 poisoning test at integration level (an automated write must never appear as a
  human confirmation in the next aggregation pass). A rollback test: flipping `active=false`
  produces zero further automated writes without a deploy.
- Rollout: staged — enable exactly one `rule_key` first, soak in production for an explicit period
  before enabling any additional rule; each addition is its own Product Owner action.
- Rollback: `priority_rules.active = false` for the specific rule — instant, no deploy, no data
  loss (the `review_rules` pattern this mirrors already works this way today).

**Milestone 4 — full automation (setting `manual_priority` without confirmation) — explicitly not
scheduled.** Listed here only to be explicit that it is out of scope unless separately authorized;
see Open Decision #1.

## 7. Traceability, inspection, and disable — for the record

(Carried over from the design discussion; recorded here so it lives in `docs/ai/` rather than only
in chat, per `WORKFLOW.md`'s documentation-update rule.)

- `priority_rules.active` mirrors the already-proven `review_rules.active` field — a rule is
  disabled without deleting its history.
- Every graduation/demotion between stages is itself logged to `activity_log`
  (`entity_type='priority_rule'`, `actor='system:priority-learner'`) — the learning process is
  auditable through the same feed Noa's own actions go through, not a separate opaque log.
- Full evidence trail is always reconstructable: rule → `priority_feedback` rows that justified it
  → `source_activity_log_id` → the exact human action, actor, and timestamp behind each one.
- Because `priority_feedback`/`priority_rules` are append-only and `priority_runs`/`task_priorities`
  are never mutated, disabling or deleting a rule has zero effect on historical data.

## 8. Open product and architecture decisions

None of these are resolved by this document — recorded per `AGENTS.md`'s rule that a
product/architecture decision needs explicit Product Owner authorization, not assumed from a
design's internal logic.

1. **Is Milestone 4 (full automated rank-setting) in scope at all?** It directly intersects an
   existing recorded principle: "task-priority ranks are always derived deterministically
   server-side... the model's rank output is never trusted directly" (`DECISIONS.md`, embedded
   decisions section, from `prioritize-tasks.ts`/`schemas.ts`'s own comments). Reaching Milestone 4
   would mean revisiting that principle, not just extending it — needs its own explicit decision,
   separate from authorizing Milestones 1–3.
2. **What counts as "ignored," concretely?** How many days of a `'now'`/`'high'` task sitting
   untouched before it becomes a negative signal? Too short risks false negatives (Noa on vacation,
   a genuinely deep backlog day); too long makes the signal useless. No number is proposed here —
   needs a product call, ideally informed by real backlog-depth data once Milestone 1 is collecting
   it.
3. **Should "confirmed"/"ignored" classification account for daily throughput/capacity?** A task
   that simply hasn't been reached yet because Noa can only work N tasks/day is not the same signal
   as the AI having misjudged it. Needs a decision on whether/how to normalize for this before the
   sweep in Milestone 1 is trusted for anything beyond raw collection.
4. **Retention and visibility of per-person behavior data.** `priority_feedback` ties actions to
   `decided_by` (an email) indefinitely by the current proposal. No retention policy or anonymization
   is addressed by the existing tables' read-only RLS policies (`0022_prioritize_learn.sql`) — needs
   an explicit decision before Milestone 1's table is created.
5. **Should Milestone 2's confidence badge be visible to Noa, or admin-only initially?** A
   trust/UX decision, not a technical one — showing "the AI has been right about this before" could
   shape her own behavior (anchoring), which would itself contaminate the very feedback signal
   being measured.
6. **Hilla-specific tuning vs. reusable-core candidate.** Per `AGENTS.md`'s "two levels, not two
   products" non-negotiable and `CURRENT_STATE.md`'s `REUSABLE-CORE-CANDIDATE` tagging convention:
   should `rule_key`/`priority_feedback` be designed from day one as portable across future
   tenants, or built Hilla-specific first and generalized later (the same order the rest of the
   codebase has followed)? Affects how much abstraction Milestone 1 should carry.
7. **When does the Milestone 0 prerequisite commit happen, and under whose authorization?** The
   D-011/D-013 fix has been validated but sits uncommitted; this design assumes it lands first but
   does not itself authorize that commit — see `CURRENT_STATE.md`'s "Next work" for the existing
   open item.
8. **Path A vs Path B — the primary fork (new, and the one to resolve first).** §1a shows the pin
   signal Path A leans on is empirically zero. **Path A** (original: pin/threshold counting) is
   cheap, deterministic, and consistent with the codebase's stated "never trust the model's rank
   directly" principle — but slow, shallow, and mostly starved of signal today. **Path B** (§9:
   derive feedback from the actions Noa actually takes, plus situation-generalization) is the only
   option that matches the Product Owner's stated goal — *"every action Noa takes should meaningfully
   sharpen the model, and we should improve every day."* Path B is more powerful and more work, and
   its "generalize across similar situations" half moves further from pure determinism (mitigated in
   §9.3 by keeping the aggregation explainable). These are not mutually exclusive — Path B's *signal
   extraction* (§9.1) can be built on Path A's *deterministic aggregation* (§9.3, stage 1). The
   decision needed: authorize Path B's signal model as the design to build toward, and choose how
   far up §9.3's ladder (deterministic → weighted → similarity model) is in scope.

## 9. Path B — learn from the actions Noa actually takes (design only)

Motivated by §1a: the signal is not in the pin (never happens), it is in the ~300 real actions.
Path B keeps the *entire* infrastructure of §1–§7 (the `priority_runs`/`task_priorities` proposal
layer, `activity_log` as substrate, `priority_feedback` as the fact table, the §5 self-learning
guard, the §7 rollback story). It changes exactly two things: **what becomes a feedback signal
(§9.1)**, and **how signals aggregate into something usable (§9.3)**. No black-box model is required
to start — the first rung is as deterministic and explainable as Path A.

### 9.1 Signal extraction — mapping real actions to ranking feedback

Each signal below is *derivable from data that already exists* (`task_priorities` for the proposed
rank/urgency, `activity_log` for the action and its timestamp/order). None requires a new UI. All
are per (run, task), and all obey the §5 guard (human actors only).

- **Completion-order disagreement — the primary signal (`verb:completed`, 33× in window).**
  Within one run, take the tasks Noa completed and the order she completed them. Every pair where
  she finished a *lower*-ranked task before a *higher*-ranked one is a **pairwise "should have been
  higher"** vote for the one she did first. This is a classic *learning-to-rank* signal (pairwise
  preferences), it is dense (33 completions → many pairs), and it is exactly "every action sharpens
  the model" made concrete: each completion updates the relative standing of the features it
  carried. Guard against false positives: only compare pairs both eligible on the same day (skip a
  pair where the higher-ranked one was `waiting`/blocked or snoozed — she *couldn't* have done it).
- **Wrong-to-surface (`verb:not_applicable`, 22×; `review:merge_duplicate`/`merge:absorb`, 28×).**
  A task the AI ranked (especially high-tier) that Noa marks not-applicable or merges away as a
  duplicate is the model surfacing something that should not have been on the list at all. Strong
  **negative** signal on that task's feature-shape — distinct from "ranked in the wrong order":
  ranked at all was the error.
- **Over-ranked-because-not-actionable (`set_waiting`/`verb:waiting`, 22×).** A high-ranked task
  Noa immediately marks waiting/blocked says the ranking over-weighted something she can't act on.
  Signal: down-weight the "urgent but externally-blocked" shape. (The deterministic scorer in
  `lib/priority.ts` already de-ranks snoozed items; this *measures whether it de-ranks blocked ones
  enough*, from real behaviour.)
- **Confirmed (implicit, positive).** A top-tier task acted on promptly and roughly in rank order:
  the ranking agreed with reality. Same derivation as §3, unchanged.
- **Ignored (implicit, negative — with the §8 #2/#3 caveats).** A top-tier task left untouched
  while lower ones were worked. Real signal, but must be normalised for capacity (she only does N/
  day) and availability (blocked/waiting) before it is trusted — see Open Decisions #2/#3.

Net: Path B turns ~110+ ranking-relevant actions per two-week window (completions + NA + merges +
waiting) into feedback, versus Path A's **0** pins. That ratio is the whole argument.

### 9.2 Data shape it needs (still additive, still append-only)

- Reuse `priority_feedback` from §4, with `noa_action` widened to the §9.1 vocabulary
  (`completed_in_order` / `completed_out_of_order` / `wrong_to_surface` / `blocked` / `ignored`,
  plus the retained `corrected`/`reverted` for the day pinning appears). `correction_detail` jsonb
  carries the pairwise partner id and the rank delta for the completion-order case.
- One optional companion for the pairwise signal: `priority_pairwise` (`run_id`, `winner_task_id`,
  `loser_task_id`, `basis`, `source_activity_log_id`) — or fold it into `priority_feedback` as
  paired rows. Either way, append-only; nothing mutates the proposal layer.
- Situation features per task (for §9.3 generalization) are **computed, not stored raw**: category,
  urgency tier, has-hard-due, days-to-due bucket, is-waiting/blocked, project, age bucket, source.

### 9.3 Aggregation ladder — deterministic first, model only if authorised

The point where Path B could become a black box is aggregation; this ladder keeps each rung's cost/
risk explicit so the Product Owner authorises exactly one rung at a time.

1. **Deterministic per-feature rates (default; as explainable as Path A).** For each single feature
   value, report "when the AI ranked *admin* tasks in the top tier, Noa completed them in-order X%
   of the time; out-of-order Y%." Pure counting over §9.1 signals, no model, fully attributable —
   Path A's mechanism applied to Path B's richer signal. This alone answers "is the ranking good,
   and where is it wrong," and needs no new principle. **Recommended starting rung.**
2. **Weighted feature adjustments (needs authorisation).** Fit a simple, inspectable *linear/logistic
   preference weight per feature* from the pairwise votes (e.g. "hard-due within 48h" gets weight w).
   Still explainable (every weight is a number with a sign you can read), still feeds the existing
   deterministic scorer as adjustable coefficients rather than replacing it — consistent with "the
   model's free-text rank is never trusted directly" because the *learned* thing is a transparent
   weight, not an LLM's opinion. This is the rung that makes "every action sharpens the model"
   literally true: one completion nudges a shared weight that applies to all future similar tasks.
3. **Situation-similarity / case-based (explicit, likely out of near-term scope).** Represent each
   situation as a feature vector and predict the likely disposition from nearest past cases. Most
   powerful, fewest actions needed per unit of signal — but the least transparent and the furthest
   from the codebase's determinism principle. Treated as its own authorisation question, not a
   default endpoint. Not recommended before rungs 1–2 have real data behind them.

Promotion up the ladder is a Product Owner decision, never automatic. Demotion (a learned weight
that starts disagreeing with fresh actions decays back toward the deterministic baseline) is
automatic and symmetric, same spirit as auto-triage's class returning to `review`.

### 9.4 Honest risks specific to Path B

- **Single-subject overfit.** This learns *Noa's* habits, not "correct" priority. Fine while she is
  the sole operator (Hilla today); flagged for the multi-tenant future (Open Decision #6). Per-user
  weights, not global, is the safer default if a second operator appears.
- **Anchoring / contamination.** If the UI ever shows the learned confidence (Milestone 2), her
  behaviour may drift toward the model's suggestion, and the feedback then measures the model's own
  influence, not independent judgement — Open Decision #5, sharper under Path B than Path A.
- **Capacity confound.** Out-of-order and ignored signals both need normalising for "she only gets
  through N tasks/day" before rung 2 trusts them (Open Decisions #2/#3).
- **Small-n on rare shapes.** Generalization (rung 2+) helps rare classes borrow strength from
  common ones, but also risks a confident-wrong weight from few examples; needs a minimum-support
  floor per feature and wide confidence intervals shown, not point estimates.

### 9.5 Safeguards and rollback — unchanged from §5/§7

Path B introduces no new safeguard surface: the §5 human-only guard applies to every §9.1 signal
query verbatim; learned weights (rung 2) live in a `priority_rules`-shaped table with the same
`active` flag, `activity_log` audit trail, and append-only history, so any learned adjustment is
inspectable ("this weight came from these N completions"), disableable (`active=false`, instant, no
deploy), and reversible (the deterministic scorer is always the fallback the weights adjust, never
replace). Rungs 2 and 3 are gated exactly like Milestone 3.

### 9.6 The actual My Work UI surface (verified 2026-09-08) — what a click can teach

Verified by source read of `components/work/verb-menu.tsx`, `lib/work-verbs.ts`, `app/actions/
work.ts`. My Work rows expose **exactly one 7-item verb menu**, plus Reopen/Undo — nothing else.
Each verb writes one `activity_log` row and patches one task field, so it is *both* feedback on the
rank at that moment *and* an input update for the next run.

| UI action (My Work row) | `activity_log.action` | Task field patched | Prioritization-learning value |
|---|---|---|---|
| **Completed** | `verb:completed` | `status=done` | ★★★ strongest — completion order vs. rank (§9.1) |
| **Not applicable** | `verb:not_applicable` | `status=dropped` | ★★★ strong negative — "wrong to surface" |
| **Waiting** | `verb:waiting` | `waiting_for` | ★★ over-ranked non-actionable |
| **Delayed** | `verb:delayed` | `due` (pushed) | ★★ deadline pressure was wrong/changed |
| **Scheduled** | `verb:scheduled` | `due` (set) | ★ future-urgency commitment |
| **Sent email** | `verb:sent_email` | `last_touched` | ☆ weak — progress touch |
| **Add note** | `verb:note` | `latest_note` | ☆ weak — still active |
| Reopen | `reopen` | `status=open` | ☆ negative — "wasn't really done" |

**The critical finding — the strongest signal has no UI.** `pinTask` (write `manual_priority`) and
`snoozeTask` (write `snoozed_until`) exist in `app/actions/work.ts` and already log `pin`/`snooze`,
but **no component calls them** (grep: zero callers in `app/`/`components/`). So the empirical zero
in §1a is not a behaviour choice — an explicit manual reorder is *impossible to perform in the
product today*. Adding that control (Milestone 1.5) is the single highest-leverage change for
learning, because a drag from rank #7→#1 is an unambiguous correction, not an inference.

## 10. Universal action model — measure every button, in every tab (design only)

Requested by the Product Owner: *every* click Noa makes, in every tab, should be recorded and
learnable — not only My Work. This section inventories every user-facing mutating control in the
app (verified by mapping each `components/**` caller to its `app/actions/*` server action and to the
`activity_log` row it writes today), says which agent's thinking each one can sharpen, and defines
how to make coverage total. **Nothing here is built; it is the map plus a staged plan.**

### 10.1 Principle — one mandatory audit choke-point

Today, auditing is per-file discipline, and it is uneven: of 17 `app/actions/*` files, **9 write to
`activity_log` and 8 write nothing** (`users`, `settings`, `prefs`, `drafts`, `digest`, `blockers`,
`auth`, plus read-only `directory`). "Measure every click" cannot rest on remembering to call
`logActivity` at each new call site. The plan makes coverage **structural**:
- Route every mutating server action through a single audit wrapper (extend `lib/state-writer.ts`),
  so writing the row is not optional.
- Add a test that **fails CI if any exported action in `app/actions/` performs a DB mutation without
  emitting an `activity_log` row**, unless the action is on an explicit *non-learnable allow-list*
  (§10.3). This turns "did we log it?" from a review question into a build guarantee.

### 10.2 Full control inventory, by tab

Legend — **logged?**: ✅ writes `activity_log` today · ⚠️ writes but thin (weak before/after) ·
❌ **not logged today (gap)**. **Teaches**: which agent's judgement the signal can sharpen.

Tab names below are the exact labels from `lib/i18n/en.json` / `he.json` (EN / HE), not paraphrases
— note `nav.inbox` renders as **Inbox / אישורים** and `nav.directory` as **Directory / ספקים**.

**Overview / מבט על (`/`)** — `components/overview/*`
| Control | Server action | logged? (`action`) | Teaches |
|---|---|---|---|
| Mark task done/dropped (action-row, tasks-section) | `setTaskStatus` | ✅ `status:<s>` | Prioritization (disposition) |
| Release blocker (action-row) | `releaseBlocker` | ❌ **gap** | Prioritization (a task became actionable) |
| Edit "waiting for" (waiting-editor) | `updateTaskWaiting` | ✅ `set_waiting` | Prioritization (blocked→context) |
| Create task (tasks-section) | `createTask` | ✅ `create` | Triage (what Noa deems worth tracking) |

**My Work / העבודה שלי (`/work`)** — `components/work/*` — the primary prioritization surface (full detail §9.6)
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| 7-verb menu (verb-menu) | `applyWorkVerb` | ✅ `verb:*` | Prioritization (order/disposition) |
| Reopen (reopen-button) | `reopenTask` | ✅ `reopen` | Prioritization (false "done") |
| Undo (verb-menu, task-editor) | `undoWorkVerb` | ✅ `undo` | Meta (self-correction) |
| Edit task details (task-editor) | `updateTaskDetails` | ✅ `edit:details` | Triage/Prioritization (input fix) |
| Refresh priorities (priorities-refresh) | `refreshPriorities` | ✅ `prioritize` | trigger (not a judgement) |
| Add / confirm task (add-action) | `createTaskChecked` / `confirmExistingTask` | ✅ `create` | Triage (dedup judgement) |
| Merge / unmerge duplicate (duplicate-review) | `mergeTasks` / `undoMerge` | ✅ `merge*` | Triage (dedup) |
| Not-a-duplicate (duplicate-review) | `markPairNotDuplicate` | ✅ `dedup_confirmed` | Triage (dedup negative) |
| Add/remove relationship (relation-editor) | `saveRelationship` / `deleteRelationship` | ✅ `create`/`delete` | Prioritization (unblocks graph) |
| **Reorder / pin (MISSING — §9.6, M1.5)** | `pinTask` | ✅ `pin` but **no UI** | Prioritization (★ explicit correction) |
| **Snooze (MISSING — §9.6)** | `snoozeTask` | ✅ `snooze` but **no UI** | Prioritization (defer) |

**Project process / תהליך פרויקט (`/projects`)** — `components/process/*` — teaches the process-inference agent
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Set sub-stage status (substage-row, explorer) | `setSubstageStatus` | ✅ `status:<s>`/`set_status` | Process-inference (phase truth) |
| Activate sub-stage (substage-row, explorer) | `activateSubstage` | ✅ `activate` | Process-inference |
| Reorder sub-stage up/down (explorer) | `moveSubstage` | ✅ `reorder` | Process-inference (sequence) |
| Set dependency (explorer) | `setSubstageDepends` | ✅ `set_depends` | Process-inference (ordering) |
| Add sub-stage (explorer) | `addSubstageTemplate` | ✅ `create` | Process-inference (missing step) |
| Edit sub-stage note (explorer) | `setSubstageNote` | ✅ `set_note` | Process-inference (context) |
| Set decision/scenario (scenario-box) | `setSubstageDecision` | ✅ decision `create` | Process-inference |
| Switch current phase (phase-switcher) | `setCurrentPhase` | ✅ `set_phase` | Process-inference (was the inferred phase wrong?) |
| Edit project summary (summary-editor) | `setProjectSummary` | ✅ `set_summary` | Process-inference (narrative fix) |
| Undo sub-stage change (explorer) | `undoSubstageChange` | ✅ `undo` | Meta |
| Infer phases from emails (infer-button) | `inferPhases` | ⚠️ AI trigger | (produces proposals; the *acceptance* is the signal) |

**Data inbox / קליטת מידע (`/upload`)** — `components/upload/*` — feeds the extraction/triage agent
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Paste an update to process (paste-update) | `processPastedUpdate` | ⚠️ creates proposals | Extraction (what a raw update should become — the human decision lands in Inbox below) |

**Inbox / אישורים (`/inbox`, bell)** — `components/inbox/*` — this is where auto-triage already learns
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Accept / reject / treat a proposal (review-board, bell) | `decideProposal` | ✅ `review:<d>`/`accept:<type>` | Triage (the existing `lib/auto-triage.ts` loop) |
| Run auto-triage now (review-board) | `autoTriagePending` | ✅ `auto_apply`/`auto_ignore` | (agent action — excluded from learning by §5) |
| Undo a decision (review-board) | `undoProposalDecision` | ✅ `undo` | Meta |

**Invoices / חשבוניות (`/invoices`)** — `components/invoices/*` — teaches the invoicing/reconciliation agent
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Advance invoice stage (status-chain) | `advanceInvoice` | ✅ `advance` | Invoicing (stage timing) |
| Edit invoice / links (link-editor) | `updateInvoice` / `undoInvoiceEdit` | ✅ `edit`/`undo` | Invoicing (field corrections) |
| Flag / resolve verification (verify-chip, reconcile-report) | `flag…`/`resolveInvoiceVerification` | ✅ `flag_verify` | Invoicing (what needs a human) |
| Create invoice (add-invoice) | `createInvoice` | ✅ `create` | Invoicing |

**Weekly Review / סקירה שבועית (`/weekly`)** — `components/weekly/*` — teaches weekly synthesis + prioritization
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Set item status (review-board) | `setItemStatus` | ✅ `status:<s>` | Prioritization/Weekly (disposition) |
| Save note / next step (review-board) | `saveItemNote` | ✅ `set_note`/`next_step` | Weekly (context) |
| Set owner / due (review-board) | `saveItemOwnerDue` | ✅ `weekly:owner_due` | Prioritization (deadline/owner input) |
| Snapshot state (review-board) | `setItemSnapshot` | ✅ `snapshot`/`weekly:<s>` | Weekly |
| Save / finalize / reopen review (review-board) | `saveReview`/`finalizeReview`/`reopenReview` | ✅ `save`/`finalize`/`reopen` | Weekly (cycle boundary) |
| Attach recording (review-board) | `attachRecording` | ✅ `attach_recording` | Weekly |
| Prepare review (prepare-button) | `prepareCurrentReview` | ✅ `prepare` | trigger |

**More / עוד — Drafts / טיוטות · Digest / תקציר יומי · Settings / הגדרות · Directory / ספקים · Profile / פרופיל**
| Control | Server action | logged? | Teaches |
|---|---|---|---|
| Approve / dismiss / send a draft (drafts/draft-card) | `setDraftStatus` | ❌ **gap** | **Drafting agent** (which drafts are good) — currently invisible |
| Generate digest (digest/generate-button) | `generateDigest` | ❌ (trigger) | non-learnable |
| Import requirements / stage override / sheet IDs / run ZIMAS (settings/*) | `importRequirements` … `runZimasNow` | ❌ (config) | non-learnable (allow-list) |
| Create / delete app user (settings/users-card) | `createAppUser`/`deleteAppUser` | ❌ (admin) | non-learnable (allow-list) |
| Save profile / avatar / password (profile-forms) | `saveProfile` … | ✅ profile `edit` (partial) | non-learnable (personal) |
| Locale / theme toggle; sign out (chrome) | `setLocale`/`setTheme`/`signOut` | ❌ | non-learnable (allow-list) |

### 10.3 Two gap-lists that fall straight out of §10.2

- **Audit gaps to close (real human judgements currently unlogged) —** `setDraftStatus`
  (approve/dismiss/send an AI-written draft — a *direct verdict on the drafting agent*, and today it
  vanishes) and `releaseBlocker` (a task becoming actionable — a real prioritization input). These
  two are the only *learnable* actions that are unlogged; closing them is small and is the
  prerequisite for their tabs feeding anything.
- **Non-learnable allow-list (measure-optional, never a training signal) —** auth, locale/theme
  prefs, admin user management, settings/config imports, and pure triggers (`generateDigest`,
  `refreshPriorities`, `prepareCurrentReview`, `inferPhases`). "Every click measured" must not mean
  "learn from a theme toggle"; these are explicitly excluded so signal stays clean. This list is
  itself an Open Decision (#10) — the Product Owner owns what is deliberately not learned from.

### 10.4 Routing signals to the right agent (one substrate, many learners)

`activity_log` is already keyed by `entity_type`, which cleanly partitions the signal by which agent
it teaches — so the §3/§9 `priority_feedback` pattern generalises without a redesign:

| `entity_type` | Agent whose thinking it sharpens | Feedback consumer |
|---|---|---|
| `task` (+ `blocker` release) | Prioritization | `priority_feedback` (§4/§9) |
| `proposal`, dedup/merge on `task` | Triage / extraction | `lib/auto-triage.ts` (exists) |
| `project_substage`, `project`, `workstream`, `decision` | Process-inference | new `process_feedback` (later) |
| `draft` (once logged) | Drafting | new `draft_feedback` (later) |
| `invoice` | Invoicing / reconciliation | new `invoice_feedback` (later) |
| `weekly_review*` | Weekly synthesis | new `weekly_feedback` (later) |

Two shapes are possible and are an Open Decision (#9): **one polymorphic** `agent_feedback(agent,
entity_type, entity_id, source_activity_log_id, …)`, or **one table per agent** mirroring
`priority_feedback`. Either way every learner reuses the §5 human-only guard and the §7
inspect/disable/rollback story verbatim — no agent gets a bespoke, unaudited path.

### 10.5 Staged plan for the universal model

The prioritization work in §6 is the first vertical slice; the universal model is the same slice
repeated per agent, each its own authorisation, never all at once.

- **M-U0 — total-coverage instrumentation (safe, no learning yet).** The §10.1 audit choke-point +
  CI test + allow-list; close the two §10.3 gaps (`setDraftStatus`, `releaseBlocker`). Outcome:
  from here on, *every* learnable click is recorded, provably. No behaviour change, no learner reads
  anything yet. Rollback: revert the wrapper; existing logging unaffected.
- **M-U1 — Prioritization slice.** = Milestones 0→3 of §6 (Path A/B). The proving ground.
- **M-U2…n — one further agent at a time** (Triage already has its learner; then Process-inference,
  Drafting, Invoicing, Weekly), each: derive its `*_feedback`, surface confidence read-only, and only
  then consider any automation — each gated by its own Product Owner decision, none assumed here.

### 10.6 Honest scope note

This section **generalises the whole effort beyond prioritization**, which is a larger architectural
commitment than the original brief ("task prioritization only"). Per `AGENTS.md`, that generalisation
is itself a decision the Product Owner must make explicitly (Open Decision #9) — recording it here as
a designed, staged option does not authorise building past M-U0/M-U1. The value of doing the *model*
now is that M-U0's instrumentation is cheap, reversible, and makes the data exist for every future
agent, so no signal is lost while the per-agent decisions are made later.

---

**Next step, if this design is approved:** resolve **Open Decision #8 (Path A vs Path B)** first —
everything downstream depends on it — then update `CURRENT_STATE.md`'s "Execution Memory" entry and
add a `DECISIONS.md` entry recording which path and which milestones/rungs (if any) are authorized,
per `AGENTS.md`'s rule to record decisions before implementation begins — not as part of this draft.
