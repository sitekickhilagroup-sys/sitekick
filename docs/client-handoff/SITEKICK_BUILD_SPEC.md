# Sitekick - Build-Ready Specification

## 1. Product contract

Rebuild the supplied demo as the reference UI. Preserve the visual hierarchy, wording, project grouping, progressive disclosure and three distinct jobs:

- Portfolio = understand position, risk, next milestone, change and portfolio learning.
- My Work = act on one canonical task record through Today, Blocking, Follow-ups, Waiting and All.
- Project Process = investigate fixed phases, conditional sub-stages, parallel workstreams, evidence and connected actions.
- Invoices = manage invoice-level financial records, payment state and receipts from a permanent top-level workspace.
- Weekly Review = prepare the Sunday review and run the Monday project meeting using the same canonical actions.
- Developer Handoff = living implementation documentation.

The fixed phase template is Planning > Plan Check > Bidding > Financing > Construction. Projects overlay this template; they do not copy or redefine it.

## 2. Required screens and behavior

### Portfolio
- Show four project accordions ordered by current attention score.
- Opening an accordion shows current phase, parallel workstream, what must happen next, main blocker, then, evidence confidence and a button to Project Process.
- Ranked Attention shows only a compact ranked summary. Clicking it opens My Work; it does not create another task.
- Agent Review Inbox contains conflicts and low-confidence proposals.
- Portfolio Intelligence tabs: Time & blockers, Budget, Consultants, Forecast.
- Financial data must state Partial Budget Coverage until every budget category is complete.

### My Work
- Views: Today, Blocking, Follow-ups, Waiting, All.
- Today, Blocking and Follow-ups are grouped by project, then sorted by descending priority.
- Do not repeat the project name inside a project group.
- Every row provides direct Update: Completed, Sent email, Waiting, Delayed, Scheduled, Not applicable, Add note.
- Details reveals evidence, relationship type, reason, confidence, blocks/affects, unlocks and recommended next move.
- One task can appear in several views by query; never duplicate its database record.
- Payment Run is one parent action with invoice-level items beneath it.

### Project Process
- Always show all five fixed phases.
- Inside a phase, show reusable standard sub-stages plus conditionally activated sub-stages.
- Connected actions reference the canonical task record.
- Parallel workstreams are branches, not a false linear chain.
- A manual update in Project Process updates the same record visible in My Work.

### Invoices
- Accessible directly from primary navigation and from the aggregated Payment Run action.
- Show vendor, invoice number, project/entity, description, exact workbook date, status and amount.
- Do not derive Service Month. The date field is the exact date entered in the source workbook.
- Open invoice and receipt links from the canonical invoice record.
- Allow Received, Approved and Paid status, payment date and receipt link.
- Payment Summary and invoice detail query the same records.

### Weekly Review
- Preserve Project > Sub-topic > Action hierarchy.
- Carry forward prior actions, including completed items, with current status and current weekly notes.
- Save manual meeting updates as authoritative activity.
- Accept Teams/MP4 evidence; transcription and extracted proposals must pass through reconciliation and Review Inbox.

## 3. Canonical data model

Core tables/entities:

- process_templates(id, version, active)
- phase_templates(id, process_template_id, name, sequence)
- substage_templates(id, phase_template_id, name, kind, activation_rule_id, sequence)
- projects(id, name, case_number, current_primary_phase_id, health, manual_override)
- project_substages(id, project_id, substage_template_id, applicability, status, activated_at, completed_at, manual_override)
- workstreams(id, project_id, name, phase_id, status)
- requirements(id, project_id, substage_id, workstream_id, title, status)
- actions(id, project_id, substage_id, requirement_id, title, status, owner_id, waiting_on, due_at, follow_up_at, is_blocking, priority_score, manual_priority)
- relationships(id, from_entity_id, to_entity_id, type, reason, confidence, verified_by, source_evidence_id, manual_override)
- evidence(id, project_id, source_type, source_uri, author, occurred_at, excerpt, content_hash, ingested_at)
- agent_proposals(id, proposal_type, payload, confidence, evidence_ids, state)
- activity_log(id, entity_type, entity_id, actor_type, actor_id, action, before_json, after_json, created_at)
- invoices(id, project_id, vendor_id, invoice_number, invoice_date, description, amount, status, invoice_uri, receipt_uri, approved_at, paid_at, source_row_id, version)
- weekly_reviews(id, meeting_date, preparation_date, status, source_review_id, recording_evidence_id)
- weekly_review_items(id, weekly_review_id, action_id, status_snapshot, weekly_note, sequence)
- budgets(id, project_id, category, initial_proforma, contract_awarded, approved_change_orders, cost_to_date, forecast_final_cost, coverage_state)

Separate status, owner, waiting-on, blocking and priority. Never infer one from another.

## 4. Relationship contract

Allowed values: Blocks, Supports, Parallel, Unrelated, Needs verification.

Co-occurrence is not dependency. Two items appearing in the same email, meeting, project or date is insufficient evidence.

Each relationship stores reason, source evidence, confidence, verifier, last verified timestamp and manual override. A process rule may support a link; an agent inference alone creates Needs verification.

San Marco reference behavior:
- Planning: Hold Letter response track.
- Plan Check: technical soils/submission-readiness track.
- Retaining a Civil Engineer blocks civil/grading scope and unlocks the Grading Plan.
- The Grading Plan may support the Planning response and may be an input to soils work.
- The Soils Report is not a Hold Letter task.

## 5. Priority engine

Calculate a comparable score from:

- hard blocker impact;
- number and importance of downstream items unlocked;
- deadline or appointment proximity;
- overdue age;
- follow-up due date and time since last response;
- internal controllability versus passive external waiting;
- evidence confidence;
- explicit manual priority.

Return priority_score plus a human-readable why_now and what_this_unblocks. Manual pin, snooze and priority override always win. Re-rank after every material action or evidence update and during nightly planning.

## 6. Agent pipeline

1. Evidence Intake: ingest email, attachment, document, Teams transcript or MP4 transcript and create immutable evidence.
2. Project Matching: map by case number, address, participants and thread history; ambiguous matches go to review.
3. Claim Extraction: separate Fact, Process Rule and Inference.
4. Task Reconciliation: match an existing task, update it, reopen it or propose a new one; never blindly append.
5. Process Mapping: match the sub-stage library first. A missing match creates a proposed Custom Workstream.
6. Dependency Agent: propose Blocks, Supports, Parallel, Unrelated or Needs verification with evidence.
7. Priority Agent: rank comparatively and explain why.
8. Follow-up Agent: set or propose follow-up dates and detect stale waiting.
9. Daily Planning Agent: prepare a short morning list without duplicating records.
10. State Writer: the only service allowed to commit agent-approved changes.

## 7. API contract

- GET /api/portfolio
- GET /api/projects/:id/process
- GET /api/actions?view=today|blocking|followups|waiting|all&groupBy=project
- PATCH /api/actions/:id with optimistic concurrency version
- POST /api/actions/:id/activities
- GET /api/actions/:id/evidence
- POST /api/agent-runs with source and time window
- GET /api/agent-proposals?state=pending
- POST /api/agent-proposals/:id/accept
- POST /api/agent-proposals/:id/reject
- GET /api/projects/:id/budget
- GET /api/payment-runs/current
- GET /api/invoices
- PATCH /api/invoices/:id
- GET /api/weekly-reviews/current
- POST /api/weekly-reviews/:id/save
- POST /api/weekly-reviews/:id/recordings

Every mutation writes activity_log and returns the updated canonical entity.

## 8. Trust and human control

- Manual input is first-class evidence and outranks inference.
- Conflicts create Verify; they never overwrite silently.
- Unknown stays unknown.
- Every agent proposal shows source, excerpt, confidence and proposed change.
- Every mutation is reversible and auditable.
- Stale tasks remain open until evidence or a human closes them.

## 9. Acceptance checklist

- The five fixed phases appear for every project.
- Conditional sub-stages activate without changing the global template.
- The same action ID appears across multiple views with no duplicate record.
- Grouped My Work rows do not repeat project name and support direct Update.
- Completing a task updates My Work and Project Process consistently.
- San Marco soils is displayed separately from the Hold Letter track.
- A relationship cannot become Blocks from co-occurrence alone.
- Every priority item explains Why now and What this unblocks.
- Low-confidence conflicts appear in Agent Review Inbox.
- Manual overrides survive later agent runs.
- Portfolio budget shows Partial Budget Coverage until complete.
- All state changes have evidence and an audit entry.
- Invoices is available from primary navigation and exact workbook dates are preserved.
- Invoice status, payment date and receipt link persist and update Payment Summary.
- Weekly Review carries forward prior actions and saves current statuses and notes.

## 10. Recommended implementation order

1. Database and canonical records.
2. Exact demo UI backed by seed data.
3. Manual updates, audit and optimistic concurrency.
4. Evidence ingestion and Review Inbox.
5. Reconciliation, dependency and priority agents.
6. Email/OneDrive/Teams connectors and scheduler.
7. Payments, budgets, consultant performance and forecasting.
