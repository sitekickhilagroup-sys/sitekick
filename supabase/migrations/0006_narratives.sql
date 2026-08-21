-- 0006: narrative fields (client demo parity).
-- projects.summary: the card's context paragraph ("Two separate workstreams…").
-- weekly_review_subtopics: per sub-topic context shown above its actions in the
-- weekly review; carried forward on prepare.

alter table projects add column if not exists summary text;

create table if not exists weekly_review_subtopics (
  id               uuid primary key default gen_random_uuid(),
  weekly_review_id uuid not null references weekly_reviews(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  subtopic         text not null,
  context          text,
  created_at       timestamptz not null default now()
);

-- Uniqueness must also hold for the "General" group (null project).
create unique index if not exists weekly_review_subtopics_uniq
  on weekly_review_subtopics (
    weekly_review_id,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    subtopic
  );

alter table weekly_review_subtopics enable row level security;

drop policy if exists weekly_review_subtopics_read on weekly_review_subtopics;
create policy weekly_review_subtopics_read on weekly_review_subtopics
  for select to authenticated using (true);
