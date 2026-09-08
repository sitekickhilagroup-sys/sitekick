# SiteKick — Learning V1 Daily Log

A running, dated record of what actually happened each day on the learning work.
Newest entry on top. Facts only — decisions, commits, deploys, blockers.

---

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

**State at end of day:** collection code is **live but inert** — `LEARNING_COLLECT` is unset and the
table is not yet created, so nothing is written and behavior is unchanged. Nothing reads
`priority_feedback`. Active use of feedback in ranking is **not** built yet — a later,
quality-evaluated, separately-toggled phase. **Nothing about learning is active until the two steps
above are done; do not describe the current state as active learning.**

**To roll back tonight's deploy without data loss:** Vercel → Promote the prior production deployment
(`dpl_5djGD59vR9LLzMRrefXeLX1G2czG`, commit `09918e2`); or `git revert 6d4e266 && push`. No data to
lose — the table isn't created and collection never ran.
