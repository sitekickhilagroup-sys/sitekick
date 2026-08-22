-- supabase/migrations/0008_review_inbox.sql
-- Noa parity round 3 (her 2026-08-22 source review package).
--
--  * Import Review needs a wider decision set than accept/reject: her drawer
--    offers "Not sure" and "Not relevant" as first-class outcomes so a
--    suggestion can leave the queue without claiming the agent was wrong.
--  * A pasted update may describe work that does not exist yet, so the agent
--    must be able to propose a NEW task (task_create), not only edits.
--  * Duplicate review is the point of the screen: the proposal stores how well
--    it matched an existing task and why, so the human compares the two records
--    side by side instead of trusting a number.
--  * change_type / result_note / title carry what Noa edits in the drawer before
--    approving; payload stays the verbatim agent op.
--  * project_substages.decision is the conditional scenario box (spec §ד):
--    { label, options[], results[] } — an IF-rule shown as an explorable
--    outcome, never applied automatically.
--
-- New enum values are added but not referenced in this file, which keeps the
-- whole migration safe to apply in one batch.

alter type proposal_type  add value if not exists 'task_create';
alter type proposal_state add value if not exists 'ignored';
alter type proposal_state add value if not exists 'not_sure';

alter table agent_proposals
  add column if not exists title        text,
  add column if not exists change_type  text,
  add column if not exists result_note  text,
  add column if not exists match_score  int,
  add column if not exists match_reason text;

alter table project_substages add column if not exists decision jsonb;
