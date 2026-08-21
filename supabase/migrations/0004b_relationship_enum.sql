-- supabase/migrations/0004b_relationship_enum.sql
-- Add relationship_create to proposal_type enum (must be separate from 0004 due to Management API constraints)

alter type proposal_type add value if not exists 'relationship_create';
