# Analyst Agent spec + per-project audit — findings

Companion to `2026-08-24-ux-ui-version-fixing.md` and `2026-08-24-noa-corrections-analysis.md`.

**Sources:** the client doc's "SiteKick — Project Process Analyst Agent" tab (a developer implementation specification, 37 discrete requirements), the "Verified Project Status and Process Map" and "Blocker Audit and Required Corrections" tabs, and the Hebrew "SiteKick — Reviewed Work Map".

**Scope warning.** These came from `?tab=t.0` of the Google Doc. Both Drive endpoints return only that tab, so **additional tabs exist that have not been read.** Nothing here is the complete requirement set.

**Evidence baseline:** August 23, 2026. Data findings were read against `supabase/seed/data.json`; live rows may have drifted, so every data item must be re-checked against production before anyone writes.

---

## 1. The rule everything else serves

> "No evidence - no confirmed stage. No verified relationship - no blocker. No completion evidence - no automatic closure."

Clause 2 is now largely enforced by `lib/blockers.ts` and migration 0009. **Clauses 1 and 3 are not enforced anywhere.**

And the framing that makes this tab load-bearing:

> "This is not a summarization agent. It is the reasoning layer that makes Portfolio, My Work, Project Process, Communications, Weekly Review, and the other SiteKick agents agree with one another."

---

## 2. Largest gaps against the Analyst spec

**The LA process library does not exist.** The spec requires versioned jurisdiction rules stored as data — agency, case/permit type, project type, prerequisites, start evidence, completion evidence, optionality, an explicit `forbidden_inference`, effective date and source URL. What exists is `substage_templates` with five columns and 23 hard-coded names (`0003_process_model.sql:17-52`). All process reasoning lives in prompt strings, which the spec forbids directly: *"Store versioned jurisdiction rules instead of hiding them in the prompt."*

**Applicability is missing as an axis.** The spec separates applicability (Applicable-verified / Conditional / Not applicable / Unknown / Hidden) from status. Live conflates them — `not_applicable` is a *status* value.

**Every project shows every standard sub-stage.** `lib/process.ts:22` renders all `standard` templates regardless of project, defaulting to `upcoming`. The spec: *"Never display every possible stage as Upcoming. That creates false certainty."* Hearing is seeded `standard` (`0003:33`), so it always displays, while the spec says it activates only when required or officially scheduled.

**`project_substages` has zero rows.** The seed populates `substage_catalog` only. So every sub-stage on every project renders as a bare template — precisely the complaint in the Hebrew work map §4.

**Evidence is ordered by upload time, not event date.** `documents.received_at` defaults to `now()`. Worse, `app/api/upload/route.ts:112,150` sort emails with a lexicographic compare over RFC-822 date strings, so the `PROCESS_CAP = 10` "newest first" budget selects an effectively arbitrary ten.

**Phase and sub-stage changes are not undoable.** They log `after` with no `before` (`lib/state-writer.ts:96`, `app/actions/process.ts:29-35,112-118,130-136`), so `undoProposalDecision` has nothing to restore — for exactly the changes the spec classifies as material.

**No `stage_proposals` path.** `proposal_type` has no sub-stage member, so "activating or removing a required sub-stage" and "marking a City approval or submission" — both listed as material changes requiring review — have no review path at all.

**Confidence is fabricated.** Six hard-coded literals in `lib/proposals.ts:29,30,42,45,48,51`; token overlap used as confidence in `app/actions/process-text.ts:156`. The spec's six-level source-authority ladder does not exist.

---

## 3. Gaps in what this session already shipped

Defects in the blocker work, not missing features:

- **`applyProposal`'s `blocker_create` populates none of the 0009 columns** (`lib/state-writer.ts:39-49`). An agent-accepted blocker lands on defaults — `kind='verify'`, `confidence=0.50` — and can therefore never become Primary.
- **`manually_corrected_by` is written by nothing and read by nothing.** Its entire purpose is that agents must not overwrite a human's classification, and nothing enforces it.
- **Migration `0003:113-115` ran `update project_stages set substage = null`**, wiping Noa's manual sub-stages. `targetsCurrentStage()` in `lib/blockers.ts:58-61` reads that column, so **no blocker can currently qualify as Primary via the sub-stage route** — only via `blocks_phase`.
- **The fallback sorts kinds together.** `lib/blockers.ts:88-90` ranks `workstream` and `external_gate` purely by `days_stuck`. Alta Mesa's expected card is an External Gate headline with LID as detail; if the LID row is stuck longer it wrongly becomes the headline. Kind priority is undefined.
- **No blocker dedup in the derivation**, though "exclude duplicated" is in the rule set.
- **`scoreBlocker` gives a flat +50 to every active blocker regardless of kind** (`lib/priority.ts`), so external gates and verify items still flood Today.

---

## 4. Relationship types — five of six missing

Live enum (`0004_relationships.sql:4`): `blocks`, `supports`, `parallel`, `unrelated`, `needs_verification`.

| Required | Present | Note |
|---|---|---|
| Blocks | yes | |
| **Required for** | **no** | `supports` is a weaker claim; the work map lists both, so they must coexist |
| **Affects** | **no** | "may change scope or outcome but does not necessarily block" |
| **Related** | **no** | `parallel` means concurrent workstream, not the same thing |
| **Independent** | **no** | same project, different causal chain; `unrelated` is broader |
| **Conditional** | **no** | needed for B Permit and arborist applicability |

Adding values changes nothing until the consumers widen: `lib/queries.ts:95` fetches only `type='blocks'`, and `lib/priority.ts:89-95` scores unlocks only on `blocks`.

---

## 5. Blocker classification — the D14 source data

The authority for reclassifying every blocker. Expected counts are what each Portfolio card must show.

### 2361-2367 San Marco
Card today: "Two critical blockers — dedication / waiver direction + Civil Engineer not retained."
Corrected: **Main Blocker** — dedication / waiver decision, blocking the Planning Hold Letter response. **Technical Workstream Blocker** — Civil / Grading Engineer not retained, blocking the Grading Plan and submission preparation.

| Item | Kind | Gates | Note |
|---|---|---|---|
| Dedication / Waiver strategy | `primary` | Planning Hold Letter response | Hillside Referral Form shows a 5.5 ft dedication absent from the drawings |
| Civil Engineer not retained | `workstream` (was primary) | Civil / Grading Plan | Does not block every Hold Letter item |
| Grover / soils corrections | `workstream` | Soils corrections only | Not the Hold Letter, absent a shared deliverable |
| Structural drawings + Title 24 | `future_gate` | The future LADBS submission | Must not stop the current Planning response |

**Expected:** card shows 1 primary. Detail shows 2 workstream + 1 future gate, each under its own track.

### 2650-2656 Rinconia
Card today: "Complete soils addendum." Corrected: **technical submission readiness incomplete — Civil / Grading Engineer and Soils Addendum outstanding.**

| Item | Kind | Gates | Note |
|---|---|---|---|
| Soils Addendum | `workstream` | Soils approval | Must not claim it blocks Intake Acceptance without written LADBS confirmation |
| Civil / Grading Engineer not retained | `workstream` | GPI-required Grading Plan | **No such row exists — must be created** |
| Monitor intake screening / payment link | `external_gate` | nothing | Remove Blocking; follow-up only |
| BOE Form 100-B | `urgent_action` | nothing in the permit chain | Legal / tax, not a permit blocker |

**Expected:** 2 technical blockers (or one combined). Intake follow-up not counted. BOE shown separately.

### 3701 Alta Mesa
Card today: "Receive City confirmation and complete mailing work." Corrected: **Planning completeness confirmation and hearing readiness.**

| Item | Kind | Gates | Note |
|---|---|---|---|
| Written Deemed Complete confirmation | `external_gate` | Progression toward the hearing | **Owner is Crest, not Noa** |
| QMS digital mailing package | `verify` | — | May already be delivered; confirm receipt, forwarding, mailing, proof |
| QMS payment / file release | `urgent_action` or `workstream` | Release of the package | Only while nonpayment actually prevents release |
| LID covenant notarization / recordation / upload | `workstream` | LID clearance | **Must be created.** Does not block Planning unless the City links them |
| Plan Check meeting and corrections | active action, **not blocking** | — | |

**Expected:** card shows 1 external gate. Detail shows 1 possible LID workstream blocker. QMS stays Verify until reconciled.

### 3375 Blair Dr
Card today: "Confirm extension outcome." Corrected: **confirm written Plan Check Extension outcome.**

| Item | Kind | Gates | Note |
|---|---|---|---|
| Plan Check Extension determination | `primary` | Continue-vs-resubmit decision | Aug 18 meeting happened; no written outcome in evidence |
| Confirm DCPA notarization | **remove — close as Done** | — | Abhi confirmed complete |
| Linkage Fee Affidavit | `verify` | — | Split from the DCPA item |
| File Plan Approval at the Planning counter | Planning-track gate | The corrective Plan Approval track only | See the mapping decision in §8 |
| Carlos Interior Design agreement | `workstream` | Carlos kickoff only | Carlos signed Aug 11; Hilla has not. Partially executed, not Done |

**Expected:** card shows 1 primary. Detail shows 1 Planning-track gate + 1 interior-design workstream blocker. DCPA removed from the count.

---

## 6. Sub-stage library — what must be added

**Planning:** Case completeness review (split from "Case accepted / deemed complete"), Notification package, Mailing / notice proof, Hearing scheduled **and** Hearing held (currently one generic `Hearing`), Appeal period, Entitlement in effect. Plus Blair's Plan Approval set: filing requirements, filing appointment, application filed, Planning fees, Planning review / conditions, Plan Approval determination & Planning clearance.

**Plan Check:** Submission / intake screening (the first template today is `Intake accepted`, so the submission step itself is unrepresentable), Fee payment, Resubmittal.

Binding status vocabulary from the work map: Submitted = filed. With the City = received and being handled. Completed = approval or closure evidence exists. Verify = a claim exists but no document. Upcoming = not started. N/A = proven not applicable. All six are representable in the live enum; no enum work needed there.

---

## 7. Ordering that governs the data work

1. Fix `project_id` on mis-attributed tasks — Alta Mesa, Rinconia and San Marco tasks currently display under Blair. Fix the column, not the label.
2. Split and create the blocker rows, then classify every one per §5.
3. Create `project_substages` rows per project (blocked on the library additions in §6).
4. Only then do the Portfolio summaries and expected counts become checkable.

Ingest priority, verbatim from the work map §7:

1. San Marco's Hold Letter and all attachments — to separate dedication, civil, grading, soils and B Permit.
2. Intake / Plan Check corrections letters and fee invoices — to determine Submitted, With the City, Paid.
3. Deemed Complete, Letter of Determination, Conditions of Approval — to prove Planning milestones.
4. Civil, soils, structural and interior design proposals and agreements — to determine scope, owner and blocked deliverable.
5. OLM / EML / MBOX — history and status cross-checking; the system must identify project, thread, latest message and duplicate.
6. Teams recording / transcript — update suggestions with source, confidence and undo.

---

## 8. Decisions only a human can make

**Product decisions:**
- The docs use labels the `blocker_kind` enum lacks — *Planning Gate* (Blair), *Submission Readiness Blocker* (Rinconia), *Not Blocking* (work map §5). Decide whether to add enum values or map them (`Planning Gate` → `workstream` with `blocks_phase='planning'`; *Not Blocking* → absence of a blocker record). This affects the schema, so decide before any classification work.
- "Every AI suggestion waits for approval" must **not** be a fixed rule. Only significant changes, contradictions, uncertainty or high-impact information require approval; safe repeated updates may apply automatically with audit log and undo. Nothing currently writes an auto-applied state.
- Is Flicker Way in scope? It is a fifth project in the data, marked inactive, and these documents cover four.

**Evidence still outstanding** — none resolvable from the documents:
- Blair: the written Plan Check Extension outcome. Until it exists the primary blocker cannot be released.
- Blair: Hilla's signature on the Carlos agreement; whether the Linkage Fee Affidavit is already in the Aug 20 package; whether the City requires the bond renewal.
- Alta Mesa: whether the QMS package was delivered in full and whether payment still prevents release; the LID covenant's signature, recordation and upload status; whether the City explicitly links LID clearance to Planning.
- Rinconia: the LADBS intake / payment-link status; whether LADBS states in writing that the soils addendum gates intake acceptance; whether the City requires the arborist report; whether anything connects BOE Form 100-B to Plan Check intake.
- San Marco: the civil / grading / B Permit scope after boundaries and footings are verified; and the dedication / waiver strategy itself, which is a decision rather than a fact.
