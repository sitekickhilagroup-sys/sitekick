-- soils_survey is in the import pipeline's canonical STAGE_ORDER (lib/import/requirements.ts)
-- but had zero live rows at discovery time — map it so future imports don't degrade.
insert into stage_phase_map (stage_key, phase_key) values ('soils_survey', 'plan_check')
on conflict (stage_key) do nothing;
