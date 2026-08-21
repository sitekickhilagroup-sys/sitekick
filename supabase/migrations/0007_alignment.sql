-- supabase/migrations/0007_alignment.sql
-- Noa alignment spec (2026-08-21):
--  * Flicker moves under "Inactive projects" (spec §ו) — additive active flag.
--  * Sub-stage status set widens to her full lifecycle (spec §ג):
--    Not Applicable / Upcoming / Active / Waiting / Blocked / Verify /
--    Submitted / With the City / Completed. New enum values are NOT used
--    inside this batch (safe to add in one migration).
--  * invoices.notes — the Update Invoice editor's free-text field (spec §יב).

alter table projects add column if not exists active boolean not null default true;
update projects set active = false where name ilike '%flicker%';

alter type project_substage_status add value if not exists 'waiting';
alter type project_substage_status add value if not exists 'blocked';
alter type project_substage_status add value if not exists 'verify';
alter type project_substage_status add value if not exists 'submitted';
alter type project_substage_status add value if not exists 'with_city';

alter table invoices add column if not exists notes text;
