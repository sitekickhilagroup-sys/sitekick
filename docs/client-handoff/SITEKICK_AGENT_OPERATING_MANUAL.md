# Sitekick - Agent Operating Manual

## Why agents are central

The agents are not a chatbot layer on top of a tracker. They are the operating system that turns unstructured evidence into a trustworthy project model. Their job is to keep projects, actions, dependencies, follow-ups and priorities current without silently inventing facts.

No single agent is allowed to read an email and directly rewrite project truth. Work is separated so that extraction, interpretation, reconciliation, prioritization and writing can be tested independently.

## Shared rules for every agent

1. Evidence before state.
2. Co-occurrence is not dependency.
3. Submitted is not accepted; requested is not completed; planned is not scheduled; sent is not received.
4. Fact, Process Rule and Inference are separate claim types.
5. Unknown stays unknown.
6. Manual input outranks agent inference.
7. Conflicts create Verify.
8. One canonical action record; views never create copies.
9. Every proposal explains why, cites evidence and includes confidence.
10. Only the State Writer may commit an agent-generated state change.

## Agent 1 - Evidence Intake

Trigger: new email, attachment, uploaded document, Teams transcript, MP4 transcript, scheduled mailbox scan or manual upload.

Inputs: source content, metadata, participants, timestamps, attachments, thread identifiers.

Decision tree:
- If content is duplicated by content hash or message ID, link it; do not ingest twice.
- If an attachment or recording needs extraction, create child evidence with page or timestamp references.
- Extract atomic claims, each labeled Fact, Process Rule or Inference.
- Preserve the original source; never replace it with a summary.

Outputs: immutable evidence records and atomic claims. It cannot create, close or reprioritize tasks.

## Agent 2 - Project Matching

Trigger: new evidence claims without a confirmed project ID.

Inputs: address, case number, permit number, participants, subject, thread history and known aliases.

Decision tree:
- Exact case/permit number match: high confidence.
- Address plus known participants: medium/high confidence.
- Participant alone or ambiguous address: propose candidates.
- Multiple plausible projects: Agent Review Inbox.

Output: project match proposal with confidence and matching reasons. It cannot guess a project silently.

## Agent 3 - Task Reconciliation

Trigger: project-matched evidence describing requested, completed, delayed or changed work.

Inputs: claims, existing open and recently closed actions, owners, vendors, dates and evidence.

Decision tree:
- Same objective + project + requirement: update existing action.
- New evidence confirms completion: propose completion with evidence.
- New evidence contradicts completion: reopen proposal or Verify.
- Similar wording but different deliverable: keep separate.
- No match: propose a new action.

Output: upsert/reopen/close/new-task proposal. Never blindly append from every email.

## Agent 4 - Process Mapping

Trigger: new or materially changed action, requirement or city/consultant outcome.

Inputs: fixed phase template, sub-stage library, project type, evidence and action objective.

Decision tree:
- Match a standard sub-stage.
- If a known condition is present, activate a conditional sub-stage.
- If work spans two tracks, map one record to multiple relationships without duplicating it.
- If no library match exists, propose Custom Workstream with human review.

Example conditions:
- IF Hold Letter issued THEN activate Hold Letter Response.
- IF case accepted as Deemed Complete THEN advance Completeness Review and activate notice/hearing preparation.
- IF extension denied THEN activate current-code resubmittal.
- IF Plan Check submission is only sent for screening THEN do not mark Application & Intake accepted.
- IF a condition requires a department clearance THEN create the relevant requirement under Agency Clearances.

## Agent 5 - Dependency Agent

Trigger: new/changed action, requirement, sub-stage or evidence about prerequisites.

Allowed relationships: Blocks, Supports, Parallel, Unrelated, Needs verification.

Decision tree:
- Explicit source says A is required before B: propose Blocks.
- Approved process rule says A is a prerequisite: propose Blocks with rule citation.
- A improves or supplies B but B may continue: Supports.
- Separate tracks can progress independently: Parallel.
- Same email/project/date only: Unrelated or Needs verification; never Blocks.
- Evidence conflicts: Verify.

San Marco example:
- Retain Civil Engineer Blocks definition of civil/grading scope.
- Grading Plan Supports the Planning Hold Letter response.
- Grading information may Blocks/Supports soils finalization only when Grover or a technical requirement confirms it.
- Soils Report is Parallel to the Hold Letter track and belongs to Plan Check technical design.

Each relationship stores reason, evidence, confidence, verifier, last verified date and manual override.

## Agent 6 - Priority Agent

Trigger: task/evidence/status/dependency change, nightly planning or manual rerank.

Inputs: blocker impact, downstream unlocks, deadlines, overdue age, follow-up date, waiting age, internal controllability, evidence confidence and manual priority.

Decision tree:
- Hard blocker with near deadline ranks above non-blocking work.
- For similar impact, internal action ranks above passive external waiting.
- Waiting becomes actionable when its follow-up is due.
- Low confidence may still rank high, but as Verify-not as a fact.
- Manual pin/snooze/priority always wins.

Outputs: comparable priority score, Why now, What this unblocks and confidence. It must explain why item #3 is below item #2.

## Agent 7 - Follow-up Agent

Trigger: Sent email, Waiting, external request, promised response date or stale evidence.

Behavior:
- Set/propose the next follow-up date.
- Track who owes the response and the last contact date.
- Wake the canonical action when follow-up is due.
- Do not create a second follow-up task.
- Do not close waiting work merely because no new email arrived.

## Agent 8 - Daily Planning Agent

Trigger: nightly schedule, morning refresh or manual request.

Inputs: ranked actions, follow-ups due, deadlines, calendar events, estimated effort and manual pins.

Outputs: a short Today view, grouped by project and ranked globally. It queries existing records and never duplicates them.

## Agent 9 - Payment Agent

Trigger: invoice email, workbook/import update, approval or scheduled payment run.

Behavior:
- Reconcile by vendor, invoice number, amount and project.
- Preserve the exact invoice date entered in the source workbook. Never derive a Service Month.
- Store the source invoice link, payment date and receipt link on the canonical invoice.
- Preserve invoice-level Paid, Approved to Pay, Outstanding, Committed and Remaining Contract states.
- Aggregate actionable invoices into one Payment Run task.
- Payment Summary is the working source; ignore To Pay when instructed.
- Manual approval/payment status outranks workbook inference.

## Agent 10 - Weekly Review Agent

Trigger: Sunday preparation, manual meeting preparation, newly uploaded Teams/MP4 evidence or completion of the Monday meeting.

Behavior:
- Start from the prior review and carry every action forward, including completed items.
- Refresh each item with current canonical status and the latest weekly note.
- Preserve Project > Sub-topic > Action hierarchy.
- Add newly discovered actions as proposals; do not silently append duplicates.
- Transcribe uploaded meeting evidence and retain timestamped source references.
- Route ambiguous owners, dates, status changes and new blockers to Review Inbox.
- Treat Noa's saved meeting decisions as authoritative manual evidence.

## Agent 11 - State Writer

Trigger: approved proposal, safe deterministic rule or manual update.

Responsibilities:
- Enforce optimistic concurrency and idempotency.
- Validate allowed state transitions.
- Respect manual overrides.
- Write one atomic transaction across canonical records and activity log.
- Publish a state-changed event so every screen refreshes immediately.

It is the only agent/service permitted to mutate project truth.

## Cross-agent orchestration

Evidence Intake → Project Matching → Claim Extraction → Task Reconciliation → Process Mapping → Dependency → Priority → Review Inbox or State Writer → Follow-up, Daily, Payment and Weekly Review views.

Every stage passes structured output, not prose. Failed or low-confidence stages stop safely and create a review item. Later agents cannot upgrade confidence without new evidence or an approved rule.

## Human Review Inbox categories

- Ambiguous project match.
- Proposed custom sub-stage/workstream.
- Conflicting status evidence.
- Proposed Blocks relationship without strong evidence.
- Duplicate candidate with materially different deliverables.
- Agent proposal conflicting with manual override.
- Priority anomaly or missing deadline/owner.

Review actions: Accept, Edit and accept, Reject, Keep unknown, Create manual rule. Every decision becomes training/evaluation data but does not automatically retrain production behavior.

## Required evaluations

- Same email mentions Hold Letter and soils: agent does not infer dependency.
- Email says package sent: agent does not mark City acceptance.
- User marks task complete: later stale email does not reopen it automatically.
- Two emails request the same deliverable: one task, two evidence links.
- A follow-up becomes due: same action appears in Today and Follow-ups without duplication.
- Extension outcome is missing: status remains Verify and both future branches remain conditional.
- Manual relationship override survives future scans.
- Conflicting project matches enter Review Inbox.
