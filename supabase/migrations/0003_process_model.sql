-- supabase/migrations/0003_process_model.sql
-- Sprint B: canonical fixed phases + substage library + parallel workstreams.

create table phases (
  key      text primary key,
  label    text not null,
  position int  not null
);
insert into phases (key, label, position) values
  ('planning','Planning',1),
  ('plan_check','Plan Check',2),
  ('bidding','Bidding',3),
  ('financing','Financing',4),
  ('construction','Construction',5);

create type substage_kind as enum ('standard','conditional');
create table substage_templates (
  id        uuid primary key default gen_random_uuid(),
  phase_key text not null references phases(key),
  name      text not null,
  kind      substage_kind not null default 'standard',
  position  int not null default 0,
  unique (phase_key, name)
);

-- Reusable library. Conditional sub-stages (spec: Hold Letter, Deemed Complete,
-- Letter of Determination, Agency Clearance, Extension Determination) activate
-- per project; they are NOT top-level phases.
insert into substage_templates (phase_key, name, kind, position) values
  ('planning','Application filed','standard',1),
  ('planning','Case accepted (deemed complete)','conditional',2),
  ('planning','Hold Letter response','conditional',3),
  ('planning','Hearing','standard',4),
  ('planning','Letter of Determination','conditional',5),
  ('planning','Entitlement granted','standard',6),
  ('plan_check','Intake accepted','standard',1),
  ('plan_check','Corrections round','standard',2),
  ('plan_check','Agency clearance','conditional',3),
  ('plan_check','Extension determination','conditional',4),
  ('plan_check','Permit ready to issue','standard',5),
  ('bidding','Bid package prepared','standard',1),
  ('bidding','Contractor selection','standard',2),
  ('bidding','Contract awarded','standard',3),
  ('financing','Loan application','standard',1),
  ('financing','Appraisal','standard',2),
  ('financing','Loan closing','standard',3),
  ('construction','Mobilization','standard',1),
  ('construction','Grading','standard',2),
  ('construction','Foundation','standard',3),
  ('construction','Framing','standard',4),
  ('construction','Final inspections','standard',5),
  ('construction','Certificate of occupancy','standard',6);

create type workstream_status as enum ('active','done');
create table workstreams (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name       text not null,
  phase_key  text not null references phases(key),
  status     workstream_status not null default 'active',
  unique (project_id, name)
);

create type project_substage_status as enum ('upcoming','active','done','not_applicable');
create table project_substages (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  substage_template_id uuid not null references substage_templates(id),
  workstream_id        uuid references workstreams(id) on delete set null,
  status               project_substage_status not null default 'upcoming',
  note                 text,
  activated_at         date,
  completed_at         date,
  unique (project_id, substage_template_id)
);

-- Bridge: legacy project_stages.stage_key / tasks.stage_key -> canonical phase.
create table stage_phase_map (
  stage_key text primary key,
  phase_key text not null references phases(key)
);

-- Discovery (2026-08-21, live DB via scratch-keys.sql): distinct stage_key values
-- across project_stages + tasks were: Accounting, b_permit, delivery, Design,
-- entitlements, Entity, feasibility, Finance, foundation, framing, grading,
-- haul_route, inspections, Legal, Ops, permits, plan_check, Property, rti.
-- The 12 lowercase/underscore keys below are the physical construction-process
-- stage graph (confirmed against supabase/seed/data.json's per-project "stages"
-- object, which walks feasibility -> ... -> delivery in this exact order).
-- The 7 capitalized keys (Accounting, Design, Entity, Finance, Legal, Ops,
-- Property) are task-only admin/department tags -- every task carrying one of
-- them has admin=true in the seed data, none corresponds to a project_stages
-- row -- so they are intentionally left unmapped; per Task-1 brief they fall
-- back to the project's current_phase_key in Task 2's queries. "soils_survey"
-- (in the brief's suggested defaults) does not appear in the live discovery
-- result, so it is omitted here.
insert into stage_phase_map (stage_key, phase_key) values
  ('feasibility','planning'),
  ('entitlements','planning'),
  ('plan_check','plan_check'),
  ('rti','plan_check'),
  ('permits','plan_check'),
  ('b_permit','plan_check'),
  ('haul_route','plan_check'),
  ('grading','construction'),
  ('foundation','construction'),
  ('framing','construction'),
  ('inspections','construction'),
  ('delivery','construction');

alter table projects add column current_phase_key text references phases(key);

-- Client feedback (Noa 2026-08-21): her manually-entered substages from the legacy
-- settings screen are "not necessarily correct or relevant" — wipe them.
update project_stages set substage = null;

-- Seed current positions from the client's seed contract (sitekick-seed-contract.json):
-- blair: Plan Check (parallel Planning) · alta: Planning (parallel Plan Check)
-- san-marco: Planning (parallel Design/Engineering) · rinconia: Plan Check (parallel Design/Engineering)
-- Verified against live discovery (2026-08-21): real project names are
-- "3375 Blair Dr", "3701 Alta Mesa", "2361-2367 San Marco", "2650 Rinconia" —
-- the ilike patterns below already match them verbatim; no adjustment needed.
update projects set current_phase_key = 'plan_check' where name ilike '%blair%' or name ilike '%rinconia%';
update projects set current_phase_key = 'planning'   where name ilike '%alta mesa%' or name ilike '%san marco%';

insert into workstreams (project_id, name, phase_key)
select id, 'Planning', 'planning' from projects where name ilike '%blair%';
insert into workstreams (project_id, name, phase_key)
select id, 'Plan Check', 'plan_check' from projects where name ilike '%alta mesa%';
insert into workstreams (project_id, name, phase_key)
select id, 'Design / Engineering', 'plan_check' from projects where name ilike '%san marco%' or name ilike '%rinconia%';

alter table phases             enable row level security;
alter table substage_templates enable row level security;
alter table workstreams        enable row level security;
alter table project_substages  enable row level security;
alter table stage_phase_map    enable row level security;
create policy "read phases"             on phases             for select to authenticated using (true);
create policy "read substage_templates" on substage_templates for select to authenticated using (true);
create policy "read workstreams"        on workstreams        for select to authenticated using (true);
create policy "read project_substages"  on project_substages  for select to authenticated using (true);
create policy "read stage_phase_map"    on stage_phase_map    for select to authenticated using (true);
