# Sitekick - Simple Implementation Guide for Azuri

## The goal

Build the supplied Sitekick demo one-to-one first. Do not redesign it during the first implementation. The demo is the visual and behavioral reference; this document explains what must sit behind it.

Sitekick turns emails, documents, recorded Teams meetings, uploaded MP4 files, spreadsheets and Noa's manual updates into one trustworthy view of four real-estate projects.

The system must answer four questions:

1. Where is every project in the process?
2. What does Noa need to do today?
3. What is truly blocking progress, and what does it block?
4. What evidence supports every status, task and relationship?

## Build these six product areas

### 1. Portfolio

Purpose: understand the whole portfolio without becoming another task list.

- Show all active projects, ordered by attention.
- Each project opens as an accordion.
- Show current phase, parallel workstream, main blocker, next milestone and what happens after it.
- Show only compact portfolio-level intelligence: timing, blockers, budget coverage, consultant performance and forecast.
- Clicking a risk or project opens the underlying canonical record in My Work or Project Process.

### 2. My Work

Purpose: Noa's main daily action screen.

- Views: Today, Blocking, Follow-ups, Waiting and All.
- Group tasks by project, then rank them from most urgent to least urgent.
- The same task may appear in several views, but it must remain one database record.
- Every row supports a direct update: Completed, Sent email, Waiting, Delayed, Scheduled, Not applicable or Add note.
- The `+` control opens a short explanation: what the task means, previous context, evidence, what it affects and recommended next move.
- A manual update here must immediately appear in Project Process and every other view.

### 3. Project Process

Purpose: investigate one project and understand its process.

- Every project uses the same fixed top-level phases: Planning > Plan Check > Bidding > Financing > Construction.
- Each phase contains reusable sub-stages.
- Conditional sub-stages appear only when relevant, for example Hold Letter Response, Deemed Complete, Extension Determination or Agency Clearance.
- Parallel workstreams must be shown as parallel, not forced into one false sequence.
- Connected actions are the same canonical task records used in My Work.
- Noa can update a task here, and the update must sync everywhere.

### 4. Invoices

Purpose: a permanent financial workspace, accessible directly from the main navigation.

- Show invoice number, exact date from the spreadsheet, vendor, project/entity, description, status and amount.
- Never calculate a fake Service Month. Use the exact date entered in the workbook.
- `Open invoice` opens the stored invoice link.
- `Update` opens invoice editing: Received, Approved or Paid; payment date; receipt link.
- `Open receipt` opens the saved receipt.
- Payment Summary is a separate view of the same invoice records.
- My Work contains only one aggregated Payment Run action; it links here instead of copying every invoice as a task.
- Production must import and reconcile the workbook by vendor, invoice number, amount and project. The current demo is a snapshot, not live sync.

### 5. Weekly Review

Purpose: prepare on Sunday and run the Monday project meeting.

- Preserve the fixed hierarchy: Project > Sub-topic > Actions.
- Carry forward every action from the previous meeting, including completed actions, with its latest status.
- Add new evidence and new tasks found during the week.
- Keep a current weekly note / next step for each action.
- Allow status updates and a clear Save Review action.
- Allow a Teams recording or MP4 to be uploaded after the meeting.
- In production, transcribe the recording, extract proposed updates and new tasks, and send uncertain changes to Review Inbox before writing them.

### 6. Developer Handoff

Purpose: keep the implementation specification inside the product.

- Include this guide, the full Build Specification, Agent Operating Manual, Design System, seed data contract and Continuation Brief.
- Treat these documents as a living specification and update them whenever product behavior changes.

## The most important architecture rule

One fact or task is stored once and displayed in many places.

Do not build separate task lists for Portfolio, My Work, Project Process and Weekly Review. Build one canonical action table and query it differently for every screen.

Example:

- `Confirm Plan Check extension decision` is one action.
- It can appear in Today because it is urgent.
- It can appear in Blocking because it stops progress.
- It can appear in Blair's Project Process because it belongs to Extension Determination.
- Updating it in any location updates the same record everywhere.

## Fixed template plus dynamic reality

Use a layered model:

1. Fixed process phases for every project.
2. Reusable sub-stage library.
3. Conditional rules that activate relevant sub-stages.
4. Project-specific requirements and actions.
5. Custom workstream only when no standard mapping fits, with human review.

This gives Noa a consistent structure without forcing every project to behave identically.

## Relationship rules

Allowed relationship types:

- Blocks: B cannot progress without A.
- Supports: A helps B, but B is not stopped without it.
- Parallel: separate tracks can progress independently.
- Unrelated: same project or email, but no actual dependency.
- Needs verification: the connection is plausible but unproven.

Never infer a blocker because two items appeared in the same email, meeting or project.

San Marco is the key test case:

- The Planning Hold Letter response and technical soils work are separate tracks.
- Retaining a Civil Engineer can block definition of the civil/grading scope.
- A Grading Plan may support the Hold Letter response and may separately supply information needed for soils.
- The Soils Report is not itself a Hold Letter task.

## Agent system

Agents do not directly rewrite project truth from an email. Use a controlled pipeline:

1. Evidence Intake stores the source and extracts atomic claims.
2. Project Matching selects the project or sends ambiguity to review.
3. Task Reconciliation updates an existing task, proposes a new one, reopens one or proposes completion.
4. Process Mapping connects the task to the correct phase, sub-stage and workstream.
5. Dependency Agent proposes Blocks, Supports, Parallel, Unrelated or Needs verification.
6. Priority Agent compares every task and explains why one ranks above another.
7. Follow-up Agent wakes waiting tasks when a follow-up is due.
8. Daily Planning Agent prepares the morning list from existing tasks.
9. Payment Agent reconciles invoices and creates one Payment Run action.
10. State Writer is the only service that commits approved agent changes.

Every proposal stores its evidence, confidence and reasoning. Conflicts and low confidence go to Agent Review Inbox. Manual updates always outrank inference.

## Priority logic

Rank tasks comparatively using:

- verified blocker impact;
- importance of downstream work unlocked;
- deadline or appointment proximity;
- overdue age;
- follow-up due date and time since last response;
- internal action versus passive external waiting;
- evidence confidence;
- Noa's manual pin, snooze or priority override.

Every ranked task must show `Why now` and `What this unlocks`. Red means a verified blocker, not merely something urgent.

## Evidence and trust

- Preserve every original email, document, transcript and spreadsheet row.
- Store source link, author, occurred date, excerpt or timestamp and ingestion date.
- Separate Fact, Process Rule and Inference.
- Submitted does not mean accepted.
- Requested does not mean completed.
- Sent does not mean received.
- Unknown remains unknown.
- Conflicts create Verify instead of silent overwrite.
- Every change is reversible and appears in an audit trail.

## Recommended build order

1. Reproduce the demo screens and navigation one-to-one.
2. Create the canonical database and seed it with the four projects.
3. Connect My Work and Project Process to the same action records.
4. Add manual updates, notes, audit log and undo.
5. Implement Invoices and Payment Summary with real persistence.
6. Implement Weekly Review and saved meeting state.
7. Add evidence upload, email ingestion and Teams/MP4 transcription.
8. Add reconciliation, process mapping, dependency and priority agents.
9. Add Review Inbox, recurring mailbox scans and nightly planning.
10. Add budgets, consultant performance and evidence-based forecasting.

## Definition of done

- All six product areas match the demo.
- Every project shows the five fixed phases.
- Conditional and parallel work are represented correctly.
- One task record updates everywhere immediately.
- Invoice edits persist and Payment Summary uses the same records.
- Weekly Review persists statuses, notes and meeting evidence.
- Every agent suggestion is evidence-backed and auditable.
- Manual overrides survive later agent runs.
- No screen invents certainty that the evidence does not support.

