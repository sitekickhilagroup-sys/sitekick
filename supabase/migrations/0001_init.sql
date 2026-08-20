-- Sitekick — initial schema
-- Apply in Supabase SQL editor or via scripts/apply-migrations.mjs

-- ── Enums ────────────────────────────────────────────────────────────────
create type req_state      as enum ('done','open','unknown');
create type req_who        as enum ('us','city');
create type req_basis      as enum ('standard','ours');
create type stage_status   as enum ('done','current','upcoming','skipped');
create type invoice_status as enum ('received','for_rowan_approval','approved','paid','on_hold');
create type invoice_tab    as enum ('invoices','payment_summary','david');
create type task_priority  as enum ('critical','high','normal');
create type task_status    as enum ('open','done','dropped');
create type doc_kind       as enum ('email','transcript','invoice_pdf','sheet','other');
create type doc_source     as enum ('forward','gmail','outlook','upload','sheets','zimas','manual');
create type draft_status   as enum ('proposed','approved','sent','dismissed');
create type blocker_status as enum ('active','released');
create type event_kind     as enum ('history','forecast');

-- ── Core ─────────────────────────────────────────────────────────────────
create table projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  address       text,
  llc           text,
  city_case     text,
  city_on_hold  boolean not null default false,
  city_flag     text,
  target_rti    date,
  created_at    timestamptz not null default now()
);

-- Per-project stage graph: stages are data, not a global enum.
create table project_stages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  stage_key   text not null,
  label       text not null,
  position    int  not null,
  status      stage_status not null default 'upcoming',
  also_active boolean not null default false,
  substage    text,
  risk        boolean not null default false,
  slip_days   int not null default 0,
  confirmed   boolean not null default false,
  unique (project_id, stage_key)
);
create index idx_project_stages_project on project_stages(project_id);

-- Requirements inside a stage. Three states; us/city ownership.
create table stage_requirements (
  id               uuid primary key default gen_random_uuid(),
  project_stage_id uuid not null references project_stages(id) on delete cascade,
  text             text not null,
  state            req_state not null default 'unknown',
  who              req_who   not null default 'us',
  basis            req_basis not null default 'standard',
  evidence         text,
  note             text,
  src              text,
  position         int not null default 0,
  done_at          date,
  unique (project_stage_id, position)
);
create index idx_stage_requirements_stage on stage_requirements(project_stage_id);

-- Shared substage rails per stage key (editable catalog).
create table substage_catalog (
  stage_key text not null,
  position  int  not null,
  name      text not null,
  primary key (stage_key, position)
);

create table project_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind       event_kind not null,
  step       text not null,
  event_date text,           -- source data is loosely formatted ("2026-08-25", "TBD", "late Aug")
  src        text,
  created_at timestamptz not null default now()
);
create index idx_project_events_project on project_events(project_id);

-- ── Ingest ───────────────────────────────────────────────────────────────
create table documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references projects(id),
  kind         doc_kind not null,
  source       doc_source not null,
  external_id  text unique,       -- message-id / storage dedup key
  storage_path text,
  raw_text     text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index idx_documents_project on documents(project_id);

-- ── Work ─────────────────────────────────────────────────────────────────
create table tasks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references projects(id) on delete cascade,
  document_id    uuid references documents(id),
  title          text not null,
  description    text,
  owner          text,
  waiting_for    text,
  due            date,
  stage_key      text,
  priority       task_priority not null default 'normal',
  status         task_status not null default 'open',
  planned        boolean not null default true,
  follow_up_date date,
  check_back_on  date,
  source         text,
  admin          boolean not null default false,
  last_touched   date not null default current_date,
  created_at     timestamptz not null default now()
);
create index idx_tasks_project on tasks(project_id);
create index idx_tasks_status  on tasks(status);

create table blockers (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  document_id      uuid references documents(id),
  what             text not null,
  blocked_by       text not null,
  days_at_risk     int not null default 0,
  days_stuck       int not null default 0,
  downstream       text[] not null default '{}',
  suggested_action text,
  status           blocker_status not null default 'active',
  created_at       timestamptz not null default now()
);
create index idx_blockers_project on blockers(project_id);

create table decisions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title      text not null,
  detail     text,
  decided_at date,
  created_at timestamptz not null default now()
);
create index idx_decisions_project on decisions(project_id);

create table drafts (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid references blockers(id) on delete set null,
  task_id     uuid references tasks(id) on delete set null,
  to_email    text,
  subject     text not null,
  body        text not null,
  status      draft_status not null default 'proposed',
  approved_at timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ── Money / people ───────────────────────────────────────────────────────
create table vendors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  discipline   text,
  contact_name text,
  email        text,
  phone        text,
  status       text default 'active',
  hue          text,
  notes        text,
  created_at   timestamptz not null default now()
);

create table vendor_hours (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendors(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  document_id uuid references documents(id),
  hours       numeric(8,2) not null,
  rate        numeric(10,2),
  period      text,
  note        text,
  created_at  timestamptz not null default now()
);
create index idx_vendor_hours_project on vendor_hours(project_id);

create table invoices (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid references projects(id) on delete cascade,
  vendor_id                 uuid references vendors(id),
  document_id               uuid references documents(id),
  number                    text,
  amount_usd                numeric(12,2) not null,
  invoice_date              date,
  received_date             date,
  due                       date,             -- tracker has no due column; nullable by design
  status                    invoice_status not null default 'received',
  tab                       invoice_tab not null default 'invoices',
  entity                    text,             -- paying LLC
  paid_date                 date,
  transfer_confirmation_url text,
  approved_by               text,
  budget_line               text,
  created_at                timestamptz not null default now(),
  unique (vendor_id, number)
);
create index idx_invoices_project on invoices(project_id);
create index idx_invoices_status  on invoices(status);

-- ── Output / config ──────────────────────────────────────────────────────
create table digests (
  id          uuid primary key default gen_random_uuid(),
  for_date    date not null unique,
  body_md     text not null,
  top_actions jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── RLS: authenticated users read everything; writes only via service role ─
alter table projects           enable row level security;
alter table project_stages     enable row level security;
alter table stage_requirements enable row level security;
alter table substage_catalog   enable row level security;
alter table project_events     enable row level security;
alter table documents          enable row level security;
alter table tasks              enable row level security;
alter table blockers           enable row level security;
alter table decisions          enable row level security;
alter table drafts             enable row level security;
alter table vendors            enable row level security;
alter table vendor_hours       enable row level security;
alter table invoices           enable row level security;
alter table digests            enable row level security;
alter table settings           enable row level security;

create policy "read projects"           on projects           for select to authenticated using (true);
create policy "read project_stages"     on project_stages     for select to authenticated using (true);
create policy "read stage_requirements" on stage_requirements for select to authenticated using (true);
create policy "read substage_catalog"   on substage_catalog   for select to authenticated using (true);
create policy "read project_events"     on project_events     for select to authenticated using (true);
create policy "read documents"          on documents          for select to authenticated using (true);
create policy "read tasks"              on tasks              for select to authenticated using (true);
create policy "read blockers"           on blockers           for select to authenticated using (true);
create policy "read decisions"          on decisions          for select to authenticated using (true);
create policy "read drafts"             on drafts             for select to authenticated using (true);
create policy "read vendors"            on vendors            for select to authenticated using (true);
create policy "read vendor_hours"       on vendor_hours       for select to authenticated using (true);
create policy "read invoices"           on invoices           for select to authenticated using (true);
create policy "read digests"            on digests            for select to authenticated using (true);
create policy "read settings"           on settings           for select to authenticated using (true);
