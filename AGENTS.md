<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:sitekick-project-rules -->

# SiteKick project rules

This block is maintained by the team (Product Owner + AI collaborators), not by Next.js tooling.
It is safe to edit; the block above is not.

## Before touching anything

Read, in order: `docs/ai/PROJECT_CONTEXT.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/DECISIONS.md`,
`docs/ai/ARCHITECTURE.md`, `docs/ai/OPEN_QUESTIONS.md`, `docs/ai/WORKFLOW.md`. Then inspect actual
git state (branch, recent commits, uncommitted changes) and the real code involved in your task.
Do not rely on documentation alone when the code can verify current state — and do not rely on
`docs/client-handoff/*` as current-state truth (see `PROJECT_CONTEXT.md`).

## Non-negotiables

- **Two levels, not two products:** the Hilla/LA implementation is a real operational system in
  active use *and* the discovery vehicle for a broader reusable platform. Preserve working Hilla/
  LA-specific behavior — do not remove or generalize it just because it's customer-specific. Do
  not force a generic architecture onto it just because a future product needs multi-tenancy. See
  `PROJECT_CONTEXT.md`.
- **Distinguish implementation status honestly:** implemented-and-verified, implemented-but-not-
  verified, partially implemented, planned/future-vision — never blur these. A capability in the
  vision docs is not evidence it's implemented; code in the repo is not automatically evidence it
  works (add/run tests to actually verify).
- **One writer per working directory at a time.** Use separate worktrees for concurrent
  implementation work between Claude and Codex. See `docs/ai/WORKFLOW.md`.
- **Update `docs/ai/CURRENT_STATE.md` and `docs/ai/DECISIONS.md`** whenever a task changes what's
  implemented or makes an architectural call — before handing off, not after.
- **Do not expand scope, refactor toward the long-term architecture, or make a product/
  architecture decision that resolves an open question in `docs/ai/OPEN_QUESTIONS.md`** without
  the Product Owner's explicit authorization. This does **not** block read-only factual
  verification — checking a claim in `OPEN_QUESTIONS.md` against source code (e.g. "does table X
  exist," "is Y actually called") needs no authorization; do it whenever relevant to your task,
  and update the question with what you found. The line is: verifying a fact is always fine;
  deciding what to do about it, or changing anything as a result, needs sign-off.

<!-- END:sitekick-project-rules -->
