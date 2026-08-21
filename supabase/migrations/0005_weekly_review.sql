-- supabase/migrations/0005_weekly_review.sql
-- Sprint D: Sunday prep / Monday meeting. Items snapshot canonical tasks.

create type weekly_review_status as enum ('preparing','saved');

create table weekly_reviews (
  id                    uuid primary key default gen_random_uuid(),
  meeting_date          date not null unique,
  status                weekly_review_status not null default 'preparing',
  source_review_id      uuid references weekly_reviews(id),
  recording_document_id uuid references documents(id),
  created_at            timestamptz not null default now()
);

create table weekly_review_items (
  id               uuid primary key default gen_random_uuid(),
  weekly_review_id uuid not null references weekly_reviews(id) on delete cascade,
  task_id          uuid not null references tasks(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  subtopic         text,
  status_snapshot  text not null,
  weekly_note      text,
  sequence         int not null default 0,
  carried_from     uuid references weekly_review_items(id),
  unique (weekly_review_id, task_id)
);
create index idx_wri_review on weekly_review_items(weekly_review_id);

alter table weekly_reviews      enable row level security;
alter table weekly_review_items enable row level security;
create policy "read weekly_reviews"      on weekly_reviews      for select to authenticated using (true);
create policy "read weekly_review_items" on weekly_review_items for select to authenticated using (true);
