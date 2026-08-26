-- supabase/migrations/0016_weekly_finalize.sql
-- D1: Finalize / Reopen, separate from Save. 'final' is a third
-- weekly_review_status value that locks a review as the meeting record —
-- Save (existing 'saved' status) stays a checkpoint you can hit repeatedly
-- while prepping, never a lock (see review-board.tsx). finalized_at is the
-- timestamp Reopen clears. next_step backs D2's per-item "Next step" field;
-- added here because it's the same weekly_review_items table this file is
-- already touching for D1.
--
-- Postgres cannot use a newly added enum value inside the same transaction
-- that adds it, and Supabase applies each migration file as one transaction
-- — so this file only ever ADDS the 'final' value. Nothing here inserts or
-- updates a row to 'final'; app/actions/weekly.ts's finalizeReview does that
-- write later, outside this transaction. Do not add such a statement to
-- this file.
alter type weekly_review_status add value if not exists 'final';
alter table weekly_reviews add column if not exists finalized_at timestamptz;
alter table weekly_review_items add column if not exists next_step text;
