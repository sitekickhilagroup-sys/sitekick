# SiteKick — Section 3: notes/corrections as agent feedback (design, grounded)

**Status:** Design, **not built** (needs the PO decision in §D before code). **Date:** 2026-09-09.
Basis: `sitekick-my-work-handoff/INSTRUCTIONS_HE.md` §4/§5 + the actual code
(`agents/extract-comms.ts`, `lib/proposals.ts`, `app/actions/proposals.ts`, the learning tables).
Per `AGENTS.md`: this section is **agent behaviour + a new surface**, not a save bug like §1/§2 — it
must not be rushed as an unverified prompt change on the live system, and the chat-assistant
placement is an open product question I must not decide alone.

## A. What already exists (verified in code — do not rebuild)

- **extract-comms already proposes corrections.** `agents/extract-comms.ts` prompts for stale-info
  correction ("Hold letter corrections", "corrections are underway", status refreshes) and emits
  proposals with `target_task_id` / `change_type`. §4's "propose a correction when existing info is
  stale" is *already the agent's job* — the ask is prompt **quality**, not a missing capability.
- **Re-processing the same note is already deduped.** `filterDuplicateProposals` (`lib/proposals.ts`)
  skips a proposal whose identity matches one already pending/accepted; cross-document dedup skips a
  re-uploaded communication. §4's "reprocessing doesn't create more tasks / more 'approve' examples"
  is largely handled — to verify, add a regression test from the Carlos/Blair note (§C).
- **The correction→learning trail already exists.** Every human correction is in `activity_log`
  (`edit:details`, `review:update_existing`, `merge*`, `verb:*`); auto-triage (`lib/auto-triage.ts`)
  already learns from review decisions; §1's dispositions feed `priority_feedback`.
- **Manual matching corrections are already captured (Section 2, shipped today).** When Noa attaches
  a proposal to a task the agent missed, `decideProposal` persists `target_task_id` on the proposal
  and logs `review:update_existing` — that *is* the "target selection → matching feedback" row of
  §5, recorded and auditable. No new table needed for it.

## B. The §5 correction-type → learning-meaning map, onto real signals

| Correction (handoff §5) | Real signal today | Consumer |
|---|---|---|
| Target-task selection | `agent_proposals.target_task_id` + `review:update_existing` (Section 2) | matching/extraction (no active learner yet) |
| Title/status correction from a source | `edit:details` / `review:update_existing` in `activity_log` | extraction / state-understanding |
| Phase or owner change | `edit:details` (CONTEXT — **not** proof the rank was wrong, per §1 correction #2) | prioritization context |
| Blocker / signature / payment | `apply_as_stated` → blocker; task edits | dependencies / next-action priority |
| Cancel or correct a decision | `undo*` / `reopen` (META — link to prior event, classify) | retraction (voids prior interpretation) |
| Save failure | technical error — **never** a learning signal | — |

**Nothing here auto-expands an agent's authority, and behaviour change in V1 stays in prioritisation
only** (handoff §5 + `learning-v1-state`). Inaction is never read as rejection; Waiting is never a
blanket deprioritise.

## C. What is genuinely left to build (and its risk)

1. **extract-comms correction quality (§4)** — sharpen the prompt so a stale note (e.g. Carlos/Blair:
   "negotiation finished; Carlos signed 08-11; outstanding = Hilla counter-signature + retainer
   payment") yields a precise title/status/next-step correction that **distinguishes Carlos signature
   vs Hilla signature vs payment vs the release-of-hold decision**, preserves original history, and
   shows the blocker/evidence. *Risk:* this changes what the live extraction agent emits; it is not
   unit-testable deterministically. **Requires an eval, not just a prompt edit** — do not ship blind.
   Safe first step: a **regression fixture** from the Carlos/Blair note asserting the *shape* of the
   desired proposal (fields, not exact prose), then iterate the prompt against it.
2. **Notes-on-the-existing-task → correction (§4)** — support a note added to a task (not only the new
   chat) triggering a correction proposal. This is extract-comms re-reading a task note; same risk/
   eval need as (1).
3. **The chat/notes assistant (§I of the action map)** — a new surface where Noa writes a comment,
   it is **linked to a task/project**, its **intent is classified** (temporary instruction vs general
   preference vs fact), she can **correct the interpretation**, and it performs **no business actions
   in v1**. This is a whole feature and its **placement/read-scope is an open product question**.

## D. The decisions needed from the Product Owner (per AGENTS.md)

1. **Chat/notes assistant — is it in scope now, and where does it live?** Global chat vs a per-item
   comment box; and does it get read access to the item's context to interpret well? (OPEN_QUESTION —
   I will not decide this unilaterally.)
2. **extract-comms prompt changes — how do we verify before live?** There is no eval harness for the
   extraction agent today. Options: (a) build a small fixture-based eval (the Carlos/Blair case +
   a few real notes) and iterate against it before shipping; (b) ship behind a flag and compare
   proposals on a sample; (c) defer prompt changes until an eval exists. My recommendation: (a).
3. **Priority order within Section 3:** the safe, testable first slice is the **regression fixture +
   eval** for the correction cases (no live-behaviour change yet); the chat assistant is a separate,
   larger track gated on decision #1.

## E. Recommended safe first slice (buildable now, no live-behaviour risk)

Build the **eval fixture** for extract-comms corrections: encode the Carlos/Blair note (and 1–2 more
real notes) as input → expected-proposal-shape assertions (distinct signature/payment/decision items,
history preserved, no duplicate on re-run). This is pure/testable, changes no live behaviour, and
becomes the gate every future prompt change must pass — directly satisfying §6's "build a regression
test from the case" and the "verify before live" non-negotiable. The prompt improvement itself then
lands only once it passes the fixture, per decision #2.

---

**Reminder:** design only. §1 (Edit details save) and §2 (inbox target-task selector) are shipped and
live; §3's remaining work is agent behaviour + a new surface that needs the decisions above before
any live change.
