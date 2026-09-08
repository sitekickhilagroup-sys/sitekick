# SiteKick — Learning V1 Daily Log

A running, dated record of what actually happened each day on the learning work.
Newest entry on top. Facts only — decisions, commits, deploys, blockers.

---

## 2026-09-08 (later) — My Work / Inbox handoff (INSTRUCTIONS_HE)

Read `…/sitekick-my-work-handoff/INSTRUCTIONS_HE.md` + all 5 images. Order: reliable save →
target-task selection & dedup → notes/corrections as feedback.

**Section 1 — Edit details save (priority #1): FIXED + verified.**
- *Verified in code:* the reported "Phase → Financing didn't save" is because **Phase is a
  non-persisted local filter** for the Sub-stage list — `tasks` has no phase column by design
  (`lib/task-details.ts`), phase derives from `substage_template_id`. Changing only Phase made an
  empty patch and the editor **closed silently** (`task-editor.tsx` old `save()`), reading as data
  loss. Other fields (owner/waiting/due/project/sub-stage/workstream/impact/category) do persist —
  confirmed live earlier (a Due edit logged `edit:details`).
- *Fix (commit `fb8a0b1`):* pure `editorSaveOutcome()` (save | phase_hint | noop); a Phase-only move
  now shows an inline hint instead of a silent close; success only after a real write; Save/Cancel
  made a sticky footer (reachable on small windows). No data-model change — persisting a task phase
  without a sub-stage would need one, flagged for a separate decision.
- *Tests:* 388/388, typecheck + i18n parity clean. Live-UI check pending deploy (app can't run
  locally without Supabase env).
- Sections 2 (Inbox target-task selector + dedup feedback) and 3 (notes/corrections as feedback):
  designed, not yet built.

## 2026-09-08

**Design & audit**
- Produced three handoff docs: `LEARNING_MODEL_IMPROVEMENT_DRAFT.md` (design, incl. Path B and the
  universal §10 model), `ALL_USER_ACTIONS_LEARNING_MAP_DRAFT.md` (full action→learning map, Rev 2
  with 7 PO corrections + §A.9 navigation actions + §I chat-assistant + §J verification report),
  `LEARNING_ACTIVATION_PLAN_DRAFT.md` (rollout plan for Noa + team). Committed `549f5c7`.
- Verified against live production data: 301 human task-actions over 10 active days; **0 pins, 0
  snoozes ever** (the strongest signal has no UI); only 80/301 (26.6%) reconstructable to a prior
  rank; ~7 usable completion-order pairs. Resolved UNKNOWNs: `markPairNotDuplicate` logs indirectly
  as `save`(type=unrelated); `inferPhases` has no trigger audit; **no impression logging exists** →
  the link to "what Noa saw" is assumed, not known.

**Decisions locked (PO):** no obligation to add pin/drag/snooze; inaction is never auto-read as
rejection; prioritization behavior changes first; no automatic business actions; feedback
interpretation is a candidate gated by a quality evaluation vs the current ranker (not the auto-triage
5/85% threshold); writing to a feedback table is a data change; direct-to-Production path approved
(no separate staging needed for additive, nothing-reads-it collection).

**Built & shipped-track (branch `feat/learning-phase0-audit-coverage`)**
- `9a1112a` — Phase 0 audit coverage: log `releaseBlocker` (`release_blocker`), `setDraftStatus`
  (`draft:<status>`), `markPairNotDuplicate` (distinct `not_duplicate`). Additive, no schema change.
- `70d0d3e` — V1 foundation: `0023_priority_feedback.sql` (append-only; fact vs interpretation vs
  provenance separated; `voided`+`retraction_kind`; RLS authenticated-read / service-role-write) +
  pure `lib/priority-feedback.ts` (provenance, fact builder, candidate interpreter, retraction
  classifier) + 12 unit tests.
- (this commit) — collection wiring: `lib/collect-priority-feedback.ts` (`recordPriorityFeedback`,
  best-effort, gated by `LEARNING_COLLECT` kill-switch, captures the 5 disposition verbs against the
  latest-seen run) wired into `applyWorkVerb`; 3 more unit tests.

**Verification:** typecheck clean; **full suite 385/385**. Clean-worktree check confirmed the deploy
commit's tests pass; bare `tsc` needs Next-generated `.next/types` (Vercel `next build` provides them).
Could not run the app locally (no Supabase env) — app-level verification is on the deploy.

**Deploy:** merged branch → `main` (`6d4e266`), pushed; Vercel **production deploy READY**
(`dpl_Ht92ssEtBKn1sQpNKBd7dRGYd5zH`). Code is live. **Two activation steps were BLOCKED for the agent
by the Claude Code permission classifier** (production DB DDL / config are not agent-writable in this
mode) and must be done by a human:
1. Apply `supabase/migrations/0023_priority_feedback.sql` to the production Supabase (the
   `priority_feedback` table does not exist yet).
2. Set `LEARNING_COLLECT=1` in Vercel (Production scope) and redeploy, to switch collection on.

**ACTIVATED (same day, human did the two steps):** the PO ran `0023` against production Supabase
(table created; the `create policy` error on a re-run was harmless — it already existed) and set
`LEARNING_COLLECT=1` (Config) on Vercel Production, then redeployed (`dpl_BHycANN…`, READY,
`sitekick-ecru.vercel.app`). **End-to-end verified live:** a real `Waiting` action on the NOW-tier
task "Plan Check extension exhausted…" produced the first `priority_feedback` row — event `waiting`,
proposed_global_rank 3, proposed_urgency `now`, provenance `assumed_latest_run`, inferred_signal
`weak_negative` @ confidence 0.2 (v1-candidate), linked to its activity_log action. Fact and
interpretation stored separately, exactly as designed.

**State at end of day:** collection is **LIVE and capturing** the five disposition verbs
(completed/not_applicable/waiting/delayed/scheduled) from My Work. Note: it does **not** capture
`edit:details` (the Task Editor / "Edit details…" menu item) — that is CONTEXT, by design; only the
verb-menu dispositions above the divider are captured. **Still NOT active learning:** nothing reads
`priority_feedback` and it does not influence any recommendation yet — that is the next, separately
built and quality-evaluated phase. Do not describe collection as active learning.

**To disable without data loss:** set `LEARNING_COLLECT=0` (or remove it) on Vercel + redeploy →
capture stops instantly; the table and its rows remain. Full deploy rollback: promote
`dpl_5djGD59vR9LLzMRrefXeLX1G2czG` (commit `09918e2`) or `git revert`.

**To roll back tonight's deploy without data loss:** Vercel → Promote the prior production deployment
(`dpl_5djGD59vR9LLzMRrefXeLX1G2czG`, commit `09918e2`); or `git revert 6d4e266 && push`. No data to
lose — the table isn't created and collection never ran.
