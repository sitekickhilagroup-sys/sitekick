-- Sub-stage library additions + the applicability axis.
--
-- Two problems this fixes.
--
-- 1. The library is too thin to describe the four real projects. The target
--    screenshot for San Marco's Planning phase lists eight sub-stages —
--    Application & Intake, Completeness Review, Hold Letter Corrections,
--    Dedication / Waiver Resolution, Resubmittal, Deemed Complete, Notice &
--    Hearing, Letter of Determination — where the library holds six, several
--    under different names. Plan Check has no "submission" step at all, so the
--    confusion the spec warns about ("plans are being prepared does not mean
--    plan check is active") is literally unrepresentable.
--
-- 2. Applicability was conflated with status. The spec keeps them apart: a
--    stage can be Applicable-verified, Conditional, Not applicable, Unknown or
--    Hidden, independently of whether it is Active, Waiting or Done. Without
--    that axis every standard template renders for every project and defaults
--    to Upcoming — the "false certainty" the spec forbids.

-- ── Applicability, separate from status ──────────────────────────────────
create type substage_applicability as enum (
  'applicable',      -- verified as part of this project's path
  'conditional',     -- applies only if a defined condition becomes true
  'not_applicable',  -- proven not to apply
  'unknown',         -- not yet determined — the honest default
  'hidden'           -- deliberately withheld from this project's view
);

alter table project_substages
  add column applicability substage_applicability not null default 'unknown',
  -- The spec requires every stage to link to its supporting evidence and to
  -- show the latest evidence date and confidence. Blockers got these in 0009;
  -- sub-stages did not.
  add column evidence_document_id uuid references documents(id),
  add column confidence           numeric(3,2) not null default 0.50,
  add column last_verified_at     timestamptz,
  add column completion_evidence  text,
  -- Mirrors the 0009 pattern: a human's call outranks the agent's.
  add column manually_corrected_by text;

comment on column project_substages.applicability is
  'Whether this sub-stage is part of the project path at all. Separate from status: an applicable stage may still be upcoming, and a conditional one must not read as planned.';

-- ── Planning: the entitlement path the four projects actually follow ─────
-- Hearing is reclassified. The spec is explicit that it "activates only when
-- required or officially scheduled", and seeding it as standard made it show
-- as an assumed step on every project.
update substage_templates set kind = 'conditional'
  where phase_key = 'planning' and name = 'Hearing';

insert into substage_templates (phase_key, name, kind, position) values
  ('planning','Completeness review','standard',2),
  ('planning','Hold Letter corrections','conditional',4),
  ('planning','Dedication / waiver resolution','conditional',5),
  ('planning','Resubmittal','conditional',6),
  ('planning','Notification package','conditional',8),
  ('planning','Mailing / notice proof','conditional',9),
  ('planning','Hearing held','conditional',11),
  ('planning','Appeal period','conditional',12),
  ('planning','Entitlement in effect','standard',14),
  -- Blair's corrective Plan Approval track. It runs inside Planning while the
  -- existing Plan Check stays the primary phase, so these are conditional:
  -- they apply only to a project on that track.
  ('planning','Plan Approval filing requirements','conditional',20),
  ('planning','Plan Approval filing appointment','conditional',21),
  ('planning','Plan Approval application filed','conditional',22),
  ('planning','Planning fees paid','conditional',23),
  ('planning','Planning review / conditions','conditional',24),
  ('planning','Plan Approval determination','conditional',25),
  ('planning','Planning clearance','conditional',26),

-- ── Plan Check: the submission step and what follows it ─────────────────
  ('plan_check','Submission / intake screening','standard',0),
  ('plan_check','Fee payment','standard',2),
  ('plan_check','Resubmittal','conditional',3),
  ('plan_check','Soils review / addendum','conditional',6),
  ('plan_check','LID clearance','conditional',7),
  ('plan_check','B Permit','conditional',8)
on conflict (phase_key, name) do nothing;

-- Every list query filters by project and applicability.
create index idx_project_substages_applicability
  on project_substages(project_id, applicability);
