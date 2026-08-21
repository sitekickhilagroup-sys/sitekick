-- supabase/migrations/0003b_phase_set_enum.sql
-- Split from 0003_process_model.sql: `alter type ... add value` cannot run in the
-- same transaction/statement batch as other DDL/DML via the Supabase Management
-- API, so it ships as its own migration, applied second.
--
-- Sprint B addition (Dor): Claude-driven phase inference proposes through the inbox.
alter type proposal_type add value if not exists 'phase_set';
