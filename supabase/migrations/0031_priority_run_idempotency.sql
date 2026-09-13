-- 0031: idempotency for prioritize-tasks (Cost Controls Release 1, step 5).
-- input_hash is a deterministic digest of exactly the fields that feed
-- scoring (per task: due/due_provenance/priority/status/waiting_for/
-- manual_priority/process_impact; per blocker: project_id/days_stuck/kind —
-- see agents/prioritize-tasks.ts's computePrioritizationInputHash).
-- runPrioritization compares it against the most recent run before calling
-- the model again; ranked is stored alongside so a skip can report a count
-- without a second query.

alter table priority_runs add column if not exists input_hash text;
alter table priority_runs add column if not exists ranked int;
create index if not exists priority_runs_created_idx on priority_runs(created_at desc);
