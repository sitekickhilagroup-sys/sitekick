# SDD ledger — plan: docs/superpowers/plans/2026-08-26-qa-fix-work-plan.md

Branch: main (Dor explicitly authorized per-task commits directly on main, 2026-08-26).
Scope: code phases only — A, C, D, E1–E6, F. Phases B, E7 (data passes) excluded by Dor: they need
his CSV approval + the source Excel + Noa's adjudication. G1 (live browser retest) stays with the
controller after the final review.
Spec: both QA HTML docs in the repo's parent dir + docs/superpowers/plans/2026-08-24-noa-corrections-analysis.md.

## Pre-flight conflict scan

### Cross-task pairs (shared file or interface)

| Tasks | Produces → Consumes | Finding |
|---|---|---|
| A1, A2, A3, A5, C2 | all edit `app/(dash)/(standard)/work/page.tsx` | No logical contradiction; sequential dispatch. A1+A2 are same-shape display-only edits → batched. |
| A4 → A5 | `projects.business_rank` (0015) | A5 cannot run before A4. Plan's ordering note ("A-tasks independent") is wrong. |
| A4 → A6 | `substage_template_id`, `workstream_id` (0015) | Same gap. |
| A4 → C2 | `tasks.substage_template_id` (0015) | Same gap. |
| A4, A6, A7 | all edit `app/actions/work.ts` (undo whitelist) + `app/actions/tasks.ts` | Sequential; A4→A6→A7 avoids re-editing the same whitelist twice. |
| A6 → C3, C4, E2 | `components/work/saved-chip.tsx` (`SavedChip`) | A6 must precede all three. Plan states only "A6 before C4". |
| A6 → C4 | `updateTaskDetails`, `TaskDetailsPatch`, `TaskEditor` | Stated in plan. Consistent. |
| A6 → B1 | audited-update shape | B1 out of scope this run. No action. |
| A7 ↔ D1 | `syncTaskIntoOpenReview` filters `status='preparing'`; D1 adds `'final'` | Compatible: finalized reviews are correctly skipped. No conflict. |
| D1 → D2 | `weekly_review_items.next_step` (0016) | Stated in plan. Consistent. |
| E2 ↔ E3 | BOTH claim creation of `lib/invoice-rules.ts` | Conflict. |
| E2 → E5 | E2 rewrites `link-editor.tsx`; E5 appends to it | Sequential; E2 first. Consistent. |
| E4 → E6 | `invoices.needs_verification` (0017) | Stated in plan. Consistent. |
| E6 ↔ E4 | E6's "Flag Verify" writes `needs_verification` | Same column, same owner. Consistent. |
| C1 → C2 → C3 → C4 → C5 | all edit `components/process/process-explorer.tsx` | Sequential only. No contradiction. |

### Per-task internal consistency

| Task | Tests vs code, files created vs later touched | Finding |
|---|---|---|
| A1 | display-only, no test beyond i18n parity | Consistent. |
| A2 | link target `/invoices?tab=payment_summary` matches page's `sp.tab` / `payment_summary` key | Consistent (verified in code). |
| A3 | test asserts `findDuplicatePairs`; code implements it in `lib/dedup.ts` | Consistent. |
| A4 | migration FKs `substage_templates(id)`, `workstreams(id)` | **Verified against 0003_process_model.sql — both tables exist under those names.** Named unknown resolved pre-flight. |
| A5 | `mk()` helper includes the 3 new 0015 fields; needs A4's `lib/types.ts` change | Consistent given A4-first ordering. |
| A6 | `DETAIL_KEYS` ↔ `TaskDetailsPatch` keys | Consistent (8 keys, same names). |
| A7 | snapshot column set deliberately left to be read from the prepare insert | Consistent — the task's Step 1 names the file to read. |
| C2 | `ExplorerTask.substage_template_id` needs 0015 | Consistent given A4-first. |
| C5, F1 | pure "browser walk" tasks — a subagent's findings would be unverifiable and may produce an empty diff | Conflict with the review loop (needs a diff). |
| D3 | "verify, commit only if changed" — likely zero diff | Same conflict. |
| D6 | writes tests → real diff | Consistent. |
| E6 | `reconcile()` re-reads the source Excel; needs a real file to run against | Test-only verification this run; live run belongs to E7 (out of scope). |

### Rulings (pre-flight)

- **Ruling: A4 runs first, before A5, A6 and C2** — 0015 supplies `business_rank`,
  `substage_template_id`, `workstream_id`, which all three consume; the plan's "A-tasks are
  independent" note is a plan defect. Cost if wrong: none — a stricter order than needed.
- **Ruling: A6 runs before C3, C4 and E2** — it creates the shared `SavedChip`. Cost if wrong:
  those three each re-invent the chip, producing three near-identical components.
- **Ruling: A4 → A6 → A7 for the `app/actions/work.ts` undo whitelist** — three tasks edit the
  same list. Cost if wrong: merge churn in one file, no behavior change.
- **Ruling: E2 and E3 merge into ONE dispatch** — both claim `lib/invoice-rules.ts`, both change
  the same action and the same editor; splitting them means the E2 implementer must stub a
  function E3 immediately rewrites. Cost if wrong: one larger review surface for the invoice
  editor instead of two small ones.
- **Ruling: A1 and A2 merge into ONE dispatch** — two small display-only edits to the same file
  plus i18n; the skill's batching rule applies. Cost if wrong: one combined diff to review.
- **Ruling: D3 folds into the D2 dispatch as a verification step** — it is "verify the counter's
  scope, fix the label only if wrong" and would otherwise be a dispatch with an empty diff, which
  the review loop cannot gate. Cost if wrong: the counter check gets slightly less isolated
  attention.
- **Ruling: C5 and F1 run as static-verification tasks** — each subagent checks its checklist
  against the code and fixes what is provably wrong there, producing a real diff; the live
  browser walk stays with the controller at G1. Cost if wrong: a purely visual defect that only
  shows in a running browser survives to G1, where it is caught anyway.
- **Ruling: implementers commit per task, directly on main** — Dor was asked and chose exactly
  this, overriding CLAUDE.md's default "no auto-commit / prefer a feature branch". Cost if
  wrong: no clean revert point; recovery is `git revert` per task commit, which the ledger names.
- **Ruling: E6 ships with unit tests only this run** — its live run needs the source Excel, which
  belongs to the excluded E7. Cost if wrong: the reconciliation report is unproven against real
  data until Dor supplies the file.

### Execution order

A4 · A1+A2 · A3 · A5 · A6 · A7 · C1 · C2 · C3 · C4 · C5 · D1 · D2+D3 · D4 · D5 · D6 · E1 · E2+E3 · E4 · E5 · E6 · F1

---

## Progress

Task A4: review — spec ✅ (Steps 1-4,6), Step 5 (live browser) not done: migration unapplied + auth wall.
Task A4: Ruling: every task's "browser verification" step defers to G1 — migrations are applied manually by Dor
  and /work is behind auth, so no implementer can run them. Cost if wrong: a purely visual defect survives to G1,
  where the live walk catches it anyway.
Task A4: quality — Needs work. Important: `work.msg.note` toast still says the note is passive "evidence; the agent
  proposes" while A4 makes it force-write `tasks.latest_note` and render on the row (en.json:571, he.json:571).
Task A4: minor (deferred): no truncate on the new note line (work-table-row.tsx:87) — inconsistent with the
  `task.source` line below it which truncates. Inherited from the plan's own snippet.
Task A4: minor (deferred): `applyWorkVerb` writes audit `after: { note: input }` while the column is `latest_note`
  (app/actions/work.ts:28) — cosmetic; undo reads `before_json` only, nothing renders `after_json`.
Task A4: fix round 1/5 (1 addressed, 0 open; commits a0fa571..cd136b6)
Task A4: complete (commits d3cb175..cd136b6, review clean; 2 minors deferred above)

Task A1+A2: review — spec ✅ both tasks, no scope creep. Reviewer independently confirmed card count now
  provably equals rendered rows (same filterView call at both sites) and the ?tab=payment_summary target.
Task A1+A2: quality — Needs work. Important: the two Payment Run footer links are bare adjacent inline-flex
  siblings in a space-y container — they render on one line ~8px apart (work/page.tsx:388-393).
Task A1+A2: minor (deferred): link className + arrow markup duplicated verbatim between the two footer links
  (work/page.tsx:391-393) — plan-mandated snippet, but now two places to keep in sync.
Task A1+A2: minor (deferred): he.json:388 "פתח Payment Summary" uses an imperative while sibling labels do not.
Task A1+A2: fix round 1/5 (1 addressed, 0 open; commits 37cbd82..ecadc6d)
Task A1+A2: complete (commits cd136b6..ecadc6d, review clean; 2 minors deferred above)

Task A3: review — spec ✅ (test-first order confirmed from real failure output; strings byte-verified incl. the
  U+200F RLM; en/he both 577 keys). Quality: Approved.
Task A3: Ruling: the reviewer's Important finding — `findDuplicatePairs` can miss a pair inside a 3+-way cluster
  because `matchExistingTask` returns only its single best match — stands as-is. It is plan-mandated (the brief's
  own Step 2), and the banner is a heuristic warning, not an exhaustive dedup report: it can under-report but can
  never fabricate a duplicate, so it degrades safely. Exhaustive duplicate resolution is Phase B1, which Dor
  excluded from this run pending his CSV approval. Cost if wrong: the banner undercounts on a 3-way cluster, so
  Dor sees "2 pairs" where 3 exist — visible in B1's report anyway.
Task A3: minor (deferred): both new dedup tests use exactly 2 elements — no coverage of 3+ clusters, the
  no-double-report property, or empty/singleton inputs (lib/dedup.test.ts:96-114).
Task A3: minor (deferred): O(n^2) with re-tokenization per outer iteration, no memoization; fine at ~110 rows on
  a force-dynamic page, would need caching an order of magnitude up (lib/dedup.ts:68-78).
Task A3: complete (commits ecadc6d..0e68f5a, review clean)

Task A5: review (opus) — spec ✅ all 7 steps; the 3 brief tests committed verbatim, no weakened assertions;
  project_stages correctly inside the existing Promise.all; count/list consistency verified clean (A1's bug class
  not reintroduced); judgment call #1 (skip in-group scoreOf re-sort) independently verified correct.
Task A5: quality — Needs work, 3 Important:
  (a) rank badges numbered before the group re-sort, so Today reads 1,2,7,3,4,5,6 (page.tsx:187 vs :143-146);
  (b) whyNowFor uses raw priority==='critical' instead of isBlockingTask(), contradicting the row's own Blocking
      chip and 0013's stated impact-over-heuristic precedence (page.tsx:202);
  (c) with businessRankByProject empty — the CURRENT state, 0015 unapplied — projectOrder collapses to arbitrary
      row order and can drop a whole project's primary blocker (priority.ts:195-196).
Task A5: minor (deferred): +15 overdue bump in todayScore stacks on scoreTask's +35 undocumented (priority.ts:172).
Task A5: minor (deferred): two "unranked" sentinels — `?? 99` (priority.ts:196) vs `Infinity` (page.tsx:145).
Task A5: minor (deferred): IMPACT_WEIGHT exported per the brief's Interfaces but never imported by the page.
Task A5: minor (deferred): no test for the fill-dedup path or a non-default `limit`.
Task A5: fix round 1/5 (3 addressed, 0 open; commits 0c052ea..5fe852c)
Task A5: complete (commits 0e68f5a..5fe852c, review clean; 4 minors deferred above)

Task A6: review (opus) — spec ✅ (8 DETAIL_KEYS match, 6 impact values, queries in the existing Promise.all,
  SavedChip a genuine extraction, RTL clean, parity holds). Judgment calls 1 and 2 verified correct.
Task A6: quality — Needs work. CRITICAL: the editor's Phase select writes a canonical phase_key into
  `tasks.stage_key`, which 0003 documents as the LEGACY stage namespace (feasibility/entitlements/rti/...).
  Consequences traced: contradictory "Plan Check / Planning" row text, loss of priority.ts's +25 current-stage
  bonus, dedup's -0.15 penalty firing against real twins, weekly stageLabels miss, process.ts mis-bucketing.
  Compounded by the select rendering a fabricated "—" for legacy-tagged tasks and `disabled={!stageKey}` making
  the corrupting write the only path to setting a sub-stage.
Task A6: Ruling: this is a PLAN defect, not an implementation one — the plan assumed `tasks.stage_key` holds
  phase keys; no column on `tasks` was ever the task's phase (phaseLabelFor has always derived it). Fix:
  (1) drop `stage_key` from DETAIL_KEYS and TaskDetailsPatch — the editor never writes that column;
  (2) Phase becomes a non-persisted filter that narrows the Sub-stage list, initialized from the DERIVED phase;
  (3) the phase is persisted implicitly through `substage_template_id` (0015 gave us the FK);
  (4) phaseLabelFor gains a first branch resolving phase from the substage template, which also closes the
  "Phase column won't reflect the change" gap the implementer raised.
  Cost if wrong: a task with no applicable sub-stage cannot be given a phase directly — covered today by the
  project's current_phase_key fallback, and C2/C4 add sub-stage assignment on the process page too.
Task A6: also open — Important: editor sends all 8 keys so Save reverts concurrent writes (task-editor.tsx:66-75);
  Important: no server-side cross-field validation (workstream belonging to project) on an untrusted client
  (tasks.ts:291-298); Important: `disabled` conceals real values (task-editor.tsx:132,141);
  Minor-but-fixing-now: VerbMenu trigger vanishes behind the editor popover (verb-menu.tsx:50-52) and
  undoWorkVerb omits revalidatePath('/weekly') (work.ts:56). Plus: extract write-shaping into lib/ and test it —
  no existing test touched updateTaskDetails, which is why the Critical shipped.
Task A6: minor (deferred): no focus trap/autofocus; invalid HTML nesting <p>/<div> inside <span>
  (task-editor.tsx:57,87,130).
Task A6: fix round 1/5 (1 Critical + 3 Important + 2 minor + test-coverage gap all addressed, 0 open;
  commits 1737fda..41bf3eb). Write-shaping extracted to pure lib/task-details.ts with 19 tests; server-side
  cross-field integrity now rejects a workstream that does not belong to the task's project.
Task A6: Ruling: the residual the re-reviewer flagged as urgent — work-table-row.tsx:104 / page.tsx:573 derive
  `stageLabel` from legacy `task.stage_key` only, so changing Sub-stage WITHIN the same phase changes nothing
  visible on the row — folds into C2's dispatch. C2 already edits both of those files for its deep-link
  highlight and owns `substage_template_id` end to end, so wiring the label there costs nothing extra and
  splitting it would mean touching the same two files twice. Cost if wrong: a same-phase sub-stage change stays
  invisible on My Work until C2 lands, two tasks away.
Task A6: complete (commits 5fe852c..41bf3eb, review clean; 2 minors deferred above)

Task A7: review — spec ✅ all steps. Reviewer independently confirmed the brief was WRONG twice: 0005 has no
  title/project/owner snapshot columns (they join live from tasks), and `.order('week_start')` names a column
  that does not exist (correct code uses meeting_date). Implementer reused buildReviewItems rather than
  hand-copying, so a synced row is genuinely identical to a prepared one.
Task A7: quality — Needs work. CRITICAL: syncTaskIntoOpenReview never applies prepareCurrentReview's
  `projects.active` gate (weekly.ts:179-199 vs :76-90), so a leftover open task on an inactive project (Flicker)
  re-enters the live review on any edit — and prepare's upsert never deletes stale rows, so it persists through
  future Prepare runs. Resurrects the exact bug `onActiveProject` was added to fix.
Task A7: Ruling: the status filter changes from `.eq('status','preparing')` to "any state still open for editing"
  — today `preparing` + `saved`. The plan's D1 Step 4 ("A7 targets only status='preparing'") conflated saved with
  frozen, but review-board.tsx:353-354 says in its own words that Save is a checkpoint, not a lock. Under the old
  filter, every edit after the first Save silently stopped reaching the review — a narrower instance of the bug
  A7 exists to fix. Listing the editable states also means D1's new 'final' is frozen by omission, with nobody
  revisiting this code. Cost if wrong: an edit lands in a review the user had already saved but not finalized —
  visible and undoable, versus silently missing.
Task A7: minor (folded into the same round): stageLabels loop duplicated between prepare and sync; `sequence` is
  read-max-then-+1 with no locking so two concurrent syncs can collide on a number.
Task A7: fix round 1/5 (1 Critical + 2 Minor + test-coverage gap addressed, 0 open; commits 5bdab65..6db8495).
  Re-reviewer independently re-ran every claimed command and confirmed the numbers: 164/164, typecheck clean,
  build clean.
Task A7: parked — before this week's review is prepared, a task write can join last week's still-'saved' review.
  Ruling: leave it. Pre-existing, narrow (only between the Monday meeting and the next Prepare), and the task
  still joins the correct review when Prepare runs. Cost if wrong: the item also shows on last week's archived
  review. Revisit if D1's Finalize makes 'saved' rarer.
Task A7: parked — `sequence` collision race narrowed but not eliminated; a true fix needs a DB-level constraint.
  Ruling: cosmetic ordering only, no data duplication (the unique constraint on (weekly_review_id, task_id)
  holds). Not worth a migration in a QA-fix round. Cost if wrong: two items share a sequence number and render
  in arbitrary relative order.
Task A7: complete (commits 41bf3eb..6db8495, review clean; 2 parked)

--- Phase A complete: 7 plan tasks in 6 dispatches, all reviews clean. ---
Ruling: C1 and C3 batch into ONE dispatch — both are self-contained changes to components/process/process-explorer.tsx
  with no shared logic and no ordering constraint between them, so a separate dispatch each would mean two
  implementers rebasing the same file. Cost if wrong: one slightly larger review surface for the process page.

Task C1+C3: review — spec ✅ both; quality Approved both, zero Critical/Important. Reviewer independently
  confirmed: no leftover selection useState, hostile-URL fallbacks compose correctly, replace-not-push, the
  Suspense claim holds (force-dynamic + two existing unwrapped precedents), SavedChip genuinely reused, undo
  audited with a second log row, and `completed_at` in the restore set is correct — it audited every
  project_substages column across 0003/0008/0012 to confirm nothing else is written by that action.
Task C1+C3: minor (deferred): redundant `res.undoId ?? null` no-op (process-explorer.tsx:311).
Task C1+C3: complete (commits 6db8495..e84a966, review clean)

Task C2: review — spec ✅ all steps plus the added sub-stage-label requirement. Reviewer confirmed no new round
  trips, correct stale-param degradation, ring-inset + both-theme --sage, matching View-all count, real tests.
  The uncapped phase-level fallback was judged correct (reproduces pre-existing behavior, now captioned).
Task C2: quality — Needs work. Important: the header "View register" link left unscoped at
  process-explorer.tsx:414 while the list beside it is scoped — a sub-stage with 1-4 tasks has no "View all"
  link, so that header link is the only one there and it lands on the whole register.
Task C2: Ruling: the implementer's disclosed judgment call 2 gets FIXED here rather than deferred.
  lib/process.ts's getProjectProcess buckets by stage_key/current_phase_key only; the reviewer traced that a task
  whose only phase signal is substage_template_id does not merely land in the wrong phase — it vanishes from every
  panel (excluded from `mine` everywhere, and from `phaseOnly` because it is non-null). Inert today only because
  0015 is unapplied; it arms itself the moment Dor applies the migration, and C4 (next) makes assigning sub-stages
  easy from that very page. Fix reuses resolveTaskPhaseKey — the same precedence A6 settled — rather than a second
  implementation that can drift. Cost if wrong: one more file touched in a task already editing the process page.
Task C2: minor (deferred): no test covers the mine/phaseOnly/shown branching or the spSubstage filter itself.
Task C2: fix round 1/5 (1 Important + the ruled-in phase-bucketing fix + the optional extraction all addressed,
  0 open; commits 4406955..b56394b). Re-reviewer independently re-ran vitest (179/179), typecheck, build and
  eslint and confirmed the report verbatim; verified resolveTaskPhaseKey is imported, not duplicated, with no
  import cycle, and that the legacy stage_key path — the only populated one today — is semantically unchanged.
Task C2: complete (commits e84a966..b56394b, review clean; 1 minor deferred above)

Task C4: review — spec ✅; quality Approved, zero Critical/Important. Reviewer enumerated all 22 label keys
  TaskEditor + SavedChip read and confirmed every one is passed (16 added, 6 pre-existing via verbResultLabels),
  all present in both locales (591/591 keys); confirmed no query added outside the existing Promise.all and that
  lib/process.ts only widened a filter on a query it already ran; confirmed zero `stage_key` hits in the diff,
  so no Phase write was reintroduced; confirmed the Project onChange clears Workstream in the same handler so a
  stale cross-project workstream is never selectable.
Task C4: minor (deferred): a project change on a per-project page has no change-specific explanation beyond the
  generic Recorded/Undo chip — would need a task-editor.tsx change, out of scope for a wiring task.
Task C4: complete (commits b56394b..8a6b43e, review clean)

--- 12 of 22 plan tasks closed in 9 dispatches. ---
Ruling: batch the remaining work harder to cut wall-clock — D1+D2+D3 (0016 adds next_step, which D2 consumes;
  one implementer avoids a second rebase of review-board.tsx), D4+D5+D6 (all three are the weekly upload card
  and weekly carry tests), E1+E2+E3 (all invoices, and E1 is a two-line change not worth its own review seat),
  E4+E5 (E5 appends history to the editor E4 extends). C5, E6 and F1 stay solo — C5 and F1 are checklist walks
  with their own judgment, E6 is a new pure module plus a new tab. Cost if wrong: larger review surfaces on the
  batched diffs, which the reviewers have handled fine on the three batches already run.

Task C5: review — spec ✅ (all 14 verdicts with evidence); quality Approved, zero Critical/Important. Reviewer
  spot-checked 8 of the 10 PASS verdicts against real code — none contradicted — and independently confirmed the
  scope-exclusion claim (phase-column.tsx / substage-row.tsx render only on the home route, never on
  /projects/[id]). Item 10 confirmed a REAL bug: substage_templates and phases are not project-scoped, so a
  project switch landing on the same template id did not remount SubstageDetail and showed the previous
  project's note in an uncontrolled textarea. Keying on project.id judged the idiomatic fix, with no unnecessary
  remount on in-project navigation.
Task C5: minor (deferred): components/process/substage-row.tsx:63,66 carries the identical "Upcoming instead of
  Not activated" bug item 6 fixed, but renders only on the home/portfolio page — correctly out of C5's scope.
Task C5: complete (commits 8a6b43e..76383e5, review clean)

--- Phase C complete: 5 plan tasks in 4 dispatches, all reviews clean. ---

Task D1+D2+D3: review (opus) — spec ✅ all three. D3's PASSED verdict independently re-traced and confirmed
  (allItems flattens groups built from a single-review embedded query, FK-scoped, never the task pool).
  Migration verified correct, idempotent and enum-in-transaction-safe; Reopen correctly no-ops on a
  never-finalized review; setItemStatus gates before the tasks write.
Task D1+D2+D3: quality — Needs work, 2 Important:
  (a) Finalize diverts A7's sync into an OLDER review — syncTaskIntoOpenReview picks the newest review AMONG
      the editable set rather than the newest review if editable, so the first finalize sends Tuesday's task
      edits into a past week's saved meeting record. Unreachable before D1; armed by it.
  (b) saveSubtopicContext is ungated and its textarea only disables on `pending`, so on a finalized review the
      sub-topic narrative — which carries forward and is part of the meeting record — stays editable, and the
      action logs `after` only, making the overwrite unauditable and unundoable.
Task D1+D2+D3: Ruling: finding (a) is a consequence of MY A7 ruling (the `.in(['preparing','saved'])` allow-list),
  not an implementer error. The allow-list was right for freezing 'final' by omission but wrong as a SELECTOR:
  picking the newest editable review is not the same as picking the newest review and checking it. Fix is
  "fetch newest unconditionally, no-op unless editable", plus a single pure isReviewEditable() so the editable
  set stops having two definitions — which is what let this hide. Cost if wrong: none identified; it strictly
  narrows what the sync will write to.
Task D1+D2+D3: minor (deferred): raw-English gate error strings surfaced in a Hebrew UI; finalized-date badge
  missing <bdi> where the file wraps other dates; weekly.archive_note does not mention next_step.
Task D1+D2+D3: fix round 1/5 (2 Important + 3 Minor + test-coverage gap addressed, 0 open;
  commits d063448..a621a36). Re-reviewer independently re-ran vitest (183/183) and typecheck and confirmed the
  report; traced that no code path can now fall back to an older review.
Task D1+D2+D3: minor (deferred): components/weekly/review-board.tsx:34 still does
  `review.status === 'final'` instead of routing through isReviewEditable — behaviourally identical today, but
  it is exactly the drift the extraction exists to prevent, and it was not disclosed as deliberate.
Task D1+D2+D3: minor (deferred): reopenReview now proceeds for `'final'` AND any unrecognized status, because it
  no-ops on `isReviewEditable`. Reviewer recommends narrowing to a literal `'final'` check so a future
  archived/cancelled state cannot be silently resurrected by a stray Reopen. Latent only — the enum is exactly
  preparing|saved|final today.
Task D1+D2+D3: note — the re-reviewer corrected the framing that the new tests "would have caught" finding 1:
  they cover the predicate's truth table, but the bug lived in query construction, so a regression that
  reintroduced an inline .in(status,...) filter would still leave them green.
Task D1+D2+D3: complete (commits 76383e5..a621a36, review clean; 3 minors deferred above)

Task D4+D5+D6: review — spec ✅ all three, verdict Approved. Reviewer independently re-traced the D5 pipeline
  claim line by line (route.ts -> ingest.ts -> extract-comms.ts, schema checked against 0002) and confirmed it:
  .txt/.docx weekly uploads DO produce pending agent_proposals, only .mp4 is store-and-link. The banner branch
  was therefore correct, not a fabricated state, and it cannot fire for unrelated proposals because only
  task_update/task_done carry a non-null target_task_id. Double-upload guard, same-file re-pick, and the
  format-copy/finalized-upload judgment calls all confirmed sound.
Task D4+D5+D6: 2 Important sent to fix — (a) D6's "dropped does not carry" is a comment, not a test, so a
  refactor that special-cases terminal statuses and forgets 'dropped' would pass silently; (b) D4's failure path
  discards route.ts's specific error ("file too large (max 20MB)") for a generic string, contradicting the same
  file's own §19 comment and dropzone.tsx's better handling.
Task D4+D5+D6: minor (deferred): weekly.archive_note's "everything else continues" does not hold for a task
  merged into a Master Action — it leaves buildReviewItems entirely, neither carried nor shown.
Task D4+D5+D6: minor (deferred): weekly.uploaded is now dead but left in both locales.
Task D4+D5+D6: minor (deferred): attachRecording's logActivity has no `before` snapshot at all (pre-existing).
Task D4+D5+D6: fix round 1/5 (2 Important addressed, 0 open; commits 7276442..e85a841). Re-reviewer confirmed
  the new dropped test really sets status_snapshot:'dropped' and asserts absence, and that the error surface
  renders a readable string with role="alert" and falls back only when no specific message exists.
Task D4+D5+D6: complete (commits a621a36..e85a841, review clean; 3 minors deferred above)

--- Phase D complete: 6 plan tasks in 2 dispatches, all reviews clean. 19 of 22 tasks closed. ---

Task E1+E2+E3: review (opus) — E2/E3 spec ✅ both, verdict Approved. Money path traced end to end and confirmed
  clean: no *100 or /100 anywhere, no cent can drift; abc/-5/1e3/181.305/"1,234.56"/null all rejected rather
  than coerced. Paid rules enforced server-side; Keep vs Clear correctly distinguished from omission by key
  presence. receipt_url deviation judged correct (dropping it would regress); the Transfer-link input judged
  required, not creep. Undo cannot half-revert — the restore list derives from the writer's own column map.
Task E1: Ruling: the plan's stated cause for E1 is WRONG and the implementer was right not to invent a fix.
  I verified page.tsx:200 already builds `/invoices?tab=${key}` with no other params. The real cause of the QA
  symptom ("Payment Summary shows No matches") is lib/import/tracker.ts:82 hard-coding tab:'invoices' on every
  imported row against page.tsx:69's `inv.tab !== tab` filter — the audit doc's D11. Fixing it by data backfill
  belongs to E7, which Dor excluded; but the design error is in the view: a Payment Summary is a different
  GROUPING of the same invoices, not a different population. So the summary stops depending on the stored `tab`
  and derives its set instead; the `david` tab keeps its stored-value behaviour, since the spec forbids removing
  that workbook view. The audit doc reaches the same conclusion independently ("or better, drop `tab` as a stored
  discriminator and derive the view"). Cost if wrong: the summary aggregates a wider set than intended — visible
  immediately, and E6's reconciliation cross-checks the totals.
Task E1+E2+E3: 2 Important sent to fix — (a) the 75dvh editor popover is clipped by the table's overflow-x-auto
  container on short lists; (b) every server rejection collapses to one generic string, and the https rule has
  no client twin, so a http:// link produces "Could not save" naming none of the 12 fields.
Task E1+E2+E3: minor (deferred): vendor_id/project_id validated only by DB FKs, not explicit existence checks;
  Keep and Clear both aria-pressed when a paid row has a null paid date; <div> inside <span role="dialog">
  (link-editor.tsx:337).
Task E1+E2+E3: fix round 1/5 (the E1 ruling + 2 Important + 2 Minor all addressed, 0 open;
  commits b9ef389..285ee78). Re-reviewer walked the real DOM ancestor chain to confirm the fixed-position editor
  genuinely escapes the clipping container (no transform/filter/contain anywhere above it), verified all 9 error
  codes now have user-facing messages in both locales with a translated lead-in for raw Postgres strings, and
  confirmed the tightened decimal rule rejects rather than rounds with no *100 anywhere. Independently reran
  vitest (208/208) and typecheck. Note: fixing E1's real cause also populated the Payment Summary tab's vendor
  pill counts, which had always read zero for the same reason.
Task E1+E2+E3: complete (commits e85a841..285ee78, review clean; 3 minors deferred above)

Task E4+E5: review (opus) — E5 judged well built (lazy per-editor history fetch, no N+1, real column names,
  auth enforced, no value leakage). E4 spec-compliant on paper but Needs work: 2 Critical.
  (a) The weak vendor key defeats the feature's purpose — suspicionDupKey also starts with vendorGroupKey, so a
      punctuation variant misses BOTH keys and the audit's own "Thang le& Associates" case inserts unflagged.
      The tests currently lock that miss in as intended. The brief sentence the report cited as authority for
      the weak key does not exist in the brief — the reviewer grepped it.
  (b) "Add anyway" fails with a raw Postgres unique-constraint error in the COMMON case, not the rare one:
      vendors.name is itself unique, so an exact-key hit ordinarily shares vendor_id. The dialog's primary CTA
      is unusable, and it also blocks a legitimate second invoice where a vendor reuses numbers per project.
  Important: PGRST204 pre-0017 shows a PostgREST internal to the user (keep the write unconditional, map the
  code); and the candidate fetch is unbounded, so past Supabase's 1000-row default the dedup silently compares
  against an arbitrary subset.
Task E4+E5: minor (deferred): <div role="dialog"> nested inside a <span>; the post-create SavedChip replaces the
  "+ Add invoice" button until dismissed, so a second invoice cannot be started immediately.
Task E4+E5: fix round 1/5 (2 Critical + 2 Important + 2 Minor + test coverage all addressed, 0 open;
  commits 5b07026..06aeff2). Re-reviewer confirmed the tests genuinely REVERSED direction (the old
  `.not.toBe()` deleted, replaced with assertions that the audit's "Thang le& Associates" pair IS caught),
  that vendorKey is one shared definition now used by page.tsx too, that the same-vendor_id case is blocked
  before any insert with a named translated error, and that the unbounded scan became two targeted queries.
  Independently reran the suites and got matching results.
Task E4+E5: note — unifying page.tsx on `vendorKey` also changes display grouping: vendor pills and the vendor
  filter now merge suffix-only variants (e.g. "Acme LLC" with "Acme"). Deliberate and consistent with the dup
  check, but Dor should expect fewer, broader vendor pills. A false collision only forces an extra Verify
  prompt, never a silent merge.
Task E4+E5: minor (deferred): stale comment above `errorMessage` in add-invoice.tsx still cites the raw
  unique-constraint message as an example, which is now the case the fix intercepts.
Task E4+E5: complete (commits 285ee78..06aeff2, review clean; 3 minors deferred above)

Task E6: review (opus) — spec ✅ (six tiles exact, all three audit shapes covered by literal assertions, i18n
  657/657). Reviewer independently confirmed reconcile() is pure, the no-mutation constraint holds (a report run
  creates nothing), centsEqual's toFixed(2) string compare is correct in both directions, the key routes through
  the same vendorKey as the dup keys, the new tab does not reintroduce the stored-tab dependency, and a
  malformed/empty sheet cannot produce a false "no drift".
Task E6: quality — Needs work, 3 Important:
  (a) flagInvoiceForVerification swallows the SELECT error, so an unapplied 0017 reports "invoice not found" for
      a row visible on screen (invoices.ts:431-432);
  (b) a multi-row Flag Verify returns undoId:null, and nothing anywhere else in the app can clear
      needs_verification — a one-way write on a financial screen (invoices.ts:521);
  (c) the orphan+added double-report actively misleads: Orphans is the tile a human acts on by ADDING the row,
      so a blank-invoice-no source row against a numbered system row steers the reader into creating the
      duplicate this round exists to eliminate.
Task E6: Ruling: (c) gets fixed rather than documented. The implementer followed the brief's key spec literally
  and disclosed the consequence, which was right — but a financial report that quietly steers toward creating a
  duplicate is worse than one that admits uncertainty. Fix is a second pairing pass on vendor+amount+date when
  exactly one candidate exists per side, reported as changed:['invoice_no']; ambiguous cases stay put but
  surface the suspicion. Cost if wrong: the pairing pass mis-links two rows that genuinely differ, which shows
  as a changed entry naming invoice_no — visible, and adjudicated by a human either way.
Task E6: also folded in — the tile/section count mismatch under one label, the swallowed partial failure in the
  multi-row flag loop, and bodySizeLimit 10mb -> 2mb (it is global to every Server Action and buffers before
  requireUser()).
Task E6: minor (deferred): suspectedDuplicates groups carry no source-side vs system-side label (the plan's own
  type forces it — RAISE WITH DOR); parseWorkbook returns only the first invoice-shaped sheet, so an archive
  sheet ahead of the live one would report every live row as added; invoices.tab_reconciliation left in English.
Task E6: fix round 1/5 (3 Important + 2 Minor + the bodySizeLimit reduction addressed, 0 open;
  commits 921c3a5..1e79c92). Re-reviewer exhaustively traced the new pairing pass and confirmed it cannot
  invent a match — the two directions partition disjointly, "exactly one candidate per side" is checked per
  bucket, and the ambiguous 2-vs-1 case correctly leaves both sides in place while surfacing the suspicion.
  Also confirmed the undo threads the FULL undoIds array (SavedChip's undoId prop is only a truthy sentinel)
  and that the suspectedDuplicates section — the real multi-row case — wires the same handler. Independently
  reran all four commands: 256/256, typecheck clean, build clean.
Task E6: minor (deferred): updateInvoice carries the identical swallowed-SELECT-error pattern that Finding 1
  fixed in flagInvoiceForVerification — pre-existing E2/E3 code, correctly flagged and left alone.
Task E6: complete (commits 06aeff2..1e79c92, review clean; 4 minors deferred above)

Task F1: review — spec ✅ (25/25 verdicts with evidence, no scope creep). Reviewer spot-checked 5 PASS verdicts
  against live code and independently confirmed the item 11 analysis was TRUE, not merely plausible (the three
  file tabs render the same Dropzone element in the same slot, so React preserved state there; only sheet/text
  forced the unmount), and that the fix fully closes it. Item 13 verified airtight: all 7 accept strings map 1:1
  to real route.ts branches. Item 20 confirmed genuinely structural and correctly deferred.
Task F1: 1 Important sent to fix — the retry-after-partial-failure path: a failure AFTER the documents row is
  inserted shows "Failed" with no queue refresh, and the retry then hits the dedup branch and reports
  "Processed - Review when ready" while that document's queue row reads "Uploaded" forever with no Review link
  and processed_at permanently null. A silent, permanent contradiction with no in-UI recovery.
Task F1: ESCALATE TO DOR (not fixed, out of scope for this run): extraction auto-creates tasks — and invoice
  rows, vendor-hours and drafts elsewhere — directly into live tables (lib/proposals.ts:32,
  agents/extract-comms.ts:104-116), audited and undoable but never gated behind agent_proposals. The QA doc's
  inbox section states plainly that the system does not apply suggestions without human approval, and the page
  itself carries a "Human approval stays in control" card. Closing it means routing every extraction write
  through the proposal queue — an architectural change, not a checklist fix. Ruling: surface it rather than
  attempt it inside a sweep. Cost if wrong: the page keeps making a promise the pipeline does not fully honour
  until Dor schedules the work.
Task F1: fix round 1/5 (1 Important addressed + report citations re-verified; 1 NEW Important opened by the fix;
  commits 50864c8..40b75db). Re-reviewer verified the implementer's unsafety reasoning as TRUE — the extract
  path's writes really are unguarded plain inserts while only the invoice path upserts — and confirmed uniform
  honest reporting was the right call over special-casing.
Task F1: fix round 2 opened — the new `processed` signal (processed_at != null) has a blind spot: both agent
  paths early-return before stamping when the LLM matches no project, so a document that DID run now reports
  "Stored - Not processed yet" forever. The fix turned an imprecise message into an actively false one.
Task F1: fix round 2/5 (1 Important addressed, 0 open; commits 40b75db..ae4ab42). Re-reviewer independently
  grepped all 13 processed_at sites repo-wide and confirmed there is no third early-return-before-stamp, that
  every agent-ran path is now stamped, and that the opposite error is impossible (entering applyX at all proves
  the LLM call already succeeded).
Task F1: minor (deferred): parse-invoice.ts has no test file, so its half of the fix rides on the symmetric
  extract-comms test plus typecheck/build rather than a direct assertion.
Task F1: complete (commits 1e79c92..ae4ab42, review clean; 1 minor deferred, 2 structural findings escalated)

=== ALL 22 PLAN TASKS COMPLETE — 14 dispatches, every review clean. Final whole-branch review next. ===

=== FINAL WHOLE-BRANCH REVIEW (opus, 38 commits, d3cb175..ae4ab42) ===
Verdict: not safe to merge as-is, close. Constraints hold in the code (i18n parity, no *100//100, no new hard
deletes, no AI attribution across 38 commits, RTL clean, SavedChip/vendorKey/resolveTaskPhaseKey each single
definition). Danger was entirely the unapplied-migration window plus cross-task drift no scoped review could see.
4 Critical + 8 Important dispatched as ONE fix wave -> commits ae4ab42..31c1ec0 (6 thematic commits, 270/270).
Fix-wave re-review: C1-C4, I1-I6, I8 and all 7 smaller items ADDRESSED; both implementer deferrals accepted.
Residuals sent as the final targeted round: I7's copy still inaccurate (the invoice upsert DOES overwrite an
existing amount without a gate, four gated types were mislabelled as "saves directly", and upload.sub's louder
false claim was untouched); a NEW Important in the paging fix (no .order() across LIMIT/OFFSET pages can skip
and duplicate rows non-deterministically); and an authz hole a separate cross-task audit found —
setItemStatus writes a CLIENT-SUPPLIED taskId after gating only on itemId, so a signed-in user can mark any
task done.
Ruling: these three warrant one final round despite the skill's "no second fix wave", because each is one
concrete named fix and each is a correctness or security defect rather than polish — a page that promises the
owner nothing changes without review while an LLM can overwrite an invoice amount must not ship. Cost if wrong:
one extra round on a branch already reviewed twice.

--- DEPLOY ORDER (from the final review, for Dor) ---
Apply 0015 -> 0016 -> 0017 in numeric order, ideally BEFORE the code ships. No cross-dependencies, all
`if not exists`, all re-runnable. 0016's enum addition has NO ordering hazard (the file only ADDs 'final' and
never uses it). After applying, PostgREST's schema cache must reload before inserts naming the new columns stop
returning PGRST204 — for a short window the app will still say a migration is pending though it is applied.
0015's business_rank backfill uses ilike, so two projects matching the same pattern tie in the Today walk.
No single revert point exists: 38+ commits landed directly on main per Dor's own instruction; recovery is
per-commit `git revert`, and the ledger names every commit.
Final targeted round: 3/3 fixed and verified by the controller directly —
  a82c874 copy now enumerates the real gate (new tasks/vendors/invoices save directly; task updates, blockers,
    decisions, deadlines and dependencies wait), applied to upload.sub, upload.chip1 AND upload.step4_d in both
    locales, so the loud claim and the chip no longer contradict each other;
  dcac1be `.order('id', { ascending: true })` inside the paging helper;
  11abaab setItemStatus now derives task_id from the gated item and logs a mismatch instead of trusting the
    parameter.
Verified: 274/274 tests, typecheck clean.

=== ROUND COMPLETE: 22 plan tasks, 44 commits, every review clean. ===
