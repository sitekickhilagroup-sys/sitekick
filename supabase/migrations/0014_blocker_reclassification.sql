-- Blocker reclassification — the D14 data pass.
--
-- 0009 added the classification columns and defaulted every existing row to
-- kind='verify' with confidence 0.50 and no target stage. That default is the
-- honest one: none of these rows carried the evidence the audit requires. The
-- consequence is that Portfolio shows zero blockers until this pass runs.
--
-- Source of truth: docs/superpowers/plans/2026-08-24-analyst-agent-and-project-audit.md
-- section 5, "Blocker classification — the D14 source data".
--
-- Two live-data facts shape what this can set.
--
-- 1. project_stages.substage is NULL on all 64 rows, so lib/queries.ts builds an
--    empty activeSubstages and blocks_substage can never match. Every target is
--    therefore expressed as blocks_phase. Restoring substage is separate work.
--
-- 2. targetsCurrentStage compares blocks_phase to projects.current_phase_key
--    ('planning' / 'plan_check'), NOT to project_stages.stage_key
--    ('entitlements' / 'plan_check'). Those two disagree for San Marco and
--    Alta Mesa, so the phase keys below are current_phase_key values.
--
-- What this deliberately does NOT do: create blocker rows the audit says are
-- missing (San Marco's Dedication / Waiver strategy, Rinconia's and Alta Mesa's
-- Civil / Grading and LID rows). Those need evidence that does not exist in the
-- database yet, and inventing them is exactly the false certainty the audit
-- forbids. San Marco therefore leads with a workstream blocker labelled as one,
-- rather than a primary that has no supporting record.

-- ── 3375 Blair Dr — the one true Primary ─────────────────────────────────
-- Gates the continue-vs-resubmit decision inside the current Plan Check phase,
-- so it targets current_phase_key and becomes the card headline.
update blockers set
  kind                 = 'primary',
  blocks_phase         = 'plan_check',
  blocked_deliverable  = 'Plan Check Extension determination',
  release_condition    = 'Written confirmation from Planning (Tony Russo / Abhi) of what Eugene Barbeau decided on the 08/18 call',
  relationship_reason  = $t$The 08/18 call with Planning produced no written outcome. Until the determination exists in writing the continue-vs-resubmit decision cannot be made, and a denial forces the plans to resubmit as a new Plan Check under the current code cycle.$t$,
  confidence           = 0.80,
  effective_from       = '2026-08-18',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = 'b18a889e-73b2-4427-8de2-6c5cff87f5e5';

-- ── 2361-2367 San Marco ──────────────────────────────────────────────────
-- Civil engineer not retained. Audit downgrades this from primary: it gates the
-- grading plan, not every Hold Letter item. blocks_phase stays 'planning'
-- because the Hold Letter response does sit in Planning; kind is what keeps it
-- out of the headline.
update blockers set
  kind                 = 'workstream',
  blocks_phase         = 'planning',
  blocked_deliverable  = 'Civil / Grading Plan for the Hold Letter response',
  release_condition    = 'Mid-Cities sign the MSA, or Refael awards another civil engineer',
  relationship_reason  = $t$The Hold Letter response requires a grading plan and no engineer is retained, because Mid-Cities will not sign the MSA provided. Rowan is negotiating or approaching other engineers pending Refael's decision. Scoped to the civil / grading track: it does not block every Hold Letter item.$t$,
  confidence           = 0.85,
  effective_from       = '2026-08-15',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = '324628a7-5d79-409d-834f-bc2fdb681aeb';

-- Soils corrections. Audit is explicit that this gates the soils track only and
-- must not claim the Hold Letter, absent a shared deliverable — so no phase.
update blockers set
  kind                 = 'workstream',
  blocks_phase         = null,
  blocked_deliverable  = 'Soils / geology report corrections',
  release_condition    = 'Grover-Hollingsworth agree scope and hours, then respond to the LADBS grading division denial',
  relationship_reason  = $t$LADBS grading division denied the soils/geology report and corrections must go back through the engineer who prepared it. Scoped to soils: no shared deliverable ties this to the Hold Letter response.$t$,
  confidence           = 0.80,
  effective_from       = '2026-08-22',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = '51253f23-18ba-406c-a007-fc29392be842';

-- ── 2650 Rinconia ────────────────────────────────────────────────────────
-- Soils addendum. No phase: the audit forbids claiming this gates intake
-- acceptance without written LADBS confirmation, which does not exist.
update blockers set
  kind                 = 'workstream',
  blocks_phase         = null,
  blocked_deliverable  = 'Soils report addendum',
  release_condition    = 'Bob returns the reviewed addendum and it is resubmitted to LADBS',
  relationship_reason  = $t$LADBS returned the soils report and requires an addendum. Scoped to soils approval: there is no written LADBS confirmation that the addendum gates Plan Check intake acceptance.$t$,
  confidence           = 0.75,
  effective_from       = '2026-08-22',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = '9962cedf-31eb-461e-9173-1f7621fad82f';

-- BOE Form 100-B. Real deadline, but nothing in the permit chain depends on it,
-- so it ranks in My Work and never counts as a project blocker.
update blockers set
  kind                 = 'urgent_action',
  blocks_phase         = null,
  blocked_deliverable  = null,
  release_condition    = 'Refael answers Rowan''s outstanding questions so the response can be filed',
  relationship_reason  = $t$Third and final County request, so the deadline is real. Nothing in the permit chain depends on it: this is a legal / tax matter, not a Plan Check blocker.$t$,
  confidence           = 0.90,
  effective_from       = '2026-08-15',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = '917c4983-c410-4ff1-8bcc-87204a002a78';

-- ── 3701 Alta Mesa ───────────────────────────────────────────────────────
-- Deemed Complete letter. External gate: nothing outstanding on our side, and
-- the follow-up belongs to Crest. Leads the card via FALLBACK_ORDER, labelled
-- as a gate rather than as a project-wide blocker.
update blockers set
  kind                 = 'external_gate',
  blocks_phase         = 'planning',
  blocked_deliverable  = 'Deemed Complete letter',
  release_condition    = 'City Planning (Abraham Lamontagne) issues the Deemed Complete letter',
  relationship_reason  = $t$Expected end of July and still not issued; the City record shows no approved documents. Per the 08/03 meeting nothing is outstanding on our side, so this is a wait on the City with Crest owning the follow-up.$t$,
  confidence           = 0.85,
  effective_from       = '2026-07-31',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = '307c359b-8b86-41b7-a63a-e6b2618e1140';

-- QMS payment / file release. Audit allows urgent_action or workstream, and
-- says workstream only while nonpayment actually prevents release. It does:
-- Quality Mapping are withholding the mailing files pending payment.
update blockers set
  kind                 = 'workstream',
  blocks_phase         = null,
  blocked_deliverable  = 'Neighbour notice mailing files from Quality Mapping',
  release_condition    = 'Pay $923.42 ($627.00 + $296.42) and return the signed proposal so QMS release the mailing files',
  relationship_reason  = $t$The hearing cannot be scheduled until neighbour notices are mailed, and Quality Mapping are withholding the mailing files pending payment. Classified workstream rather than urgent action because nonpayment currently does prevent release.$t$,
  confidence           = 0.80,
  effective_from       = '2026-08-22',
  last_verified_at     = '2026-08-24T00:00:00Z',
  manually_corrected_by = 'blocker-audit-2026-08-24'
where id = 'd761dc77-59a0-4fa4-8cb0-e7a6af7bfe21';
