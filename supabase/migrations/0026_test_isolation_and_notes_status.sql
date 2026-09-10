-- 0026: test-record isolation + a durable Notes Center state.
--
-- Prepared but NOT applied by the agent — this session's Supabase connection
-- is read-only (an UPDATE was refused with "cannot execute UPDATE in a
-- read-only transaction"). Run this in the Supabase SQL Editor.
--
-- Four additive, backward-compatible columns, all default-safe (existing
-- rows get is_test=false / status='active' — nothing already in the
-- database changes meaning):
--
-- 1. tasks.is_test, projects.is_test — a test task/project is excluded from
--    every automated business process (the prioritization run, the daily
--    digest, the extractor's OPEN TASKS / feedback context) while still
--    rendering normally on screen. Marking a PROJECT is_test excludes every
--    task under it too (no need to flag each task one by one) — the app
--    code (lib/open-tasks.ts, lib/feedback-context.ts) already joins through
--    this and is deployed, waiting on these columns.
-- 2. comments.is_test — a test note isn't always tied to a test task (a
--    General note, or one on a test project) — its own explicit flag.
-- 3. comments.status ('active' | 'dismissed') — a state distinct from
--    General: today "dismissed / not relevant" collapses onto the same
--    entity_type='general' value as a genuine general note. A dismissed
--    note is also excluded from learning (already wired app-side).

alter table tasks add column if not exists is_test boolean not null default false;
alter table projects add column if not exists is_test boolean not null default false;
create index if not exists tasks_is_test_idx on tasks(is_test) where is_test;
create index if not exists projects_is_test_idx on projects(is_test) where is_test;

-- A task under a test PROJECT must be excluded even when the task row itself
-- was never explicitly flagged (the common case: mark the project, not every
-- task created under it one by one). Code-side join, not a generated column,
-- so a project flipped test<->real later is picked up immediately.
--
-- comments.is_test: a test note is not always tied to a test task (a General
-- note, or one on a test project) — its own flag, set explicitly whenever the
-- tester records it, rather than derived transitively at every read.
alter table comments add column if not exists is_test boolean not null default false;
create index if not exists comments_is_test_idx on comments(is_test) where is_test;

-- 'dismissed' = a real state distinct from General (today both collapse onto
-- entity_type='general'), AND the state that keeps a note out of learning —
-- a dismissed note must never feed the extractor/ranker context again.
alter table comments add column if not exists status text not null default 'active'
  check (status in ('active', 'dismissed'));
