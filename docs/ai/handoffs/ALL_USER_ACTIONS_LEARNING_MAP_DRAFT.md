# SiteKick — Complete User-Action → Learning Map (Draft Audit)

**Status:** Draft audit / analysis. **Date:** 2026-09-08. **Author:** local Claude Code CLI, at the
Product Owner's request. Companion docs: `LEARNING_MODEL_IMPROVEMENT_DRAFT.md` (design),
`LEARNING_ACTIVATION_PLAN_DRAFT.md` (rollout plan for Noa + team).

**Method:** built by reading the actual source — route pages under `app/(dash)/**`, components under
`components/**`, server actions in `app/actions/*.ts` (which `.from('table')` op runs and which
`logActivity({action})` fires), `lib/state-writer.ts`, and live `activity_log`/`tasks`/`priority_*`
via read-only Supabase queries. Where source did not settle a fact the row says **UNKNOWN**.

---

## Revision 2 (2026-09-08) — verification & correction log

This revision (a) resolved the open UNKNOWNs against code, (b) added the previously-missing
navigation / filter / open / cancel controls (§A.9), and (c) applied seven Product-Owner corrections.
Summary — full "verified / corrected / undecided" report is at the end (§J).

- **Verified against code:** `markPairNotDuplicate` **does** log — indirectly, via `saveRelationship`
  as `action:'save'` with relationship `type='unrelated'` (no dedicated action string; early
  "already-recorded"/noop returns log nothing). `inferPhases` writes **no** trigger audit; it inserts
  an `agent_proposals` row, so the learnable signal is the later *acceptance* in Inbox. `releaseBlocker`
  and `setDraftStatus` confirmed **unlogged**.
- **Critical finding for correction #4:** there is **no impression/"seen" logging anywhere** in the
  codebase, and My Work renders `latestNonEmptyRun` (newest run that has rows), which can differ both
  from the newest DB run and from whatever Noa last actually looked at. **So the link from any action
  to "the recommendation Noa saw" is ASSUMED, not known.** Marked as such throughout.
- **Corrections applied (see inline "⟲ correction N"):**
  1. Pin / drag / snooze are **not** mandatory. Start from existing actions; propose a UI change only
     where a real Noa decision cannot otherwise be expressed.
  2. Completed / Waiting / Delayed / Not-applicable are **business EVENTS**, not automatic proof the
     rank was right/wrong. The **fact** is stored separately from its **interpretation** and the
     interpretation's **confidence**.
  3. Undo / Reopen are **not** blanket "no learning value" — each is linked to its prior event and
     classified as *correction* vs *cancellation* vs *circumstance-change* (new class **META**).
  4. Every feedback row records the recommendation **provenance**; when we can't prove Noa saw it, the
     row is marked `assumed` (or `missing`), never silently attributed to the latest DB run.
  5. The auto-triage `MIN_CLASS_N=5 / 85%` threshold is **not** a sufficient condition to change
     prioritization — a **quality evaluation against the existing deterministic ranker** is required.
  6. Any collection that writes to a `*_feedback` table is a **data change** (migration + RLS +
     idempotency + tests + Preview), even when product behavior is unchanged — not "read-only".
  7. Added §I — a design for a **chat assistant for Noa's comments** (link to task/project; separate
     temporary instruction from general preference; let her correct the interpretation; **no business
     actions in v1**).

---

**Learning-class legend (field 9) — revised per corrections #2/#3:**
- **VERDICT** — an explicit human decision *on an AI proposal* (triage accept/reject, merge/not-dup,
  phase/order correction). The clearest, least-ambiguous feedback.
- **EVENT** — a business action (completed / waiting / delayed / NA / status). A **fact**, *not* proof
  the rank was right or wrong; a *candidate* signal whose interpretation and confidence are stored
  separately (⟲ correction #2).
- **CONTEXT** — input that should improve future runs; not a verdict.
- **OUTCOME** — meaning knowable only after a later event (needs delayed labeling).
- **META** — undo / reopen / cancel: must be linked to the prior event and classified as correction /
  cancellation / circumstance-change; **not** discarded as "no value" (⟲ correction #3).
- **OPS** — operational, navigation, view/filter, config: no learning value in v1.

**Logged legend (field 6):** ✅ writes `activity_log` · ⚠️ writes but thin / indirect · ❌ **not
logged today (gap)** · ❔ UNKNOWN.

---

## A. Complete action inventory by screen

Columns: **Label** · **Component** · **Server action** · **DB write** · **activity_log** · **Actor+TS**
· **Meaning** · **Class**. Actor+TS is ✅ whenever `logActivity` fires (stamps `actor`=email, `created_at`).

### A.1 Overview / מבט על — `/` — `components/overview/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Mark done / dropped | action-row, tasks-section | `setTaskStatus` | `tasks.status` | ✅ `set_status` | ✅ | Task finished / discarded | EVENT |
| Release blocker | action-row | `releaseBlocker` | `blockers.*` | ❌ **gap** | ❌ | Blocker cleared → task actionable | EVENT (unlogged) |
| Edit "waiting for" | waiting-editor | `updateTaskWaiting` | `tasks.waiting_for` | ✅ `set_waiting` | ✅ | Parked on external dependency | CONTEXT |
| Add task | tasks-section | `createTask` | `tasks` (insert) | ✅ `create` | ✅ | Worth tracking | CONTEXT |

### A.2 My Work / העבודה שלי — `/work` — `components/work/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Completed | verb-menu | `applyWorkVerb('completed')` | `tasks.status=done` | ✅ `verb:completed` | ✅ | Finished the task | **EVENT** |
| Not applicable | verb-menu | `applyWorkVerb('not_applicable')` | `tasks.status=dropped` | ✅ `verb:not_applicable` | ✅ | Dropped from the list | **EVENT** |
| Waiting | verb-menu | `applyWorkVerb('waiting')` | `tasks.waiting_for` | ✅ `verb:waiting` | ✅ | Blocked now | EVENT |
| Delayed | verb-menu | `applyWorkVerb('delayed')` | `tasks.due` (pushed) | ✅ `verb:delayed` | ✅ | Deadline moved out | EVENT |
| Scheduled | verb-menu | `applyWorkVerb('scheduled')` | `tasks.due` (set) | ✅ `verb:scheduled` | ✅ | Committed to a date | CONTEXT |
| Sent email | verb-menu | `applyWorkVerb('sent_email')` | `tasks.last_touched` | ✅ `verb:sent_email` | ✅ | Progress touch | OUTCOME |
| Add note | verb-menu | `applyWorkVerb('note')` | `tasks.latest_note` | ✅ `verb:note` | ✅ | Progress note | CONTEXT |
| Reopen | reopen-button | `reopenTask` | `tasks.status=open` | ✅ `reopen` | ✅ | Prior "done" reversed | **META** (link to completion) |
| Undo (verb) | verb-menu, task-editor | `undoWorkVerb` | restores snapshot | ✅ `undo` | ✅ | Reverse a prior action | **META** (classify: correction/cancel/circumstance) |
| Edit details | task-editor | `updateTaskDetails` | `tasks.{description,owner,due,project_id,substage_template_id,workstream_id,process_impact}` | ✅ `edit:details` | ✅ | Fix the task's data | CONTEXT |
| Refresh priorities | priorities-refresh | `refreshPriorities` | `priority_runs`/`task_priorities` | ✅ `prioritize` | ✅ | Manual re-rank trigger | OPS/trigger |
| Add / confirm task | add-action | `createTaskChecked` / `confirmExistingTask` | `tasks` | ✅ `create` / `create_despite_similar` / `dedup_confirmed` | ✅ | New task; or "not a dup" | VERDICT (dedup) |
| Merge duplicate | duplicate-review | `mergeTasks` | `tasks` (both) | ✅ `merge` + `merge:absorb` | ✅ | Two rows were the same | VERDICT (dedup) |
| Unmerge | duplicate-review | `undoMerge` | `tasks` (restore) | ✅ `merge:undo` | ✅ | Merge was wrong | META (reverses merge) |
| Not-a-duplicate | duplicate-review | `markPairNotDuplicate` → `saveRelationship` | `relationships` (type=`unrelated`) | ✅ `save` (⚠️ **indirect**, not a distinct action; noop paths log nothing) | ✅ (when it records) | Genuinely distinct | VERDICT (dedup) |
| Add / remove relationship | relation-editor | `saveRelationship` / `deleteRelationship` | `relationships` + `tasks` | ✅ `save` / `delete` | ✅ | Blocks/relates edit | CONTEXT |
| Reorder / pin *(⟲ correction #1: OPTIONAL, no UI today)* | — none — | `pinTask` | `tasks.manual_priority` | ✅ `pin` but no caller | ❌ (never fires) | Explicit manual re-rank | *(optional; see §B5)* |
| Snooze *(optional, no UI)* | — none — | `snoozeTask` | `tasks.snoozed_until` | ✅ `snooze` but no caller | ❌ | Defer N days | *(optional)* |

### A.3 Project process / תהליך פרויקט — `/projects`, `/projects/[id]` — `components/process/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Set sub-stage status | substage-row, process-explorer | `setSubstageStatus` | `project_substages.status` | ✅ `status:<s>` | ✅ | Ground truth vs inferred phase | EVENT |
| Activate sub-stage | substage-row, explorer | `activateSubstage` | `project_substages` (upsert) | ✅ `activate` | ✅ | Step now in play | CONTEXT |
| Reorder sub-stage | process-explorer | `moveSubstage` | `project_substages.position` | ✅ `reorder` | ✅ | Corrected step sequence | VERDICT (on inferred order) |
| Set dependency | process-explorer | `setSubstageDepends` | `project_substages.depends_on` | ✅ `set_depends` | ✅ | Ordering constraint | CONTEXT |
| Add sub-stage | process-explorer | `addSubstageTemplate` | `substage_templates` (insert) | ✅ `create` | ✅ | Template missing a step | VERDICT (on template) |
| Edit sub-stage note | process-explorer | `setSubstageNote` | `project_substages.note` | ✅ `set_note` | ✅ | Context on the step | CONTEXT |
| Set / clear decision | scenario-box | `setSubstageDecision` | `project_substages.*` | ✅ `set_decision` / `clear_decision` | ✅ | Decision/scenario recorded | CONTEXT |
| Switch current phase | phase-switcher | `setCurrentPhase` | `projects.current_phase` | ✅ `set_phase` | ✅ | Was inferred phase wrong? | VERDICT (on `inferPhases`) |
| Edit project summary | summary-editor | `setProjectSummary` | `projects.summary` | ✅ `set_summary` | ✅ | Narrative correction | CONTEXT |
| Undo sub-stage change | process-explorer | `undoSubstageChange` | restores | ✅ `undo` | ✅ | Reverse a change | META |
| Infer phases from emails | infer-button | `inferPhases` | `agent_proposals` (insert) | ⚠️ **no trigger audit**; creates a proposal (verified) | partial | AI trigger; signal = later acceptance | OPS/trigger |

### A.4 Data inbox / קליטת מידע — `/upload` — `components/upload/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Upload source (file/email/recording/sheet) | upload page | (ingest pipeline) | `documents`, `agent_proposals` | ⚠️ ingest | partial | Bring raw source in | CONTEXT |
| Paste an update | paste-update | `processPastedUpdate` | `agent_proposals` (insert); may `auto_evidence` update `tasks` | ⚠️ `auto_evidence` when auto-attached; else creates proposals | partial | Raw update → proposals | CONTEXT (verdict lands in Inbox) |

### A.5 Inbox / אישורים — `/inbox` + bell — `components/inbox/*` *(auto-triage already learns here)*
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Accept / reject (bell) | notification-bell | `decideProposal` → `decide` | `agent_proposals.state` | ✅ `accept_proposal` / `reject_proposal` | ✅ | Verdict on a proposal | **VERDICT** |
| Treat a proposal (drawer) | review-board | `decideProposal(decision, treatment)` | `agent_proposals.state` (+ `tasks`/`relationships`) | ✅ `review:<decision>`, `review:new_task`, `review:keep_both_linked`, `review:information_only`, `review:<changeType>`, `accept:<type>`, `learn:attribute_project` | ✅ | Full triage treatment | **VERDICT** |
| Run auto-triage now | review-board | `autoTriagePending` | `agent_proposals` | ✅ `auto_apply` / `auto_ignore` (actor `agent:*`) | ✅ (agent) | Agent self-action | OPS (§G self-exclusion) |
| Undo a decision | review-board | `undoProposalDecision` | restores | ✅ `undo` | ✅ | Reverse a triage verdict | META |

### A.6 Invoices / חשבוניות — `/invoices` — `components/invoices/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Advance stage | status-chain | `advanceInvoice` | `invoices.status` | ✅ `advance` | ✅ | Invoice moved a step | OUTCOME |
| Edit invoice / links | link-editor | `updateInvoice` | `invoices.*` | ✅ `edit` | ✅ | Field/link correction | CONTEXT |
| Undo edit | link-editor | `undoInvoiceEdit` | restores | ✅ `undo` | ✅ | Reverse an edit | META |
| Flag / resolve verification | verify-chip, reconcile-report | `flagInvoiceForVerification` / `resolveInvoiceVerification` / `flagReconciledRowForVerification` | `invoices.needs_verification` | ✅ `flag_verify` | ✅ | What needs a human check | VERDICT (reconcile agent) |
| Undo flag | verify-chip | `undoFlagInvoiceForVerification` / `undoFlagReconciledRowForVerification` | restores | ✅ `undo` | ✅ | Reverse a flag | META |
| Create invoice | add-invoice | `createInvoice` | `invoices` (insert), `vendors` | ✅ `create` | ✅ | New invoice | CONTEXT |

### A.7 Weekly Review / סקירה שבועית — `/weekly` — `components/weekly/*`
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Set item status | review-board | `setItemStatus` → `setItemStatusForAdmin` | `tasks.*`, `weekly_review_items` | ✅ `verb:<v>` | ✅ | Disposition of a review item | EVENT |
| Save note / next step | review-board | `saveItemNote` | `weekly_review_items.{weekly_note,next_step}` | ✅ `note` / `next_step` | ✅ | Context on the item | CONTEXT |
| Set owner / due | review-board | `saveItemOwnerDue` | `tasks.{owner,due}` | ✅ `weekly:owner_due` | ✅ | Assign owner / deadline | CONTEXT (deadline input) |
| Snapshot state | review-board | `setItemSnapshot` | `weekly_review_items.*`, `tasks.*` | ✅ `snapshot` / `weekly:<state>` | ✅ | Freeze the item's state | CONTEXT |
| Save subtopic context | review-board | `saveSubtopicContext` | `weekly_review_subtopics` | ✅ `subtopic_context` | ✅ | Group-level context | CONTEXT |
| Save / finalize / reopen review | review-board | `saveReview` / `finalizeReview` / `reopenReview` | `weekly_reviews.status` | ✅ `save_review` / `finalize` / `reopen` | ✅ | Cycle boundary | OPS (finalize = OUTCOME boundary) |
| Attach recording | review-board | `attachRecording` | `weekly_reviews.recording_document_id` | ✅ `attach_recording` | ✅ | Link a recording | OPS |

### A.8 More / עוד — Drafts / טיוטות · Digest / תקציר יומי · Settings / הגדרות · Directory / ספקים · Profile / פרופיל
| Label | Component | Server action | DB write | activity_log | Actor+TS | Meaning | Class |
|---|---|---|---|---|---|---|---|
| Approve / dismiss / send draft | drafts/draft-card | `setDraftStatus` | `drafts.status` | ❌ **gap** | ❌ | **Verdict on an AI draft — invisible today** | VERDICT (drafting) — UNLOGGED |
| Generate digest | digest/generate-button | `generateDigest` | (produces digest) | ❌ | ❌ | Manual trigger | OPS |
| Import requirements / stage override / sheet IDs / run ZIMAS | settings/* | `importRequirements` … `runZimasNow` | config / external | ❌ | ❌ | Configuration | OPS (allow-list) |
| Create / delete app user | settings/users-card | `createAppUser` / `deleteAppUser` | auth/users | ❌ | ❌ | Admin | OPS (allow-list) |
| Save profile / avatar / password | profile/profile-forms | `saveProfile` … | `profiles.*` | ✅ profile `edit` (partial) | partial | Personal | OPS (personal) |
| Directory (view suppliers) | directory page | `listUsers` (read-only) | — | — | — | Reference | OPS |
| Locale / theme; Sign out | chrome | `setLocale` / `setTheme` / `signOut` | prefs / session | ❌ | ❌ | UI prefs / auth | OPS (allow-list) |

### A.9 Navigation / view / filter / disclosure controls — client-only, NOT logged *(new; per Codex gap-check)*

These are interactive but do **not** call a server action and write **nothing** to `activity_log`.
Grouped (identical controls collapsed). All **OPS / client-only** in v1 — inclusion here does **not**
imply we collect or learn from them. They are listed because one *category* (impression/what-she-saw)
is the missing input behind ⟲ correction #4, and could optionally be instrumented later.

| Category | Examples (across screens) | Class | Note |
|---|---|---|---|
| **Top-nav navigation** | Overview / My Work / Project process / Data inbox / Invoices / Weekly / More; Sign-out | OPS | pure routing |
| **Entity open / drill-in** | open a project chip, `Investigate project →`, `/projects/[id]`, `Open invoice ↗`, `Open in Action Register`, `Review proposed changes →`, `Details ›` | OPS | *(candidate impression signal — see #4)* |
| **View / mode toggles** | My Work view pills (Today / Morning plan / Everything / Project work / Administrative); Invoices *Invoices / Payment Summary*; Weekly *Sunday draft / Monday presentation*; Overview *Portfolio intelligence* tabs (Time&blockers / Budget / Consultants / Forecast) | OPS | which view she works in *is* weak context |
| **Filters** | Invoices status tabs (All open / Received / For approval / Approved / On hold); *Advanced filters*; My Work KPI cards used as filters (Today / Blocking / Follow-ups / Waiting / All / Completed) | OPS | filter chosen = what she's focusing on |
| **Disclosure expand/collapse** | project card +/−, *Inactive projects*, *How this works*, sub-topic accordions, drawer open | OPS | |
| **Cancel / close without save** | close a modal/drawer, dismiss a menu, cancel an edit | META-adjacent | a *cancel* is a (weak) "not this" — not collected in v1 |
| **File pickers / uploads UI** | Data inbox source-type tabs, Choose file / drop, Project dropdown | OPS | the resulting ingest is CONTEXT (§A.4) |

**Inventory completeness note:** §A.1–A.8 cover every control that reaches a server action / DB write;
§A.9 covers the remaining client-only controls by category. If a specific control is later found
missing, add it here rather than re-deriving the map.

---

## B. Candidate feedback actions (deep fields 10–18) — fact ≠ interpretation (⟲ correction #2)

For each: **10** linkable recommendation + **provenance** · **11** context snapshot · **12** *candidate*
interpretation + **confidence** (stored separately from the fact) · **13** delayed outcome · **14**
confounders · **15** target agent · **16** proposed event (fact fields + separate interpretation
fields) · **17** safe for automatic learning? · **18** review/rollback.

> **Storage rule (⟲ #2):** the `*_feedback` row stores the **fact** (which action, on which task, at
> what proposed rank) as immutable columns, and the **interpretation** (`inferred_signal`,
> `confidence`, `interpreter_version`) as *separate, re-computable* columns — never conflated. Changing
> how we read a signal must never require rewriting the recorded fact.

> **Provenance rule (⟲ #4):** every row carries `recommendation_provenance ∈ {confirmed_seen,
> assumed_latest_run, missing}`. Today there is **no impression logging** and My Work shows
> `latestNonEmptyRun`, so forward-capture rows are at best `assumed_latest_run`; `confirmed_seen`
> requires the optional impression-logging in §F. Never record a link as fact when it is assumed.

### B1. Completed — `applyWorkVerb('completed')`
- **10** `task_priorities` row for this task in the latest run *before* the action; **provenance
  `assumed_latest_run`** (we cannot prove she saw it).
- **11** `run_id, global_rank, urgency, reason, score`; ranks/tiers of other open tasks; blocked/snoozed peers; date/weekday.
- **12** *Fact:* task completed. *Candidate interpretation:* if completed out of rank order → weak
  "under-ranked" signal on the one done first; **confidence low** and heavily confounded (§14). Stored, not acted on.
- **13** None — completion is the terminal outcome.
- **14** Quick-win bias; capacity (didn't reach #2 ≠ #2 wrong); a higher peer blocked.
- **15** Prioritization.
- **16** `priority_feedback { run_id, task_id, event:'completed', proposed_global_rank, proposed_urgency, source_activity_log_id, recommendation_provenance, decided_by, decided_at // fact | inferred_signal, confidence, interpreter_version // interpretation }`.
- **17** No — a single completion is a fact, not a rule; see §H quality-eval gate (⟲ #5).
- **18** Collection is a **data write** (⟲ #6). `undoWorkVerb`/`reopen` must void the row's interpretation (not delete the fact).

### B2. Not applicable — `applyWorkVerb('not_applicable')`
- **10/11** As B1 + task `source`/`category`.
- **12** *Fact:* task dropped. *Candidate:* if high-tier, "wrong to surface" — but NA is overloaded
  (irrelevant vs. later vs. cleanup); **confidence low** alone; may indict extraction, not ranking.
- **13** None. **14** overloaded meaning; valid task killed by external change.
- **15** Prioritization **and** extraction. **16** `priority_feedback{ event:'not_applicable', … }`. **17** No. **18** As B1.

### B3. Waiting — `applyWorkVerb('waiting')`
- **10/11** As B1 + `waiting_for` text.
- **12** *Fact:* now blocked. *Candidate:* if high-ranked, "over-ranked non-actionable" — but often
  reflects new external reality the ranker couldn't know; **confidence low**.
- **13** later release+completion tells if it should've been high once unblocked. **14** blocker just arrived.
- **15** Prioritization. **16** `priority_feedback{ event:'waiting', … }`. **17** No. **18** As B1.

### B4. Delayed / Scheduled — `applyWorkVerb('delayed'|'scheduled')`
- **10/11** As B1 + old/new `due`, delta.
- **12** *Fact:* due date changed. *Candidate:* delayed on high-urgency = deadline assumption may have
  been wrong — but a client-driven reschedule is identical from the event alone; **confidence very low**.
- **13** whether it becomes urgent and is done on time. **14** external reschedule vs. deprioritizing.
- **15** Prioritization. **16** `priority_feedback{ event:'delayed'|'scheduled', due_before, due_after, … }`. **17** No. **18** As B1.

### B5. Reorder / Pin — `pinTask` *(⟲ correction #1: OPTIONAL, no UI today; do NOT assume we add it)*
- The strongest *explicit* correction, but **not required**: B1–B4 already let Noa express her
  decisions through existing actions, and completion-order *inference* yields a ranking signal without
  a new control. Add a pin/reorder UI **only if** evaluation shows a real preference Noa cannot express
  any other way (e.g. "this is #1 today" with the task not yet actionable). If added later:
- **10** latest run + pin target (provenance as above). **12** *Fact:* explicit manual order. *Candidate:*
  high-value "should be here, not there", **confidence high** but still one instance, not a rule.
- **16** `priority_feedback{ event:'reordered', to_manual_priority, from_global_rank, … }`. **17** No
  (gated; see §H). **18** `pinTask(taskId,null)` reverts → META `reverted`, never counted as confirm.

### B6. Reopen / Undo — `reopenTask` / `undoWorkVerb` *(⟲ correction #3: META, not "no value")*
- **10** the prior event this reverses (its `source_activity_log_id`) + that task's last rank.
- **12** *Must be classified*, not discarded: **correction** (the prior action was wrong — retract its
  interpretation), **cancellation** (undo a mis-click — neutral), or **circumstance-change** (reopened
  because scope grew — a *new* fact, not a retraction). The classifier reads the time gap, the fields
  changed, and any note.
- **15** Prioritization data-hygiene (a reopen must void B1's interpretation for that task).
- **16** `feedback_meta{ reverses_activity_log_id, kind:'correction'|'cancellation'|'circumstance', … }`.
- **17** No. **18** Inherent — this *is* the correction/rollback mechanism.

### B7. Triage decisions (Inbox) — `decideProposal` / accept / reject / treat
- **10** the `agent_proposals` row — **provenance `confirmed_seen`** (she opened the proposal to decide it; this is the one place the link is *known*, not assumed).
- **12** *VERDICT* on extraction/triage: accept=positive, reject/ignore=negative, per `proposalClass`. **Loop already exists** (`lib/auto-triage.ts`).
- **15** Triage/extraction (not prioritization). **16** already implemented. **17** already gated (its own domain; ⟲ #5 does not relax it). **18** `undoProposalDecision`.

### B8. Matching / dedup — `mergeTasks` / `undoMerge` / `confirmExistingTask` / `markPairNotDuplicate`
- **10** the task pair (+ any dedup proposal). **12** VERDICT on matching: merge="same", not-duplicate/`create_despite_similar`="distinct".
- **16** `match_feedback{ pair, verdict:'same'|'distinct', source_activity_log_id }`. **Note (verified):**
  `markPairNotDuplicate` logs only *indirectly* as `save` (relationship `type='unrelated'`) and not on
  noop paths — to isolate the "distinct" signal, filter relationships by `type='unrelated'` or add a
  dedicated `action:'not_duplicate'` (§F). **17** No. **18** `undoMerge`.

### B9. Release blocker — `releaseBlocker` *(❌ unlogged — instrument first, §F)*
- **10** blocker → blocked task(s) → their ranks. **12** *Fact:* a task became actionable → its next-run
  rank should rise; if not, a candidate "miss". **15** Prioritization. **17** No; prerequisite: log it. **18** n/a until logged.

---

## C. Indirect context signals (improve future runs; not verdicts)

Change the *inputs* the agents reason over; capture as versioned context, never scored as right/wrong.
`edit:details`, `createTask`/`createTaskChecked`, `verb:note` / weekly `note`/`next_step`,
`saveRelationship`/`deleteRelationship`, process edits (`activate`, `set_depends`, `set_note`,
`set_decision`, `set_summary`, `addSubstageTemplate`), weekly `owner_due`/`snapshot`/`subtopic_context`,
`createInvoice`/`updateInvoice`, Data-inbox ingest.
**Rule:** snapshot before/after of changed fields (most already store `before_json`/`after_json`) + `entity_id` + run/phase in effect.

---

## D. Outcome signals (labeled only after a later event)

`completed` (terminal for its own rank), `advance` invoice (timeliness vs due), `verb:sent_email`
(paired with a later reply), `finalize` review (items judged across next week), `snapshot`/`weekly:<state>`.
**Rule:** written immediately, **labeled later** by a scheduled join to the subsequent event. That
scheduled labeler is itself a **data writer** (⟲ #6) — migration + idempotency + tests.

---

## E. Operational-only actions (allow-listed as never-learn)

Navigation/view/filter/disclosure (§A.9), triggers (`refreshPriorities`, `prepareCurrentReview`,
`generateDigest`, `inferPhases`), agent self-actions (`autoTriagePending`, §G self-exclusion), cycle
mechanics (`saveReview`, `attachRecording`), Settings/config, admin, Profile, prefs, Directory.
**Note (⟲ #3):** `undo*`/`reopen` are **removed** from this list — they are META (§B6), not OPS.

---

## F. Missing instrumentation & proposed event links

| Action | Today | Fix | Proposed event |
|---|---|---|---|
| `releaseBlocker` | ❌ unlogged | add `logActivity({entity_type:'blocker', action:'release_blocker', before/after})` | `priority_feedback{event:'unblocked'}` |
| `setDraftStatus` | ❌ unlogged | add `logActivity({entity_type:'draft', action:'draft:'+status})` | `draft_feedback{verdict}` |
| `markPairNotDuplicate` | ⚠️ logs only as `save`(type=`unrelated`); noop paths silent | add `action:'not_duplicate'` for an unambiguous signal | `match_feedback{verdict:'distinct'}` |
| **Impression / "what Noa saw" (⟲ #4)** | ❌ none exists | *optional:* on My Work load, log the rendered `run_id` (+ that it was shown) | upgrades feedback `recommendation_provenance` → `confirmed_seen` |
| **Verb → run linkage** | ✅ logged, not linked to `task_priorities` | forward-capture: snapshot current `run_id/global_rank/urgency` into `priority_feedback` at write time | `priority_feedback` |

**Structural fix:** route every mutating action through one audit wrapper + a CI test that fails if an
`app/actions/*` mutation writes no `activity_log` row (minus the §E allow-list).
**Pin/snooze UI is intentionally NOT in this table** (⟲ #1) — optional, only if §B5's condition holds.

---

## G. Data-quality & false-positive risks

1. **Reconstruction sparsity (verified):** only 80/301 historical actions sit on a prior rank; the
   completion-order signal yields ~7 usable pairs. History is a seed, not a training set.
2. **Provenance is assumed, not known (⟲ #4):** no impression logging; My Work shows `latestNonEmptyRun`.
   Treat every forward-capture link as `assumed` until impression-logging exists.
3. **Fact ≠ interpretation (⟲ #2):** a business event is not proof; store interpretation + confidence separately and re-computably.
4. **Capacity confound**, **blocked/availability confound**, **quick-win bias** — all lower confidence of EVENT signals.
5. **Self-reinforcement:** exclude every `agent:*`/`system:*` row (existing `auto-triage.ts:103` guard); 142 `accept:task_update` in-window are agent actions.
6. **Anchoring/contamination:** showing confidence in the UI can bias Noa's later actions.
7. **Single-subject overfit:** learns *Noa*; per-user weights if a second operator appears.
8. **META retraction (⟲ #3):** an undo/reopen must void the prior interpretation or positives double-count.
9. **Threshold ≠ quality (⟲ #5):** hitting `MIN_CLASS_N=5/85%` proves *consistency of a class*, not that
   changing the *ranker* improves it — a held-out quality evaluation vs the current deterministic ranker is required.

---

## H. Recommended implementation phases

Every phase that writes a `*_feedback` row is a **data change** (⟲ #6): migration, RLS, idempotency
(no double-count on retries), tests, and Preview validation of the *writes themselves* — "product
behavior unchanged" does **not** make it read-only.

- **Phase 0 — coverage instrumentation.** Audit choke-point + CI test; close `releaseBlocker` &
  `setDraftStatus`; add `not_duplicate`. No feedback table yet.
- **Phase 1 — forward-capture (DATA CHANGE).** Add `priority_feedback` (migration + RLS); snapshot
  run/rank + `recommendation_provenance` on every task EVENT; store fact and interpretation separately;
  nothing *reads* it yet. Tested + Preview-validated before Production.
- **Phase 2 — deterministic read-only surfacing + quality harness.** Compute per-class stats; build the
  **offline evaluation** that measures a proposed ranking adjustment against the current deterministic
  ranker on held-out `priority_feedback` (⟲ #5). Surface confidence read-only.
- **Phase 3 — gated behavior change.** Only a proposed adjustment that *wins* the Phase-2 quality
  evaluation, one rule at a time, PO-approved, reversible.
- **Phase 4+ — per-agent extension** (triage exists; then matching, process, drafting, invoicing).
- **Optional (any time):** impression-logging (§F) to upgrade provenance; pin/reorder UI **only** if §B5 holds.

---

## I. Chat assistant for Noa's comments (design only — ⟲ correction #7)

A conversational surface where Noa can say things in her own words ("this one's urgent because the
city call is Thursday", "generally I don't chase Crest invoices until month-end"). Design for v1:

1. **Always link to an entity.** Every comment is captured against a `task`, `project`, `invoice`, or
   a `priority_run` row — never floating. If Noa doesn't specify, the assistant asks which one (or
   attaches to the item currently open). Stored as `comment{ entity_type, entity_id, text, created_at, actor }`.
2. **Classify intent, don't act.** The assistant labels the comment as **temporary instruction**
   ("do this first *today*") vs **general preference** ("*always* deprioritize X") vs **context/fact**
   ("the deadline moved") — because these feed learning completely differently (a one-off must never
   become a standing rule). Intent + confidence stored separately from the text (same fact/interpretation
   split as §B).
3. **Let Noa correct the interpretation.** The assistant shows back what it understood ("I read this as
   a general preference to rank permit-blockers above admin — is that right?") and Noa can confirm/fix.
   The correction is itself a high-value labeled signal.
4. **No business actions in v1.** The assistant does **not** complete tasks, change ranks, edit due
   dates, send anything, or write to business tables. It only records comments + interpretations
   (a `comment_feedback` data write — subject to ⟲ #6). Acting on comments is a later, separately-authorized phase.
5. **Feeds prioritization as CONTEXT/preference, gated.** A confirmed *general preference* becomes a
   candidate ranker input only through the Phase-2 quality evaluation (⟲ #5) — never applied directly
   from one message.

**Open question for PO:** where does this live (a global chat, or per-item comment box)? and does the
assistant get read access to the entity's context to interpret well?

---

## J. Final verification report — verified / corrected / undecided

**Verified against code (this revision):**
- `markPairNotDuplicate` logs indirectly as `save` (relationship `type='unrelated'`); noop paths silent.
- `inferPhases` writes no trigger audit; creates an `agent_proposals` row.
- `releaseBlocker`, `setDraftStatus` unlogged (gaps confirmed).
- No impression/"seen" logging exists; My Work renders `latestNonEmptyRun`.
- §A.1–A.8 server-action rows (tables, ops, `action` strings) confirmed from function bodies.

**Corrected (per PO decisions #1–#7):** pin/snooze demoted to optional (#1); Completed/Waiting/Delayed/
NA reclassed EVENT with fact/interpretation/confidence split (#2); Undo/Reopen reclassed META with
correction/cancel/circumstance (#3); `recommendation_provenance` added, links marked assumed (#4);
`MIN_CLASS_N/85%` removed as a sufficient prioritization gate, quality-eval added (#5); feedback writes
framed as data changes (#6); chat-assistant design added (#7); §A.9 navigation/filter/open/cancel added.

**Still undecided (needs PO):**
- Whether/when to add impression-logging (upgrades provenance from assumed→confirmed).
- The exact quality-evaluation bar in Phase 2 (what "wins vs current ranker" means numerically).
- Scope beyond prioritization (matching/process/drafting/invoicing) and order.
- "Ignored"/capacity-normalization definitions; per-person data retention.
- Chat-assistant placement (global vs per-item) and its read scope.
- Whether full auto rank-setting is ever in scope (contradicts the "never trust the model's rank directly" principle).

---

**Reminder:** audit/design. The map is the agreed basis for implementation; each build phase (esp. any
`*_feedback` data write) proceeds only per §H, with tests + Preview before Production.
