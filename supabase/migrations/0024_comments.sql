-- 0024: Notes assistant (Section 3) — comments Noa writes in her own words,
-- linked to a task/project (or general), with a first-pass interpretation she
-- can correct.
--
-- Design (docs/ai/handoffs/SECTION3_CORRECTIONS_FEEDBACK_DESIGN.md + the action
-- map §I):
--  * v1 does NO business actions — this only records the note + its intent.
--    Acting on a note (feeding a preference into prioritisation) is a later,
--    quality-evaluated phase, gated the same way as priority_feedback.
--  * The FACT (the note text, who wrote it, when, what it's linked to) is kept
--    separate from the INTERPRETATION (suggested_intent + version), which is a
--    re-computable keyword guess; `intent` is the human-confirmed value.
--  * `created_by` is the identity of the human who actually wrote the note — an
--    attribution like "Noa via Claude" *inside* the text authenticates nothing
--    and is never trusted as the author.
--  * Append-only. Nothing reads this to change behaviour yet.
--
-- RLS: same contract as 0022/0023 — authenticated users read; writes via the
-- service role only.

create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  -- what it's about; 'general' carries a null entity_id
  entity_type   text not null default 'general'
                  check (entity_type in ('task', 'project', 'general')),
  entity_id     uuid,
  body          text not null,
  -- interpretation, separate + re-computable; a CANDIDATE, never auto-applied
  suggested_intent text not null default 'fact'
                  check (suggested_intent in ('preference', 'instruction', 'fact')),
  intent        text not null default 'fact'
                  check (intent in ('preference', 'instruction', 'fact')),
  interpreter_version text,
  -- the real author of the note (never inferred from text)
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists comments_entity_idx on comments(entity_type, entity_id);
create index if not exists comments_author_idx on comments(created_by, created_at desc);

alter table comments enable row level security;
create policy "read comments" on comments for select to authenticated using (true);
