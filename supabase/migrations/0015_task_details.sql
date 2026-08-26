-- 0015: fields the QA round showed are missing.
alter table tasks add column if not exists latest_note text;
alter table tasks add column if not exists substage_template_id uuid references substage_templates(id);
alter table tasks add column if not exists workstream_id uuid references workstreams(id);
alter table projects add column if not exists business_rank int;
comment on column projects.business_rank is 'Noa''s standing priority: 1=Blair, 2=San Marco, 3=Rinconia, 4=Alta Mesa. Null = unranked (General last).';
update projects set business_rank = 1 where name ilike '%blair%';
update projects set business_rank = 2 where name ilike '%san marco%';
update projects set business_rank = 3 where name ilike '%rinconia%';
update projects set business_rank = 4 where name ilike '%alta mesa%';
