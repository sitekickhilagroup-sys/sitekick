-- supabase/migrations/0004_relationships.sql
-- Sprint C: typed dependencies with evidence. Co-occurrence is not dependency.

create type relationship_type as enum ('blocks','supports','parallel','unrelated','needs_verification');

create table relationships (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references projects(id) on delete cascade,
  from_task_id         uuid not null references tasks(id) on delete cascade,
  to_task_id           uuid not null references tasks(id) on delete cascade,
  type                 relationship_type not null,
  reason               text,
  confidence           numeric(3,2) not null default 0.50,
  evidence_document_id uuid references documents(id),
  verified_by          text,
  verified_at          timestamptz,
  manual_override      boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (from_task_id, to_task_id),
  check (from_task_id <> to_task_id)
);
create index idx_relationships_from on relationships(from_task_id);
create index idx_relationships_to   on relationships(to_task_id);

alter table relationships enable row level security;
create policy "read relationships" on relationships for select to authenticated using (true);
