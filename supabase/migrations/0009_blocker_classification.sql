-- Blocker classification — from the client doc's "Blocker Audit and Required
-- Corrections" tab, section "System logic and Portfolio card derivation".
--
-- The audit's core finding: a task can be important, urgent, or waiting on
-- someone without being a true blocker. Every blocker must name the exact
-- stage it prevents and the evidence supporting that relationship.
--
-- The mandatory test, which the system must answer before setting blocking:
--   1. Which exact phase, sub-stage, milestone or deliverable cannot advance?
--   2. What must be completed or decided to release it?
--   3. Which source proves that dependency?
--   4. Is the relationship current, or has later evidence changed it?
-- If those cannot be answered, the item is not Blocking.

create type blocker_kind as enum (
  'primary',           -- prevents the current primary phase / active sub-stage
  'workstream',        -- prevents one parallel workstream, not the whole project
  'future_gate',       -- will block a later milestone, not today
  'external_gate',     -- waiting on City or third party; a follow-up, not our blocker
  'urgent_action',     -- needs attention but prevents no defined stage
  'verify',            -- causal link or completion not sufficiently evidenced
  'information_only'   -- context only; no action, no blocker
);

alter table blockers
  -- Existing rows predate the classification and carry none of the evidence the
  -- mandatory test requires, so 'verify' is the only honest default: they stop
  -- counting as confirmed blockers until the audit reclassifies them. The audit
  -- tab lists the correct kind per project per blocker — that is a data pass.
  add column kind                  blocker_kind not null default 'verify',
  add column blocks_phase          text,
  add column blocks_substage       text,
  add column blocked_deliverable   text,
  add column relationship_reason   text,
  add column confidence            numeric(3,2) not null default 0.50,
  add column effective_from        date,
  add column last_verified_at      timestamptz,
  add column release_condition     text,
  -- Noa's manual classification always beats the agent's. Set this and the
  -- agent may not overwrite the row without new contradicting evidence.
  add column manually_corrected_by text,
  add column undo_event_id         uuid;

-- The doc calls this field source_evidence_id; blockers.document_id already
-- holds exactly that reference, so it is reused rather than duplicated.

comment on column blockers.kind is
  'Classification from the blocker audit. Only primary and workstream count toward a project blocking count.';
comment on column blockers.manually_corrected_by is
  'Set when a human fixes the classification. Agents must not overwrite a manually corrected row without new contradicting evidence and approval.';

-- Portfolio card derivation filters on project + kind + status.
create index idx_blockers_kind on blockers(project_id, kind, status);
