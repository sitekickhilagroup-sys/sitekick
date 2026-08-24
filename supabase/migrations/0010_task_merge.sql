-- Merge duplicate tasks into a Master Action.
--
-- From the corrections doc: a Merge action must exist on *existing* tasks, not
-- only on agent proposals; the merge picks one Master Action; source evidence,
-- notes, status history, waiting-on, due dates and project links transfer to
-- it; the losing record is kept as Merged rather than deleted, because the
-- history is the audit trail; and the merge must be undoable.
--
-- Note what this deliberately does not do: it never deletes a row. The loser
-- keeps its own fields exactly as they were, so an undo is a matter of
-- clearing three columns rather than reconstructing anything.

alter type task_status add value if not exists 'merged';

alter table tasks
  -- The Master Action this row was folded into. Null for every normal task.
  add column merged_into uuid references tasks(id) on delete set null,
  add column merged_at   timestamptz,
  add column merged_by   text;

comment on column tasks.merged_into is
  'Set when this task was merged into a Master Action. The row is kept for history; every screen filters it out. Undo clears this, merged_at and merged_by and restores status.';

-- Every list query filters on "not merged", and the undo path looks rows up by
-- the master they were folded into.
create index idx_tasks_merged_into on tasks(merged_into);
