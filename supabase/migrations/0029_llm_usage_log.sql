-- 0029: llm_usage_log — central token/cost measurement for every runStructured
-- call (see docs/ai/handoffs/COST_MAP_2026-09-13.md, Cost Controls Release 1,
-- step 1). Append-only audit trail, one row per attempt (an invocation with a
-- validation retry produces two rows). Nothing reads this yet — logging only.
--
-- RLS: same contract as 0001/0022/0023 — authenticated users read; writes only
-- via the service role (runStructured logs with supabaseAdmin()).

create table if not exists llm_usage_log (
  id            uuid primary key default gen_random_uuid(),

  job           text not null check (job in ('triage','extract','digest','analyze')),
  action_type   text not null,           -- caller-supplied label, e.g. 'extract-comms'; defaults to job
  model         text not null,

  attempt       int not null,            -- 1 = first call, 2 = validation retry
  success       boolean not null,        -- did this attempt parse against the schema
  error_message text,

  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  cache_read_input_tokens     int not null default 0,
  estimated_cost_usd numeric(10,6),      -- null when the model isn't in the pricing table

  document_id   uuid references documents(id) on delete set null,
  run_id        uuid,                    -- opaque: priority_runs.id or any other caller-defined run identifier

  created_at    timestamptz not null default now()
);
create index if not exists llm_usage_log_created_idx on llm_usage_log(created_at desc);
create index if not exists llm_usage_log_job_idx on llm_usage_log(job, created_at desc);
create index if not exists llm_usage_log_document_idx on llm_usage_log(document_id);

alter table llm_usage_log enable row level security;
create policy "read llm_usage_log" on llm_usage_log
  for select to authenticated using (true);
