-- 0022 — prioritization agent + review learning (My Work brief, 2026-08-29).

-- A) Task category (brief §2): administrative work is classified separately
--    from project work. An admin task may still belong to a project — the
--    classification is orthogonal to attribution.
alter table tasks add column if not exists category text not null default 'project'
  check (category in ('project', 'admin'));

-- B) AI prioritization runs (brief §3–4): Claude proposes an order and
--    explains per task. Ranks live per run — a re-run inserts a new run and
--    never rewrites history; Noa's manual pins (tasks.manual_priority) always
--    win at render time, and the gap between her order and the agent's is the
--    learning signal for the next template.
create table if not exists priority_runs (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model      text,
  scope      text not null default 'all',
  note       text
);

create table if not exists task_priorities (
  run_id       uuid not null references priority_runs(id) on delete cascade,
  task_id      uuid not null references tasks(id) on delete cascade,
  project_id   uuid references projects(id) on delete set null,
  global_rank  int not null,
  project_rank int not null,
  score        int not null default 0,
  urgency      text not null default 'medium' check (urgency in ('now', 'high', 'medium', 'low')),
  reason       text not null default '',
  primary key (run_id, task_id)
);
create index if not exists task_priorities_task_idx on task_priorities(task_id);

-- C) Review learning rules (inbox reduction): durable, human-taught rules.
--    Only 'attribute_project' for now — when Noa files an unattributed
--    suggestion under a project in the review drawer, the item's title tokens
--    become a rule and the same vendor/subject auto-attributes next time.
--    Class-level auto-apply/auto-ignore thresholds are computed from
--    agent_proposals history at run time and need no table.
create table if not exists review_rules (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('attribute_project')),
  match        jsonb not null default '{}'::jsonb,
  outcome      jsonb not null default '{}'::jsonb,
  hits         int not null default 0,
  active       boolean not null default true,
  learned_from uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- RLS: same contract as 0001 — authenticated users read, writes only via the
-- service role.
alter table priority_runs   enable row level security;
alter table task_priorities enable row level security;
alter table review_rules    enable row level security;
create policy "read priority_runs"   on priority_runs   for select to authenticated using (true);
create policy "read task_priorities" on task_priorities for select to authenticated using (true);
create policy "read review_rules"    on review_rules    for select to authenticated using (true);
