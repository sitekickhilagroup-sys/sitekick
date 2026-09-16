# SiteKick — Shared AI Workflow

Applies to Claude (application and Claude Code) and Codex alike. Neither agent owns the project.
Do not assume work performed by another agent is incorrect or should be rewritten without
checking its evidence first.

## Routing a task: does it need to actually run something?

One question decides who should pick up any given task: **does it require actually executing
something on the Product Owner's machine** — a shell command, `git`, `npm`/`next build`/`test`,
an OAuth/login flow, a deploy? Route accordingly:

- **Yes → the local Claude Code CLI or Codex, not the Claude application session.** Both run
  natively on the Mac with ordinary direct filesystem and shell access. **Proven, not assumed:**
  on 2026-09-08 the local Claude Code CLI independently resolved the Vercel/Supabase MCP
  authentication the application session couldn't touch, ran a real `next build` (clean), ran the
  full test suite (`vitest`, 370/370 passed), and checked live production data directly — see
  `DECISIONS.md` D-013. That is the concrete evidence for this rule, not a guess about what should
  work. Only one of {local Claude Code CLI, Codex} writes in the working directory at a time
  (`DECISIONS.md` D-005) — coordinate who is "in" before starting.
- **No (research, reading code, writing/editing files that don't need a live run, documentation,
  cross-checking another tool's claims, planning, architecture analysis) → the Claude application
  session can do this directly**, including real edits to files in the connected folder — this is
  not limited to conversation; see `DECISIONS.md` D-011 (a real code file changed) and the
  `docs/ai/` history itself (all written this way). Often faster, since it needs neither the
  Product Owner's screen nor a live terminal.
- **The Claude application session cannot drive a live terminal at all, even with screen-control
  permission granted** — Claude's computer-use tooling restricts terminal and IDE apps (Terminal,
  VS Code) to click-only: it can see and left-click, but not type, press keys, or paste into them.
  This is a deliberate safety boundary in that specific tool, not a permissions gap the Product
  Owner can close from their end. So even a task that *seems* small (e.g. "just log back in") has
  to go through channel above — the local Claude Code CLI, Codex, or the Product Owner directly.
- **The Product Owner remains the required approver for anything sensitive regardless of who
  executes it**: OAuth/login screens with a real credential prompt (any assistant must stop and
  hand back, never enter a password), payments, deploys, and any product/architecture decision
  per `AGENTS.md`'s non-negotiables.
- **`docs/ai/` is what makes this work without a live channel between the three contexts**: an
  item logged in `OPEN_QUESTIONS.md` or `DECISIONS.md` by one session is what the next session —
  whichever one is running — picks up and closes out, with its own independent verification
  recorded back into the same files. Treat a finished task as handed off only once the relevant
  `docs/ai/` file reflects it, not once a chat message claims it.

## Start of a task

1. Read `AGENTS.md` and any applicable local instructions.
2. Read `docs/ai/PROJECT_CONTEXT.md` and `docs/ai/CURRENT_STATE.md`.
3. Review `docs/ai/DECISIONS.md`, `docs/ai/ARCHITECTURE.md`, and `docs/ai/OPEN_QUESTIONS.md` for
   anything relevant to the task.
4. Inspect current branch, latest relevant commits, and working-directory state — including
   uncommitted changes (do not assume `git status` is clean).
5. Establish task scope, implementation owner, and reviewer before writing any code.

**Do not assume a previous conversation is available to another assistant or another session of
the same assistant.** State carries through these files and through git, not through chat memory.

## Ownership record (per task)

Record explicitly, in the handoff or in `CURRENT_STATE.md`'s "Next work":
- Task objective and authorized scope.
- Implementation owner and reviewer (explicit session/assistant name — **do not derive ownership
  from git author metadata**, per `DECISIONS.md` D-005).
- Branch and working directory.
- Files/components expected to change.

**Only one assistant writes in a given working directory at a time.** Use separate git worktrees
for genuinely simultaneous implementation work.

## During work

- Preserve unrelated existing changes (e.g. the open `package-lock.json` diff — do not touch it
  incidentally).
- Keep source-verified facts separate from assumptions and proposals in anything you write.
- Record product/architecture decisions in `DECISIONS.md` and unresolved issues in
  `OPEN_QUESTIONS.md` as they come up — don't let them live only in a chat transcript.
- Respect the Product Owner's authorization boundaries and applicable tool permissions. This
  workflow does not itself authorize deployment, external messages, or any change beyond the
  requested task's scope.
- Do not invoke a production mutation endpoint (e.g. `api/cron/triage`, which can apply or ignore
  proposals automatically) solely to demonstrate that a connection works.

## Validation

Run checks appropriate to the change, within authorized scope. Record: what ran, results,
failures, and limitations. **A check that was not run is not a passing check** — say so plainly
rather than implying green by omission.

## Handoff

Provide the next assistant/session with:
- Objective and scope.
- Branch, commit, and working directory.
- Changes made, and existing changes preserved untouched.
- Validation actually run and its results.
- New/updated entries in `DECISIONS.md` and `OPEN_QUESTIONS.md`.
- Recommended next step, and whether the task is complete or still active.

**Delivery and acknowledgment are separate facts.** Do not claim synchronization is complete
merely because a message or file was sent — confirm it was actually read and acted on.

## Documentation updates

When an authorized task changes behavior or a decision, update the relevant `docs/ai/` file
**before** handoff — not as an afterthought. Keep `CURRENT_STATE.md` concise and dated. Keep
durable decisions in `DECISIONS.md`, not scattered across commit messages. **Never store
credentials or sensitive operational records in these files.**

## Review and completion

The reviewer checks the change against its stated scope, the source evidence cited for it, and
actual validation results — not against the client-handoff docs' aspirational architecture (per
`PROJECT_CONTEXT.md`). The Product Owner remains the final decision maker. Do not merge or deploy
solely because review is complete — follow the Product Owner's explicit authorization for those
specific actions.

## Environment access — why the Claude application session doesn't just "open" the folder

The Product Owner asked why the Claude application session (this chat) and Codex don't both
simply open this project directly in a folder/workspace the way a local editor would. Recorded
here so both tools and the Product Owner share the same understanding, not three different ones:

- **The Claude application session runs in an isolated cloud container**, not on the Product
  Owner's Mac. It reaches the Mac only through a remote-device bridge (active while the Claude
  desktop app is open and linked), which offers two channels: (1) a sandboxed Linux VM on the
  device itself, which would allow direct in-place shell commands inside the connected folder —
  exactly like "opening the project" locally; and (2) a slower per-file stage/commit mechanism
  (copy a file in to read/edit it in the cloud container, then explicitly copy the result back to
  the exact device path).
- **Channel (1) — the on-device Linux VM — was unavailable for the whole 2026-09-06/07
  engagement** ("Workspace unavailable: the isolated Linux environment on this device failed to
  start"). It became reachable on 2026-09-08, and was used directly there for the first time.
  Before that, every file read/write by the Claude application session went through channel (2)
  instead, one file at a time, with explicit before/after size and mtime checks — the actual
  reason changes arrived as a discrete staged diff rather than an in-place edit.
- **Correction/refinement (2026-09-08, learned from actually using channel (1)):** channel (1) is
  a separate, restricted Linux VM — **not the Product Owner's real macOS user shell.** Its mount
  of the connected folder at `$HOME/mnt/<folder>` does reach the real files (verified: reading
  `.mcp.json` there returned exactly the config Codex described creating, byte for byte). But the
  VM ships its own `claude` binary, distinct from the Product Owner's real, globally-installed
  Claude Code CLI — this VM's build only supports `claude -p "<prompt>"` and has **no `mcp`
  subcommand at all** (`claude mcp list` in the VM returns "only `claude -p` is supported in this
  environment"). The VM also has no access to the real Terminal's other locally-installed tools,
  running processes, logged-in browser session, or OS keychain/credential storage. So channel (1)
  can read/write files in the connected folder and run ordinary shell tools against them, but it
  **cannot** drive `claude mcp login`/`logout`, cannot see or repair the real local Claude Code
  CLI's own OAuth/MCP authentication state, and cannot open the Product Owner's actual default
  browser for a consent screen. A task that specifically needs the real local Claude Code CLI
  process — MCP authentication being the concrete case that surfaced this (2026-09-08) — must be
  run by the Product Owner directly in that terminal, or by the local Claude Code CLI session
  itself, not by this application session, even now that channel (1) is reachable.
- **The local Claude Code CLI** (the separate process the Product Owner runs in a VS Code
  terminal) is not affected by this: it runs natively on the Mac and has ordinary direct
  filesystem access, no bridge involved.
- **Codex/ChatGPT is a separate product, built by a different company (OpenAI), with no
  integration into the Claude desktop app or this bridge at all.** It cannot "open inside" a
  Claude Project/workspace — there is no technical path between the two products. Whatever direct
  file access Codex has to this repository runs through its own separate local tooling, entirely
  independent of Anthropic's infrastructure.
- **Practical consequence:** if the Product Owner wants an assistant with ordinary, low-friction
  direct file access to this repo (no per-file staging), that means using a tool that runs locally
  on the Mac — the local Claude Code CLI, or Codex's own local tool — rather than this cloud-hosted
  Claude application session. This session remains useful for review, documentation, and changes
  where the staged-diff overhead is acceptable, but it is not the right tool for large or frequent
  in-place edits while channel (1) stays down.

### Addendum — "Projects" (Cowork) considered, does not remove the asymmetry above

The Product Owner asked whether creating a Cowork "Project" (Claude's feature for grouping tasks
under shared files/context/instructions) would resolve the environment/tooling asymmetry
described above. Checked against Claude's official documentation
([Organize your tasks with projects in Claude Cowork](https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork),
[Get started with Claude Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork))
rather than assumed: it does not. Two reasons: (1) Projects are an Anthropic/Claude-only feature
with no documented path for Codex to participate — the product-integration gap is unaffected;
(2) per Claude's own documentation, "Claude's work runs on Anthropic's servers, in an isolated
environment" even for a task started from a Project — so the on-device shell-access limitation
(channel (1) above) is a device/session-level constraint independent of whether Projects are
used. A Project scoped to this repo may still be a real **convenience** — future tasks could
start with the folder and `docs/ai/` context already available, reducing per-session setup — but
it does not change either constraint above.

## Conversation continuity

Claude application chats, Claude Code sessions, and Codex tasks are distinct contexts with no
automatic shared memory. `docs/ai/` carries reviewed, durable project knowledge between them.
Anything decided in a conversation that should persist must be written here explicitly — it does
not transfer on its own.
