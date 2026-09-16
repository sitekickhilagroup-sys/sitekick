# SiteKick — Project Context

**Status:** Reconciled shared documentation (Claude + Codex inputs). Living document — keep current.
**Last reconciled:** 2026-09-07.

## What this is

SiteKick's current, real-world implementation supports Hilla's real-estate development and
construction operations in Los Angeles. **Hilla / Los Angeles is a real operational system in
current use, not a demo and not a generic product with Hilla used as an example.**

At the same time, the strategic direction is broader: a **Construction Execution Intelligence
Platform** — an AI operational-intelligence layer for real-estate development, construction, and
infrastructure companies. It is intended to complement existing ERP, project-management, BIM,
financial, and communication systems, not replace them.

These are **not two separate products**. The intended evolution is:

```
Hilla / LA Implementation → Real Operational Usage → Learn From Actual Behavior
→ Identify Reusable Patterns → Extract a Reusable Construction Execution Core
→ Separate Generic Core from Company-Specific Logic → Validate the Core with Customer #2
→ Repeatable Vertical AI Product
```

Hilla / LA therefore serves two purposes at once: (1) it must solve Hilla's real operational
problems, and (2) it is the first environment where the broader reusable product is being
discovered and validated. This should guide every architectural decision — see
`ARCHITECTURE.md` §Classification and `DECISIONS.md`.

## Product flow

`Information → Understanding → State → Impact → Priority → Action → Outcome → Learning`

In plain terms: understand what changed across projects, assess downstream impact and
dependencies, prioritize what matters, recommend or execute the right action, measure the
result, and learn from the outcome for next time.

## Current operational scope (Hilla / LA)

Multiple concurrent development/construction projects; project lifecycle stages; permits, Plan
Check, RTI; consultants and contractors; tasks; WAITING FOR / blockers; critical-path
dependencies; emails and meetings; invoices and payments; contracts; claims / change orders;
vendor and consultant management; cross-project visibility; operational follow-ups and
prioritization.

**Each capability's actual implementation status must be checked against the source code and
recorded in `CURRENT_STATE.md` — this file describes intent and scope, not implementation
status.**

## Long-term architecture direction

Separate reusable execution concepts from customer- and jurisdiction-specific configuration
**when justified by real requirements**, not preemptively. Potential reusable concepts: ingestion
and understanding, project matching, unified project state, event/blocker/risk/change detection,
dependency and impact analysis, prioritization, My Work, recommended actions, human approval,
execution, evidence and confidence, auditability, outcome tracking, execution memory.

**Do not perform a broad refactor solely to match this long-term vision.** Preserve the working
LA implementation. Propose incremental changes with explicit, scoped justification — see
`WORKFLOW.md`.

## Authority

Rotem is the Product Owner and final decision maker for this project and for this collaboration
between Claude and Codex. Both assistants may inspect, propose, implement within an authorized
scope, test, and review. **Neither assistant independently expands product scope or decides
architecture direction.**

## Source documents and their status

- `docs/client-handoff/*` (Build Spec, Implementation Guide, Agent Operating Manual, seed
  contract) — describe a separate, more elaborate architecture (an 11-named-agent pipeline, a
  different schema) that **does not match the current codebase**. These originated from a
  separate static demo built independently. `docs/client-handoff/GAP-PLAN.md` is the
  reconciliation record explaining the decision to keep the real backend and adopt only the
  product *structure* from that demo. **Treat all four client-handoff docs as historical/
  aspirational reference — verify every implementation claim in them against source code before
  treating it as true.**
- The user's own "Construction Execution Intelligence Platform" vision document and "LA" agent-
  architecture document — these describe product direction and a target agent architecture; they
  are not proof of what is implemented either. See `OPEN_QUESTIONS.md` Q-006 for the open
  question of formally labeling precedence between these and the client-handoff docs.
- Repository evidence (code, migrations, tests) establishes what currently exists. **Future
  product direction never overrides evidence about what exists.**
