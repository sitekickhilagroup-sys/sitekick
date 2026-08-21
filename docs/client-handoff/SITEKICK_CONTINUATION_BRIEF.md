# Sitekick - Continuation Brief

Last updated: August 20, 2026

## How to continue this work

Open the existing Codex task and the deployed demo. Read this brief, then read `SITEKICK_IMPLEMENTATION_GUIDE.md`, `SITEKICK_BUILD_SPEC.md`, `SITEKICK_AGENT_OPERATING_MANUAL.md` and `SITEKICK_DESIGN_SYSTEM.md` before changing the product.

Continue in the same working style:

- Discuss product decisions with Noa in Hebrew.
- Keep the interface itself in English.
- Make the change in the demo, validate it and publish it before saying it is complete.
- Use normal hyphens `-`, never em dashes.
- Keep supporting text readable; do not make explanatory text tiny.
- Prefer `+` progressive disclosure instead of adding more visible copy.
- Do not automatically agree with Noa. Explain when a proposed structure is or is not professionally sound.
- Never invent project facts, dependencies or City process certainty.

## Product purpose

Sitekick is a calm operating system for Noa's real-estate development projects. It must transform evidence from email, documents, spreadsheets, Teams meetings, MP4 uploads and manual input into trustworthy project position, priorities, blockers, follow-ups and next steps.

Noa's primary goal is to look from above and immediately understand what is most urgent and what is stopping progress.

## Active projects

- 3375 Blair Dr
- 3701 Alta Mesa Dr
- 2650-2656 Rinconia Dr
- 2361-2367 San Marco Dr

Do not include the separate Blair LLC project.

## Fixed process model

Every project uses:

Planning > Plan Check > Bidding > Financing > Construction

Within these phases, use reusable sub-stages and conditional sub-stages. Hold Letter, Deemed Complete, Letter of Determination, Agency Clearance and Extension Determination are not new top-level phases.

Multiple workstreams may run in parallel. Show that visually instead of forcing a false sequence.

## Screen responsibilities

- Portfolio: understand project position, risk, next milestone and learning.
- My Work: Noa's main daily action surface.
- Project Process: investigate phases, sub-stages, evidence and connected actions.
- Invoices: permanent invoice and payment workspace accessible from primary navigation.
- Weekly Review: Sunday preparation and Monday project meeting.
- Developer Handoff: living product and implementation specification.

## Non-negotiable interaction rules

- One canonical task can appear in many views without being duplicated.
- Updates made in My Work or Project Process must update the same record.
- Blocking, urgency, status, owner and waiting-on are separate fields.
- My Work groups by project and ranks from most urgent to least urgent.
- Details use `+` to reveal concise context and recommended next move.
- Completed items from the prior week remain in Weekly Review with current status and current notes.
- Invoices have exact spreadsheet date, invoice number, source link, status, payment date and receipt link.
- Payment Run is one aggregated task that opens the invoice workspace.

## Current demo limitations

- Task, invoice and Weekly Review updates currently persist only in browser local storage, not a shared database.
- The invoice workbook is a snapshot, not a live OneDrive sync.
- Teams/MP4 upload is currently interaction design only; it does not yet upload, transcribe or extract tasks.
- Email ingestion, agents, recurring scans, notifications and Review Inbox are specified but not yet running services.
- Portfolio forecasts and consultant performance must remain evidence-based; do not invent historical metrics.

## Current evidence-sensitive decisions

- San Marco soils work is separate from the Planning Hold Letter track.
- Civil/grading work may support both tracks but that does not make them one chain.
- A blocker relationship requires explicit evidence or an approved process rule.
- Rinconia submitted for screening is not the same as accepted Plan Check intake.
- Alta Mesa Deemed Complete remains pending until written evidence is received.
- Blair Plan Check extension outcome remains unresolved unless newer evidence is supplied.

## Source data used

- Email export and Rowan's project updates were used to create the current project picture.
- Invoice snapshot came from `Hilla US - Invoices Tracker.xlsx`, with Payment Summary treated as the working source and To Pay ignored.
- Invoice links point to the existing SharePoint source documents.
- Partial project budget data came from the provided budget workbook and must remain labeled partial.

## Next recommended product work

1. Review the complete Developer Handoff with Azuri.
2. Decide the production stack and authentication model.
3. Implement canonical database records and shared persistence.
4. Replace local-only task, invoice and Weekly Review state.
5. Connect OneDrive invoice import and receipt storage.
6. Add email and Teams/MP4 ingestion with human review.
7. Validate agents against the real four-project evidence set before allowing automated writes.

## Continuity promise and limitation

The existing Codex task contains the full conversation and should be reopened for the richest continuity. This file provides a durable project brief if a new task is used. No assistant can guarantee identical reasoning in a separate future session, but using the same task plus this brief, the implementation guide and the live demo preserves the decisions and working method needed to continue reliably.

