-- "Impact on process" as a field of its own.
--
-- From the reviewed work map: add a separate field on Update called Impact on
-- process, with the options Primary Blocker, Workstream Blocker, Future Gate,
-- External Gate, Not Blocking and Verify — and, stated plainly, "task status
-- and impact type are two different fields. A task can be Waiting without
-- being Blocking."
--
-- Today My Work derives Blocking from `priority === 'critical'`, which is why
-- every urgent task reads as a blocker, and why the audit's central complaint —
-- "an urgent task that does not stop a stage is not a Main Blocker" — is as
-- true of the task list as it is of the Portfolio card.
--
-- This enum is deliberately NOT blocker_kind. It carries 'not_blocking', which
-- blocker_kind has no member for (there, not being a blocker means no row
-- exists), and it omits urgent_action and information_only, which describe a
-- blocker record rather than a task's effect on the process.

create type process_impact as enum (
  'primary_blocker',     -- stops the current primary phase or active sub-stage
  'workstream_blocker',  -- stops one parallel workstream, not the project
  'future_gate',         -- will stop a later milestone, not today
  'external_gate',       -- waiting on the City or a third party
  'not_blocking',        -- needs doing; prevents no stage from advancing
  'verify'               -- the causal claim is not sufficiently evidenced
);

-- Nullable on purpose. Null means nobody has classified this task yet, and the
-- legacy priority heuristic still applies, so no existing row changes how it
-- reads today. Setting the field takes precedence over the heuristic.
alter table tasks add column process_impact process_impact;

comment on column tasks.process_impact is
  'Effect on the process, separate from status. Null = unclassified, legacy priority heuristic applies. A task may be Waiting without being Blocking.';

-- My Work filtering and Today ranking both read this.
create index idx_tasks_process_impact on tasks(process_impact) where process_impact is not null;
