-- 0028: "Report a problem" — a 4th Notes Assistant intent, plus the fields
-- a twice-daily automated triage pass writes. Additive and backward-
-- compatible: widening a CHECK constraint never rejects an existing row, and
-- the three new columns are nullable with no default that changes meaning
-- for anything already in the table.
--
-- Widen the intent/suggested_intent CHECKs to admit 'issue'. Constraint
-- names below are Postgres's own auto-generated names for the original
-- inline column CHECKs in 0024_comments.sql (table_column_check) — the same
-- naming convention 0025_comments_entity_types.sql already relied on for
-- comments_entity_type_check.
alter table comments drop constraint if exists comments_suggested_intent_check;
alter table comments add constraint comments_suggested_intent_check
  check (suggested_intent in ('preference', 'instruction', 'fact', 'issue'));

alter table comments drop constraint if exists comments_intent_check;
alter table comments add constraint comments_intent_check
  check (intent in ('preference', 'instruction', 'fact', 'issue'));

-- Written only by the automated triage cron (app/api/cron/triage-issues),
-- never by Noa directly. significance mirrors the app's existing 'critical'/
-- 'high'/'normal' task-priority vocabulary where it overlaps, plus 'low' for
-- the bottom of an open-ended backlog. triaged_at marks "already included in
-- a report" so the next run only picks up genuinely new issue reports.
alter table comments add column if not exists time_estimate text;
alter table comments add column if not exists significance text
  check (significance in ('low', 'medium', 'high', 'critical'));
alter table comments add column if not exists triaged_at timestamptz;

create index if not exists comments_untriaged_issues_idx
  on comments(created_at)
  where intent = 'issue' and triaged_at is null;

-- Verify:
-- select column_name, data_type from information_schema.columns
-- where table_name='comments' and column_name in ('time_estimate','significance','triaged_at');
-- select conname from pg_constraint where conrelid = 'comments'::regclass and contype = 'c';
