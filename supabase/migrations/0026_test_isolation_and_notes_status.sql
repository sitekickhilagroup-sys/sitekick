-- 0026: test-record isolation + a durable Notes Center state.
--
-- Prepared but NOT applied by the agent — this session's Supabase connection
-- is read-only (an UPDATE was refused with "cannot execute UPDATE in a
-- read-only transaction"), consistent with every earlier migration tonight:
-- run this in the Supabase SQL Editor when convenient.
--
-- Two additive, backward-compatible columns:
--
-- 1. tasks.is_test / projects.is_test — lets a UI-driven test record be
--    created and marked so it can be EXCLUDED from every automated business
--    process (the prioritization agent run, the daily digest, the extractor's
--    OPEN TASKS / feedback context) while still rendering normally in My
--    Work/Inbox/the Notes Center screens the agent needs to actually verify
--    against. Once this lands, the corresponding code-side filters
--    (agents/prioritize-tasks.ts, agents/daily-digest.ts, lib/ingest.ts,
--    lib/feedback-context.ts) are a small, mechanical follow-up.
--
-- 2. comments.status — a durable state distinct from "General": today
--    "dismissed / not relevant" has no home of its own and collapses onto
--    the same entity_type='general' value as a genuine general note. This
--    column lets the Notes Center (app/(dash)/(standard)/notes-center) offer
--    a real "Not relevant" action instead of overloading General for it.

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
