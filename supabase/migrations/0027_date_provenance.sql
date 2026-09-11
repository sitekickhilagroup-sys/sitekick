-- 0027: date provenance — already applied to the live database by Rotem
-- (2026-09-11, via the Supabase SQL Editor), but never checked into the repo
-- as a migration file until now. Recorded here for an honest history; running
-- it again is a safe no-op (every clause is `if not exists`).
--
-- Three additive, nullable columns on tasks. No backfill: every task before
-- this feature has due_provenance = null ("not yet classified"), which every
-- read path treats as "preserve today's behavior" — see lib/types.ts's Task
-- interface and components/work/work-table-row.tsx's Due badge logic.
--
-- due_provenance: 'explicit' (the text stated an outright date, or a human
--   typed it directly), 'derived' (inferred from relative language like
--   "end of week"), or 'unresolved' (mentioned but not determinable, or a
--   pre-existing due date with no source that supports it).
-- due_source_document_id: which document the classification came from, if any.
-- due_source_date: the SOURCE communication's own date (documents.received_at,
--   as a date) — distinct from the resolved due date it produced, so a viewer
--   can see how stale a derived/unresolved estimate is.

alter table tasks add column if not exists due_provenance text
  check (due_provenance in ('explicit', 'derived', 'unresolved'));

alter table tasks add column if not exists due_source_document_id uuid
  references documents(id) on delete set null;

alter table tasks add column if not exists due_source_date date;

create index if not exists idx_tasks_due_source_document_id
  on tasks(due_source_document_id) where due_source_document_id is not null;

-- Verify:
-- select column_name, data_type from information_schema.columns
-- where table_name='tasks' and column_name like 'due_%';
