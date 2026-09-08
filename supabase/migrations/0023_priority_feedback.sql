-- 0023: Learning V1 — priority_feedback (forward-capture of Noa's business
-- events against the AI ranking she was shown).
--
-- Design (see docs/ai/handoffs/ALL_USER_ACTIONS_LEARNING_MAP_DRAFT.md):
--  * FACT and INTERPRETATION live in SEPARATE columns — a business event
--    (completed/waiting/…) is NOT proof the rank was right or wrong; the
--    interpretation is a re-computable CANDIDATE, never auto-applied.
--  * recommendation_provenance records whether we can prove Noa saw the
--    recommendation. Today there is no impression logging, so forward-capture
--    rows are at best 'assumed_latest_run'; 'confirmed_seen' needs the optional
--    impression-logging. Never record an assumed link as if it were known.
--  * Append-only. Nothing in the product READS this table yet
--    (collection is not active learning).
--  * undo/reopen VOID a row's interpretation (voided=true) and never delete the
--    recorded fact.
--
-- RLS: same contract as 0001/0022 — authenticated users read; writes only via
-- the service role.

create table if not exists priority_feedback (
  id            uuid primary key default gen_random_uuid(),

  -- ── fact (immutable) ──────────────────────────────────────────────────────
  task_id       uuid not null references tasks(id) on delete cascade,
  event         text not null check (event in
                  ('completed','not_applicable','waiting','delayed','scheduled',
                   'reordered','unblocked','reopened')),
  run_id        uuid references priority_runs(id) on delete set null,
  proposed_global_rank int,
  proposed_urgency     text check (proposed_urgency in ('now','high','medium','low')),
  recommendation_provenance text not null default 'missing'
                  check (recommendation_provenance in
                    ('confirmed_seen','assumed_latest_run','missing')),
  source_activity_log_id uuid references activity_log(id) on delete set null,
  decided_by    text not null,
  decided_at    timestamptz not null default now(),

  -- ── interpretation (separate, re-computable; a CANDIDATE, never applied) ───
  inferred_signal text check (inferred_signal in ('none','weak_positive','weak_negative')),
  confidence      real,
  interpreter_version text,

  -- ── retraction (undo/reopen void the interpretation, keep the fact) ────────
  voided        boolean not null default false,
  retraction_kind text check (retraction_kind in ('correction','cancellation','circumstance')),
  reverses_activity_log_id uuid references activity_log(id) on delete set null
);
create index if not exists priority_feedback_task_idx on priority_feedback(task_id);
create index if not exists priority_feedback_run_idx  on priority_feedback(run_id);

alter table priority_feedback enable row level security;
create policy "read priority_feedback" on priority_feedback
  for select to authenticated using (true);
