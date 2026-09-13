-- 0030: prompt_version + extract_model on documents — idempotency for the
-- extractor (Cost Controls Release 1, step 2). Stamped by
-- agents/extract-comms.ts's applyExtractResult on every successful run.
-- lib/ingest.ts's processDocument reads these back before calling the model
-- again: a document that already succeeded under the CURRENT prompt version
-- and model is skipped unless the caller explicitly passes force:true.
--
-- Nothing reprocesses automatically today (see docs/ai/handoffs/
-- COST_MAP_2026-09-13.md §0) — this closes the gap for when something does.

alter table documents add column if not exists prompt_version text;
alter table documents add column if not exists extract_model text;
