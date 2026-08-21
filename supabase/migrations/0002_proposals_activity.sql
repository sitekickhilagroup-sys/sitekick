-- supabase/migrations/0002_proposals_activity.sql
-- Sprint A: agents propose, humans approve, everything audited.

create type proposal_type as enum (
  'task_update','task_done','blocker_create','decision_create','deadline_update'
);
create type proposal_state as enum ('pending','accepted','rejected','auto_applied');

create table agent_proposals (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid references documents(id),
  project_id       uuid references projects(id) on delete cascade,
  type             proposal_type not null,
  payload          jsonb not null,             -- the op object from extract-comms, verbatim
  target_task_id   uuid references tasks(id) on delete cascade,
  confidence       numeric(3,2) not null default 0.50,
  reasoning        text,
  evidence_excerpt text,
  state            proposal_state not null default 'pending',
  decided_by       text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index idx_agent_proposals_state on agent_proposals(state);

create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,        -- 'task' | 'invoice' | 'proposal' | 'blocker' | 'decision'
  entity_id   uuid not null,
  actor       text not null,        -- user email or 'agent:extract-comms'
  action      text not null,        -- 'create' | 'verb:completed' | 'accept_proposal' | ...
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz not null default now()
);
create index idx_activity_entity on activity_log(entity_type, entity_id);

alter table tasks    add column manual_priority int,
                     add column snoozed_until date;
alter table invoices add column invoice_url text,
                     add column receipt_url text;

alter table agent_proposals enable row level security;
alter table activity_log    enable row level security;
create policy "read agent_proposals" on agent_proposals for select to authenticated using (true);
create policy "read activity_log"    on activity_log    for select to authenticated using (true);
