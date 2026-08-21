# Sprint A — Agent Review Inbox, Activity Log, My Work Screen, Invoice Links

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents propose instead of silently writing; Noa approves in a Review Inbox; a My Work screen becomes the daily action surface; every mutation is audited.

**Architecture:** New `agent_proposals` + `activity_log` tables. A pure router splits extraction output into auto-applied ops (new-task creates, vendor hours) and pending proposals (updates, done-marks, blockers, decisions, deadline changes). A single State Writer module commits proposals. My Work is a server page with 5 query views over the existing `tasks` table plus per-row update verbs mapped by a pure `verbToPatch` function.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role writes, RLS read), Zod, Vitest, Tailwind v4 tokens.

**Spec:** `docs/client-handoff/SITEKICK_BUILD_SPEC.md` §2 (My Work), §6 (pipeline), §8 (trust); `docs/client-handoff/GAP-PLAN.md` items 1, 2, 7.

## Global Constraints

- Every new server action starts with `await requireUser()` from `lib/auth.ts`; writes go through `supabaseAdmin()` only.
- Every persisted "today" date uses `laToday()` from `lib/date.ts` — never `toISOString().slice(0,10)`.
- Every user-visible string gets a key in BOTH `lib/i18n/en.json` and `lib/i18n/he.json` (parity test enforces).
- New tables: enable RLS + `for select to authenticated using (true)` read policy, no write policies (matches 0001).
- Dates in DB are `date` (YYYY-MM-DD strings in JS). Task ids are uuid strings.
- UI: logical direction classes only (`ms-`/`me-`/`text-start`), design tokens from `app/globals.css` (`bg-card`, `text-ink`, `border-line`, `rounded-(--radius-card)`), icon-only buttons need `aria-label`.
- Commit steps mean: `git add <files>` + run `npm run check` — Dor commits via `/commit-push` at checkpoints (global no-auto-commit rule). Never add AI co-author lines.
- Migrations: SQL file in `supabase/migrations/`, applied by pasting into Supabase SQL editor (Dor) or `node scripts/apply-migration.mjs <file>` (Task 1 builds it; needs `SUPABASE_TOKEN` + project ref from `.env.local`).

---

### Task 1: Migration runner script + 0002 migration (proposals, activity, task fields, invoice links)

**Files:**
- Create: `scripts/apply-migration.mjs`
- Create: `supabase/migrations/0002_proposals_activity.sql`
- Modify: `lib/types.ts` (append new types)

**Interfaces:**
- Produces: tables `agent_proposals`, `activity_log`; columns `tasks.manual_priority int`, `tasks.snoozed_until date`, `invoices.invoice_url text`, `invoices.receipt_url text`.
- Produces TS: `ProposalType`, `ProposalState`, `AgentProposal`, `ActivityEntry` in `lib/types.ts`; `Task` gains `manual_priority: number | null; snoozed_until: string | null`; `Invoice` gains `invoice_url: string | null; receipt_url: string | null`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0002_proposals_activity.sql
-- Sprint A: agents propose, humans approve, everything audited.

create type proposal_type as enum (
  'task_update','task_done','blocker_create','decision_create','deadline_update'
);
create type proposal_state as enum ('pending','accepted','rejected','auto_applied');

create table agent_proposals (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid references documents(id),
  project_id       uuid references projects(id) on delete cascade,
  type             proposal_type not null,
  payload          jsonb not null,             -- the op object from extract-comms, verbatim
  target_task_id   uuid references tasks(id) on delete cascade,
  confidence       numeric(3,2) not null default 0.50,
  reasoning        text,
  evidence_excerpt text,
  state            proposal_state not null default 'pending',
  decided_by       text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index idx_agent_proposals_state on agent_proposals(state);

create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,        -- 'task' | 'invoice' | 'proposal' | 'blocker' | 'decision'
  entity_id   uuid not null,
  actor       text not null,        -- user email or 'agent:extract-comms'
  action      text not null,        -- 'create' | 'verb:completed' | 'accept_proposal' | ...
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz not null default now()
);
create index idx_activity_entity on activity_log(entity_type, entity_id);

alter table tasks    add column manual_priority int,
                     add column snoozed_until date;
alter table invoices add column invoice_url text,
                     add column receipt_url text;

alter table agent_proposals enable row level security;
alter table activity_log    enable row level security;
create policy "read agent_proposals" on agent_proposals for select to authenticated using (true);
create policy "read activity_log"    on activity_log    for select to authenticated using (true);
```

- [ ] **Step 2: Write the migration runner**

```js
// scripts/apply-migration.mjs — run one SQL file via Supabase Management API.
// Usage: node scripts/apply-migration.mjs supabase/migrations/0002_proposals_activity.sql
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-migration.mjs <sql-file>'); process.exit(1); }
// Load .env.local the same way scripts/smoke.mjs does — read that file first
// and copy its env-loading lines exactly (do not assume dotenv is installed).
const token = process.env.SUPABASE_TOKEN;
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const sql = readFileSync(file, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
```

- [ ] **Step 3: Apply migration**

Run: `node scripts/apply-migration.mjs supabase/migrations/0002_proposals_activity.sql`
Expected: `200 [...]`. Verify: `node scripts/smoke.mjs <email> <pass>` still passes auth.

- [ ] **Step 4: Append types to `lib/types.ts`**

```ts
export type ProposalType = 'task_update' | 'task_done' | 'blocker_create' | 'decision_create' | 'deadline_update';
export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'auto_applied';

export interface AgentProposal {
  id: string;
  document_id: string | null;
  project_id: string | null;
  type: ProposalType;
  payload: Record<string, unknown>;
  target_task_id: string | null;
  confidence: number;
  reasoning: string | null;
  evidence_excerpt: string | null;
  state: ProposalState;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}
```

Also add to the existing `Task` interface: `manual_priority: number | null;` and `snoozed_until: string | null;` — and to `Invoice`: `invoice_url: string | null;` and `receipt_url: string | null;`.

- [ ] **Step 5: Typecheck + stage**

Run: `npx tsc --noEmit` → clean. `git add supabase/migrations/0002_proposals_activity.sql scripts/apply-migration.mjs lib/types.ts`

---

### Task 2: Pure verb mapper for My Work row updates

**Files:**
- Create: `lib/work-verbs.ts`
- Test: `lib/work-verbs.test.ts`

**Interfaces:**
- Produces: `type WorkVerb = 'completed' | 'sent_email' | 'waiting' | 'delayed' | 'scheduled' | 'not_applicable' | 'note'`; `verbToPatch(verb: WorkVerb, input: string | null, today: string): { patch: Record<string, unknown>; action: string } | { error: string }`. `patch` is a `tasks` UPDATE payload (always includes `last_touched: today`); `action` is the activity_log action string (`verb:<verb>`).
- Consumed by: Task 4 server action `applyWorkVerb`.

- [ ] **Step 1: Write failing tests**

```ts
// lib/work-verbs.test.ts
import { describe, expect, it } from 'vitest';
import { verbToPatch } from './work-verbs.ts';

const TODAY = '2026-08-21';

describe('verbToPatch', () => {
  it('completed sets status done', () => {
    expect(verbToPatch('completed', null, TODAY)).toEqual({
      patch: { status: 'done', last_touched: TODAY }, action: 'verb:completed',
    });
  });
  it('waiting requires text and sets waiting_for', () => {
    expect(verbToPatch('waiting', 'Rowan', TODAY)).toEqual({
      patch: { waiting_for: 'Rowan', last_touched: TODAY }, action: 'verb:waiting',
    });
    expect(verbToPatch('waiting', '  ', TODAY)).toEqual({ error: 'input required' });
  });
  it('delayed/scheduled require a YYYY-MM-DD date and set due', () => {
    expect(verbToPatch('delayed', '2026-09-01', TODAY)).toEqual({
      patch: { due: '2026-09-01', last_touched: TODAY }, action: 'verb:delayed',
    });
    expect(verbToPatch('scheduled', 'not-a-date', TODAY)).toEqual({ error: 'invalid date' });
  });
  it('not_applicable drops the task', () => {
    expect(verbToPatch('not_applicable', null, TODAY)).toEqual({
      patch: { status: 'dropped', last_touched: TODAY }, action: 'verb:not_applicable',
    });
  });
  it('sent_email and note only touch last_touched (note text goes to activity log)', () => {
    expect(verbToPatch('sent_email', null, TODAY)).toEqual({
      patch: { last_touched: TODAY }, action: 'verb:sent_email',
    });
    expect(verbToPatch('note', 'called the city', TODAY)).toEqual({
      patch: { last_touched: TODAY }, action: 'verb:note',
    });
    expect(verbToPatch('note', '', TODAY)).toEqual({ error: 'input required' });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run lib/work-verbs.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/work-verbs.ts
// My Work row verbs (client handoff: Completed, Sent email, Waiting, Delayed,
// Scheduled, Not applicable, Add note) → tasks UPDATE patch + audit action.

export type WorkVerb =
  | 'completed' | 'sent_email' | 'waiting' | 'delayed'
  | 'scheduled' | 'not_applicable' | 'note';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function verbToPatch(
  verb: WorkVerb,
  input: string | null,
  today: string,
): { patch: Record<string, unknown>; action: string } | { error: string } {
  const text = (input ?? '').trim();
  const base = { last_touched: today };
  const action = `verb:${verb}`;
  switch (verb) {
    case 'completed':      return { patch: { status: 'done', ...base }, action };
    case 'not_applicable': return { patch: { status: 'dropped', ...base }, action };
    case 'sent_email':     return { patch: { ...base }, action };
    case 'waiting':
      if (!text) return { error: 'input required' };
      return { patch: { waiting_for: text, ...base }, action };
    case 'delayed':
    case 'scheduled':
      if (!DATE_RE.test(text)) return { error: 'invalid date' };
      return { patch: { due: text, ...base }, action };
    case 'note':
      if (!text) return { error: 'input required' };
      return { patch: { ...base }, action };
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run lib/work-verbs.test.ts` → PASS.
- [ ] **Step 5: Stage** — `git add lib/work-verbs.ts lib/work-verbs.test.ts`

---

### Task 3: Proposal router + State Writer (extraction stops writing directly)

**Files:**
- Create: `lib/proposals.ts`
- Test: `lib/proposals.test.ts`
- Create: `lib/state-writer.ts`
- Modify: `agents/extract-comms.ts` (replace direct-write loops in `applyExtractResult`)

**Interfaces:**
- Produces: `routeExtractResult(result: ExtractResult, ctx: { projectId: string; openTasks: Task[] }): { autoCreates: TaskOp[]; proposals: ProposalDraft[] }` where `ProposalDraft = { type: ProposalType; payload: Record<string, unknown>; target_task_id: string | null; confidence: number; reasoning: string }`.
- Produces: `applyProposal(admin: SupabaseClient, proposal: AgentProposal, actor: string, today: string): Promise<{ ok: true } | { error: string }>` in `lib/state-writer.ts` — the ONLY code path that commits proposal payloads, also writes `activity_log`. Also `logActivity(admin, { entity_type, entity_id, actor, action, before?, after? })`.
- Routing rules (tests pin these): task `op:'create'` with no dedup match → `autoCreates` (safe, additive). Task `op:'update'` or `op:'create'` that matched an existing task → proposal `task_update` (or `task_done` when `payload.status === 'done'`). Every blocker → `blocker_create` proposal. Every decision → `decision_create` proposal. Every deadline_update → `deadline_update` proposal. Confidence: model-supplied existing_id → 0.8; dedup fuzzy match → 0.6; blockers/decisions → 0.7; deadline updates → 0.6.
- Consumed by: Task 4/5 inbox actions; `applyExtractResult` (this task).

- [ ] **Step 1: Write failing tests**

```ts
// lib/proposals.test.ts
import { describe, expect, it } from 'vitest';
import { routeExtractResult } from './proposals.ts';
import type { Task } from './types.ts';

const openTask = {
  id: 't1', project_id: 'p1', title: 'Retain civil engineer', status: 'open',
} as unknown as Task;

const base = { project_name: 'San Marco', tasks: [], blockers: [], decisions: [], drafts: [], vendor_hours: [], deadline_updates: [] };

describe('routeExtractResult', () => {
  it('new unmatched create goes to autoCreates', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', title: 'Order tree report', priority: 'normal' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(1);
    expect(r.proposals).toHaveLength(0);
  });
  it('update with existing_id becomes task_update proposal at 0.8', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', title: 'Retain civil engineer', priority: 'normal', owner: 'Noa' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.8 });
  });
  it('status done becomes task_done proposal', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'update', existing_id: 't1', title: 'Retain civil engineer', priority: 'normal', status: 'done' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals[0].type).toBe('task_done');
  });
  it('create that fuzzy-matches an open task becomes a 0.6 proposal, not a duplicate', () => {
    const r = routeExtractResult(
      { ...base, tasks: [{ op: 'create', title: 'retain the civil engineer', priority: 'normal' }] },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.autoCreates).toHaveLength(0);
    expect(r.proposals[0]).toMatchObject({ type: 'task_update', target_task_id: 't1', confidence: 0.6 });
  });
  it('blockers, decisions and deadline updates always become proposals', () => {
    const r = routeExtractResult(
      {
        ...base,
        blockers: [{ what: 'CE not retained', blocked_by: 'Noa decision' }],
        decisions: [{ title: 'Go with waiver' }],
        deadline_updates: [{ task_match: 'Retain civil engineer', new_due: '2026-09-01', evidence: 'email says so' }],
      },
      { projectId: 'p1', openTasks: [openTask] },
    );
    expect(r.proposals.map((p) => p.type).sort()).toEqual(['blocker_create', 'deadline_update', 'decision_create'].sort());
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run lib/proposals.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/proposals.ts`**

```ts
// lib/proposals.ts
// Routes extraction output: additive creates auto-apply; anything that changes
// or asserts existing truth becomes a pending proposal (client handoff §6, §8).
import { matchExistingTask } from './dedup.ts';
import type { ExtractResult, TaskOp } from '../agents/schemas.ts';
import type { ProposalType, Task } from './types.ts';

export interface ProposalDraft {
  type: ProposalType;
  payload: Record<string, unknown>;
  target_task_id: string | null;
  confidence: number;
  reasoning: string;
}

export function routeExtractResult(
  result: ExtractResult,
  ctx: { projectId: string; openTasks: Task[] },
): { autoCreates: TaskOp[]; proposals: ProposalDraft[] } {
  const autoCreates: TaskOp[] = [];
  const proposals: ProposalDraft[] = [];

  for (const op of result.tasks) {
    let targetId = op.op === 'update' ? op.existing_id ?? null : null;
    let confidence = 0.8;
    if (!targetId) {
      const match = matchExistingTask(
        { title: op.title, project_id: ctx.projectId, stage_key: op.stage_key ?? null },
        ctx.openTasks,
      );
      if (match) { targetId = match.id; confidence = 0.6; }
    }
    if (!targetId) { autoCreates.push(op); continue; }
    proposals.push({
      type: op.status === 'done' ? 'task_done' : 'task_update',
      payload: op as unknown as Record<string, unknown>,
      target_task_id: targetId,
      confidence,
      reasoning: op.op === 'update' ? 'model matched existing task' : 'fuzzy title match against open task',
    });
  }
  for (const b of result.blockers) {
    proposals.push({ type: 'blocker_create', payload: b, target_task_id: null, confidence: 0.7, reasoning: 'new blocker asserted by communication' });
  }
  for (const d of result.decisions) {
    proposals.push({ type: 'decision_create', payload: d, target_task_id: null, confidence: 0.7, reasoning: 'decision asserted by communication' });
  }
  for (const du of result.deadline_updates) {
    proposals.push({ type: 'deadline_update', payload: du, target_task_id: null, confidence: 0.6, reasoning: du.evidence });
  }
  return { autoCreates, proposals };
}
```

- [ ] **Step 4: Run tests** — PASS expected.

- [ ] **Step 5: Implement `lib/state-writer.ts`**

```ts
// lib/state-writer.ts
// The only module that commits agent proposals (client handoff: "one service writes").
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchExistingTask } from './dedup.ts';
import type { AgentProposal, Task } from './types.ts';

export async function logActivity(
  admin: SupabaseClient,
  entry: { entity_type: string; entity_id: string; actor: string; action: string; before?: unknown; after?: unknown },
): Promise<void> {
  await admin.from('activity_log').insert({
    entity_type: entry.entity_type, entity_id: entry.entity_id,
    actor: entry.actor, action: entry.action,
    before_json: entry.before ?? null, after_json: entry.after ?? null,
  });
}

export async function applyProposal(
  admin: SupabaseClient,
  p: AgentProposal,
  actor: string,
  today: string,
): Promise<{ ok: true } | { error: string }> {
  const pay = p.payload as Record<string, unknown>;
  if (p.type === 'task_update' || p.type === 'task_done') {
    if (!p.target_task_id) return { error: 'proposal has no target task' };
    const patch: Record<string, unknown> = { last_touched: today, document_id: p.document_id };
    for (const k of ['description', 'owner', 'due', 'follow_up_date', 'priority', 'status'] as const) {
      if (pay[k] !== undefined && pay[k] !== null) patch[k] = pay[k];
    }
    if (pay.waiting_for !== undefined) patch.waiting_for = (pay.waiting_for as string) || null;
    const { data: before } = await admin.from('tasks').select('*').eq('id', p.target_task_id).maybeSingle();
    const { error } = await admin.from('tasks').update(patch).eq('id', p.target_task_id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'task', entity_id: p.target_task_id, actor, action: `accept:${p.type}`, before, after: patch });
    return { ok: true };
  }
  if (p.type === 'blocker_create') {
    const { data, error } = await admin.from('blockers').insert({
      project_id: p.project_id, document_id: p.document_id,
      what: pay.what, blocked_by: pay.blocked_by,
      days_at_risk: pay.days_at_risk ?? 0, downstream: pay.downstream ?? [],
      suggested_action: pay.suggested_action ?? null,
    }).select('id').single();
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'blocker', entity_id: data.id, actor, action: 'accept:blocker_create', after: pay });
    return { ok: true };
  }
  if (p.type === 'decision_create') {
    const { data, error } = await admin.from('decisions').insert({
      project_id: p.project_id, title: pay.title, detail: pay.detail ?? null,
      decided_at: (pay.decided_at as string | undefined) ?? today,
    }).select('id').single();
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'decision', entity_id: data.id, actor, action: 'accept:decision_create', after: pay });
    return { ok: true };
  }
  if (p.type === 'deadline_update') {
    const { data: open } = await admin.from('tasks').select('*').eq('status', 'open').eq('project_id', p.project_id!);
    const match = matchExistingTask(
      { title: pay.task_match as string, project_id: p.project_id! },
      (open ?? []) as Task[],
    );
    if (!match) return { error: 'no matching open task' };
    const { error } = await admin.from('tasks').update({ due: pay.new_due, last_touched: today }).eq('id', match.id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'task', entity_id: match.id, actor, action: 'accept:deadline_update', after: { due: pay.new_due } });
    return { ok: true };
  }
  return { error: `unknown proposal type ${p.type}` };
}
```

- [ ] **Step 6: Rewire `applyExtractResult` in `agents/extract-comms.ts`**

Replace the four direct-write loops (tasks, blockers, decisions, deadline_updates — KEEP the drafts and vendor_hours loops unchanged) with:

```ts
  const { autoCreates, proposals } = routeExtractResult(result, {
    projectId: project.id, openTasks: ctx.openTasks,
  });

  for (const op of autoCreates) {
    const { data } = await admin.from('tasks').insert({
      project_id: project.id, document_id: docId, title: op.title,
      description: op.description ?? null, owner: op.owner ?? null,
      waiting_for: op.waiting_for ?? null, due: op.due ?? null,
      stage_key: op.stage_key ?? null, priority: op.priority ?? 'normal',
      status: 'open', planned: op.planned ?? true,
      follow_up_date: op.follow_up_date ?? null, source: 'extract-comms',
    }).select('id').single();
    if (data) await logActivity(admin, { entity_type: 'task', entity_id: data.id, actor: 'agent:extract-comms', action: 'create', after: op });
    summary.tasks_created++;
  }

  for (const pr of proposals) {
    await admin.from('agent_proposals').insert({
      document_id: docId, project_id: project.id, type: pr.type,
      payload: pr.payload, target_task_id: pr.target_task_id,
      confidence: pr.confidence, reasoning: pr.reasoning,
      evidence_excerpt: null, state: 'pending',
    });
    summary.proposals = (summary.proposals ?? 0) + 1;
  }
```

Imports to add at top: `import { routeExtractResult } from '../lib/proposals.ts';` and `import { logActivity } from '../lib/state-writer.ts';`. Extend `ApplySummary` with `proposals?: number;`. The old counters `tasks_updated`, `blockers`, `decisions`, `deadline_updates` stay in the interface but are set to 0 (their writes now flow through proposals).

- [ ] **Step 7: Fix the existing extract-comms tests** — `agents/extract-comms.test.ts` asserts direct-write behavior. Update expectations: matched updates now produce rows inserted into `agent_proposals` (extend the test's supabase stub to record inserts per table) instead of `tasks` updates. Run `npx vitest run` → all green.

- [ ] **Step 8: Stage** — `git add lib/proposals.ts lib/proposals.test.ts lib/state-writer.ts agents/extract-comms.ts agents/extract-comms.test.ts`

---

### Task 4: Server actions — work verbs, snooze/pin, proposals accept/reject

**Files:**
- Create: `app/actions/work.ts`
- Create: `app/actions/proposals.ts`

**Interfaces:**
- Produces: `applyWorkVerb(taskId: string, verb: WorkVerb, input: string | null): Promise<{ ok: true } | { error: string }>`; `snoozeTask(taskId: string, until: string)`; `pinTask(taskId: string, manualPriority: number | null)`.
- Produces: `acceptProposal(id: string)`, `rejectProposal(id: string)` — both return `{ ok: true } | { error: string }` and revalidate `/`, `/work`, `/inbox`.

- [ ] **Step 1: Implement `app/actions/work.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { verbToPatch, type WorkVerb } from '@/lib/work-verbs';
import { logActivity } from '@/lib/state-writer';

export async function applyWorkVerb(taskId: string, verb: WorkVerb, input: string | null) {
  const user = await requireUser();
  const mapped = verbToPatch(verb, input, laToday());
  if ('error' in mapped) return { error: mapped.error };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update(mapped.patch).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: mapped.action, after: verb === 'note' ? { note: input } : mapped.patch,
  });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

export async function snoozeTask(taskId: string, until: string) {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: 'invalid date' };
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ snoozed_until: until }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'snooze', after: { until } });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}

export async function pinTask(taskId: string, manualPriority: number | null) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { error } = await admin.from('tasks').update({ manual_priority: manualPriority }).eq('id', taskId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id, action: 'pin', after: { manualPriority } });
  revalidatePath('/'); revalidatePath('/work');
  return { ok: true };
}
```

- [ ] **Step 2: Implement `app/actions/proposals.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { applyProposal, logActivity } from '@/lib/state-writer';
import type { AgentProposal } from '@/lib/types';

async function decide(id: string, accept: boolean) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const actor = user.email ?? user.id;
  const { data } = await admin.from('agent_proposals').select('*').eq('id', id).eq('state', 'pending').maybeSingle();
  if (!data) return { error: 'proposal not found or already decided' };
  const proposal = data as AgentProposal;
  if (accept) {
    const applied = await applyProposal(admin, proposal, actor, laToday());
    if ('error' in applied) return applied;
  }
  const { error } = await admin.from('agent_proposals')
    .update({ state: accept ? 'accepted' : 'rejected', decided_by: actor, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'proposal', entity_id: id, actor, action: accept ? 'accept_proposal' : 'reject_proposal' });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/inbox');
  return { ok: true };
}

export async function acceptProposal(id: string) { return decide(id, true); }
export async function rejectProposal(id: string) { return decide(id, false); }
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` clean. `git add app/actions/work.ts app/actions/proposals.ts`

---

### Task 5: Review Inbox page `/inbox`

**Files:**
- Create: `app/(dash)/inbox/page.tsx`
- Create: `components/inbox/proposal-card.tsx`
- Modify: `app/(dash)/layout.tsx` (nav link), `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- Consumes: `acceptProposal`/`rejectProposal` from Task 4; `AgentProposal` type from Task 1.

- [ ] **Step 1: i18n keys (both files)**

en: `"nav.inbox": "Inbox"`, `"inbox.title": "Agent review inbox"`, `"inbox.sub": "Conflicts and low-confidence suggestions wait for your decision"`, `"inbox.empty": "Nothing waiting — agent changes were additive only"`, `"inbox.accept": "Accept"`, `"inbox.reject": "Reject"`, `"inbox.confidence": "confidence"`, `"inbox.type.task_update": "Update task"`, `"inbox.type.task_done": "Mark task done"`, `"inbox.type.blocker_create": "New blocker"`, `"inbox.type.decision_create": "New decision"`, `"inbox.type.deadline_update": "Deadline change"`.
he: `"nav.inbox": "אישורים"`, `"inbox.title": "תיבת אישורי סוכן"`, `"inbox.sub": "קונפליקטים והצעות בביטחון נמוך מחכים להחלטה שלך"`, `"inbox.empty": "אין הצעות ממתינות — שינויי הסוכן היו הוספות בלבד"`, `"inbox.accept": "אישור"`, `"inbox.reject": "דחייה"`, `"inbox.confidence": "ביטחון"`, `"inbox.type.task_update": "עדכון משימה"`, `"inbox.type.task_done": "סימון משימה כבוצעה"`, `"inbox.type.blocker_create": "חסם חדש"`, `"inbox.type.decision_create": "החלטה חדשה"`, `"inbox.type.deadline_update": "שינוי דדליין"`.

- [ ] **Step 2: `components/inbox/proposal-card.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { acceptProposal, rejectProposal } from '@/app/actions/proposals';
import type { AgentProposal } from '@/lib/types';

interface Labels { accept: string; reject: string; confidence: string; typeLabel: string; error: string }

export function ProposalCard({ proposal, projectName, taskTitle, labels }: {
  proposal: AgentProposal; projectName: string | null; taskTitle: string | null; labels: Labels;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const act = (fn: (id: string) => Promise<{ ok?: true; error?: string }>) => start(async () => {
    setFailed(false);
    const res = await fn(proposal.id);
    if (res?.error) setFailed(true);
  });
  const pay = proposal.payload as Record<string, unknown>;
  const summary = String(pay.title ?? pay.what ?? pay.task_match ?? '');
  return (
    <li className={`rounded-(--radius-card) border border-line bg-card p-4 shadow-card ${pending ? 'opacity-40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-apricot-soft px-2 py-0.5 text-[11px] text-apricot">{labels.typeLabel}</span>
        {projectName && <span className="text-xs font-medium text-ink2">{projectName}</span>}
        <span className="ms-auto text-[11px] text-ink3">{labels.confidence}: {Math.round(proposal.confidence * 100)}%</span>
      </div>
      <p className="mt-2 text-sm text-ink">{summary || taskTitle}</p>
      {taskTitle && summary && <p className="mt-0.5 text-xs text-ink3">→ {taskTitle}</p>}
      {proposal.reasoning && <p className="mt-1 text-xs text-ink3">{proposal.reasoning}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={pending} onClick={() => act(acceptProposal)}
          className="rounded-lg bg-sage px-3 py-1.5 text-sm text-white disabled:opacity-50">{labels.accept}</button>
        <button type="button" disabled={pending} onClick={() => act(rejectProposal)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink2 disabled:opacity-50">{labels.reject}</button>
        {failed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
      </div>
    </li>
  );
}
```

- [ ] **Step 3: `app/(dash)/inbox/page.tsx`**

```tsx
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { ProposalCard } from '@/components/inbox/proposal-card';
import type { AgentProposal, Project, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [proposalsQ, projectsQ] = await Promise.all([
    supabase.from('agent_proposals').select('*').eq('state', 'pending').order('created_at', { ascending: false }),
    supabase.from('projects').select('id,name'),
  ]);
  const proposals = (proposalsQ.data ?? []) as AgentProposal[];
  const names = new Map(((projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[]).map((p) => [p.id, p.name]));
  const taskIds = proposals.map((p) => p.target_task_id).filter((x): x is string => !!x);
  const { data: tasksData } = taskIds.length
    ? await supabase.from('tasks').select('id,title').in('id', taskIds)
    : { data: [] };
  const taskTitles = new Map(((tasksData ?? []) as Pick<Task, 'id' | 'title'>[]).map((row) => [row.id, row.title]));

  return (
    <div>
      <h1 className="font-serif text-3xl text-ink">{t('inbox.title')}</h1>
      <p className="mt-1 text-sm text-ink3">{t('inbox.sub')}</p>
      {proposals.length === 0 ? (
        <p className="mt-6 rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{t('inbox.empty')}</p>
      ) : (
        <ul className="mt-5 space-y-2">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              projectName={p.project_id ? names.get(p.project_id) ?? null : null}
              taskTitle={p.target_task_id ? taskTitles.get(p.target_task_id) ?? null : null}
              labels={{
                accept: t('inbox.accept'), reject: t('inbox.reject'),
                confidence: t('inbox.confidence'),
                typeLabel: t(`inbox.type.${p.type}`),
                error: t('common.error_save'),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Nav link** — in `app/(dash)/layout.tsx` add `{ href: '/inbox', label: t('nav.inbox') }` to the `links` array right after the overview entry.
- [ ] **Step 5: Verify** — `npm run check` green; dev server: `/inbox` renders empty state; upload a `.txt` email referencing an existing open task as done → proposal appears; accept applies + disappears. Stage all files.

---

### Task 6: My Work page `/work` with 5 views

**Files:**
- Create: `app/(dash)/work/page.tsx`
- Create: `components/work/work-row.tsx`
- Create: `components/work/verb-menu.tsx`
- Modify: `lib/priority.ts`, `lib/priority.test.ts`, `app/(dash)/layout.tsx` (nav), `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- Consumes: `applyWorkVerb` (Task 4); `WaitingEditor` from `components/overview/waiting-editor.tsx` (props: `taskId, value, label, editTitle, cancelLabel, errorLabel`); `scoreTask`/`topActions` from `lib/priority.ts`.
- Produces: `scoreTask` change — task with `manual_priority` set returns `1000 + manual_priority` (manual pin always wins, spec §5); `topActions` excludes tasks where `snoozed_until > today`.
- View queries (server-side, all on open tasks): `today` = not snoozed, ranked desc by `scoreTask`, top 15; `blocking` = active blockers panel + `priority === 'critical'` tasks; `followups` = `follow_up_date <= today || check_back_on <= today`; `waiting` = `waiting_for` not null; `all` = every open task.

- [ ] **Step 1: Failing priority tests** — append to `lib/priority.test.ts` (reuse that file's existing task fixture; add `manual_priority: null, snoozed_until: null` to the fixture so older tests still typecheck):

```ts
  it('manual_priority pins above everything', () => {
    const pinned = { ...baseTask, manual_priority: 5 } as Task;
    expect(scoreTask(pinned, { today: TODAY })).toBe(1005);
  });
  it('snoozed tasks are excluded from topActions', () => {
    const snoozed = { ...baseTask, snoozed_until: '2099-01-01' } as Task;
    const actions = topActions([snoozed], [], new Map(), new Map(), { today: TODAY, limit: 8 });
    expect(actions.find((a) => a.id === snoozed.id)).toBeUndefined();
  });
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — in `lib/priority.ts`: first line of `scoreTask`: `if (t.manual_priority != null) return 1000 + t.manual_priority;`; in `topActions`, before scoring: `tasks = tasks.filter((t) => !t.snoozed_until || t.snoozed_until <= opts.today);`.
- [ ] **Step 4: Run tests** — PASS (all suites).

- [ ] **Step 5: i18n keys** — en: `"nav.work": "My Work"`, `"work.title": "My Work"`, `"work.sub": "One list, ranked — act here"`, `"work.view.today": "Today"`, `"work.view.blocking": "Blocking"`, `"work.view.followups": "Follow-ups"`, `"work.view.waiting": "Waiting"`, `"work.view.all": "All"`, `"work.empty": "Nothing in this view"`, `"work.verb.completed": "Completed"`, `"work.verb.sent_email": "Sent email"`, `"work.verb.waiting": "Waiting on…"`, `"work.verb.delayed": "Delayed to…"`, `"work.verb.scheduled": "Scheduled for…"`, `"work.verb.not_applicable": "Not applicable"`, `"work.verb.note": "Add note"`, `"work.update": "Update"`, `"work.snooze": "Snooze"`, `"work.pin": "Pin"`.
he: `"nav.work": "העבודה שלי"`, `"work.title": "העבודה שלי"`, `"work.sub": "רשימה אחת, מדורגת — פועלים כאן"`, `"work.view.today": "היום"`, `"work.view.blocking": "חוסם"`, `"work.view.followups": "מעקבים"`, `"work.view.waiting": "בהמתנה"`, `"work.view.all": "הכול"`, `"work.empty": "אין פריטים בתצוגה הזו"`, `"work.verb.completed": "בוצע"`, `"work.verb.sent_email": "נשלח מייל"`, `"work.verb.waiting": "ממתין ל…"`, `"work.verb.delayed": "נדחה ל…"`, `"work.verb.scheduled": "נקבע ל…"`, `"work.verb.not_applicable": "לא רלוונטי"`, `"work.verb.note": "הוספת הערה"`, `"work.update": "עדכון"`, `"work.snooze": "השהיה"`, `"work.pin": "נעיצה"`.

- [ ] **Step 6: `components/work/verb-menu.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { applyWorkVerb } from '@/app/actions/work';
import type { WorkVerb } from '@/lib/work-verbs';

const NEEDS_TEXT: WorkVerb[] = ['waiting', 'note'];
const NEEDS_DATE: WorkVerb[] = ['delayed', 'scheduled'];
const VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];

export function VerbMenu({ taskId, labels }: { taskId: string; labels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [askInput, setAskInput] = useState<WorkVerb | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const run = (verb: WorkVerb, input: string | null) => start(async () => {
    setFailed(false);
    const res = await applyWorkVerb(taskId, verb, input);
    if (res?.error) { setFailed(true); return; }
    setOpen(false); setAskInput(null); setDraft('');
  });

  if (askInput) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus aria-label={labels[askInput]} value={draft}
          type={NEEDS_DATE.includes(askInput) ? 'date' : 'text'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(askInput, draft); if (e.key === 'Escape') setAskInput(null); }}
          className={`w-32 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink ${failed ? 'border-coral' : 'border-mist'}`} />
        <button type="button" disabled={pending} onClick={() => run(askInput, draft)} aria-label={labels[askInput]}
          className="min-h-7 rounded-full bg-sage px-2.5 py-0.5 text-[11px] text-white disabled:opacity-50"><span aria-hidden="true">✓</span></button>
        <button type="button" onClick={() => setAskInput(null)} aria-label={labels.cancel}
          className="min-h-7 rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3"><span aria-hidden="true">✕</span></button>
      </span>
    );
  }

  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
        className="rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2 hover:bg-card2">
        {labels.update}
      </button>
      {open && (
        <span role="menu" className="absolute end-0 top-full z-20 mt-1 flex w-44 flex-col rounded-lg border border-line bg-card p-1 shadow-card">
          {VERBS.map((v) => (
            <button key={v} type="button" role="menuitem" disabled={pending}
              onClick={() => (NEEDS_TEXT.includes(v) || NEEDS_DATE.includes(v)) ? setAskInput(v) : run(v, null)}
              className="rounded px-2 py-1.5 text-start text-xs text-ink2 hover:bg-card2 hover:text-ink disabled:opacity-50">
              {labels[v]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
```

Note: `labels` map keys for verbs are the raw verb names — the page passes `{ completed: t('work.verb.completed'), sent_email: t('work.verb.sent_email'), waiting: t('work.verb.waiting'), delayed: t('work.verb.delayed'), scheduled: t('work.verb.scheduled'), not_applicable: t('work.verb.not_applicable'), note: t('work.verb.note'), update: t('work.update'), cancel: t('common.cancel') }`.

- [ ] **Step 7: `components/work/work-row.tsx`**

```tsx
import type { Task } from '@/lib/types';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';

export function WorkRow({ task, labels }: { task: Task; labels: Record<string, string> }) {
  return (
    <li className="flex items-start gap-3 border-b border-line2 px-3 py-2 last:border-b-0">
      <details className="min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-baseline gap-2">
          <span aria-hidden="true" className="text-ink3">+</span>
          <span className="text-sm text-ink">{task.title}</span>
          {task.due && <span className="ms-auto whitespace-nowrap font-mono text-xs text-ink2">{task.due}</span>}
        </summary>
        <div className="ms-5 mt-1 space-y-1 text-xs text-ink2">
          {task.description && <p>{task.description}</p>}
          {task.owner && <p>{labels.owner}: {task.owner}</p>}
          {task.source && <p>{labels.fromSource}: {task.source}</p>}
        </div>
      </details>
      <WaitingEditor taskId={task.id} value={task.waiting_for} label={labels.waiting}
        editTitle={labels.editWaiting} cancelLabel={labels.cancel} errorLabel={labels.errorSave} />
      <VerbMenu taskId={task.id} labels={labels} />
    </li>
  );
}
```

- [ ] **Step 8: `app/(dash)/work/page.tsx`** — server page, `export const dynamic = 'force-dynamic'`. Read `searchParams` (`view` default `'today'`). Fetch in `Promise.all`: open tasks (`.eq('status','open')`), projects (`id,name`), active blockers, pending proposal count (`agent_proposals` `select('id', { count: 'exact', head: true }).eq('state','pending')`), approved invoices (`select('amount_usd').eq('status','approved')`). Apply the view filter from **Interfaces** above (implement as a local `filterView(tasks, view, today)` function in the page file). Group with `Map<string | null, Task[]>` keyed by `project_id`; sort groups by `Math.max(...scoreTask)` desc; render group header (project name or `t('common.all')`) once, then `<WorkRow>` per task sorted desc. View tabs = `<Link href={'/work?view=' + v}>` pills with `aria-current={view === v ? 'page' : undefined}`, active style `bg-ink text-bg`, inactive `bg-card2 text-ink2`. On `blocking` view render active blockers first in a bordered panel (reuse the row layout from `components/overview/whats-stuck.tsx` — read it and copy its item markup). Pending-proposal count > 0 renders a link banner to `/inbox` (`bg-apricot-soft text-apricot`). Payment Run card per Task 7 Step 4. Empty view → `t('work.empty')` panel.

- [ ] **Step 9: Nav** — add `{ href: '/work', label: t('nav.work') }` after the overview entry in `app/(dash)/layout.tsx`.
- [ ] **Step 10: Verify** — `npm run check` green; dev: all 5 views render, Completed verb moves task out, `activity_log` row exists (Supabase table editor), pin/snooze not exposed in UI yet is fine (actions exist for Sprint C UI). Stage all.

---

### Task 7: Invoice link fields + Payment Run card

**Files:**
- Create: `components/invoices/link-editor.tsx`
- Modify: `app/actions/invoices.ts`, `app/(dash)/invoices/page.tsx`, `app/(dash)/work/page.tsx`, `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- Produces: `saveInvoiceLinks(invoiceId: string, invoiceUrl: string | null, receiptUrl: string | null): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Action** — append to `app/actions/invoices.ts` (import `logActivity` from `@/lib/state-writer`):

```ts
export async function saveInvoiceLinks(invoiceId: string, invoiceUrl: string | null, receiptUrl: string | null) {
  const user = await requireUser();
  const ok = (u: string | null) => u === null || u === '' || /^https:\/\//.test(u);
  if (!ok(invoiceUrl) || !ok(receiptUrl)) return { error: 'links must start with https://' };
  const admin = supabaseAdmin();
  const patch = { invoice_url: invoiceUrl || null, receipt_url: receiptUrl || null };
  const { error } = await admin.from('invoices').update(patch).eq('id', invoiceId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id, action: 'links', after: patch });
  revalidatePath('/invoices');
  return { ok: true };
}
```

- [ ] **Step 2: i18n** — en: `"invoices.open_invoice": "Open invoice"`, `"invoices.open_receipt": "Open receipt"`, `"invoices.edit_links": "Edit links"`, `"work.payment_run": "Payment run"`, `"work.payment_run_sub": "{n} approved invoices · {total} — open the invoice workspace"`. he: `"invoices.open_invoice": "פתיחת חשבונית"`, `"invoices.open_receipt": "פתיחת קבלה"`, `"invoices.edit_links": "עריכת קישורים"`, `"work.payment_run": "ריצת תשלומים"`, `"work.payment_run_sub": "{n} חשבוניות מאושרות · {total} — פתיחת סביבת החשבוניות"`.

- [ ] **Step 3: `components/invoices/link-editor.tsx`** — client component, same shape as `WaitingEditor` (pencil button → editing state → save/cancel): two `<input type="url">` fields (`aria-label` = `invoices.open_invoice` / `invoices.open_receipt` labels), save calls `saveInvoiceLinks(invoiceId, invoiceDraft, receiptDraft)`, error state shows `common.error_save` text. Props: `{ invoiceId: string; invoiceUrl: string | null; receiptUrl: string | null; labels: { edit: string; invoice: string; receipt: string; cancel: string; error: string } }`.

- [ ] **Step 4: Invoices page cells** — in the row, after the transfer cell: `{inv.invoice_url && <a href={inv.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-mist underline">{t('invoices.open_invoice')}</a>}`, same pattern for `receipt_url`, then `<LinkEditor …/>` with labels.
- [ ] **Step 5: Payment Run card in `/work`** — `today` view, above the list, when approved count > 0: card `rounded-(--radius-card) border border-sage-line bg-sage-soft p-4` with `<Link href="/invoices?status=approved">`, title `t('work.payment_run')`, sub = `t('work.payment_run_sub').replace('{n}', String(n)).replace('{total}', total.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))`.
- [ ] **Step 6: Verify + stage** — `npm run check`; dev: link edit round-trip works; card links to filtered invoices.

---

### Task 7b: ZIP + OLM email-archive upload (client feedback — Noa's exports; Dor confirmed both formats)

**Files:**
- Create: `lib/parse/archive.ts`
- Test: `lib/parse/archive.test.ts`
- Modify: `app/api/upload/route.ts` (accept `.zip`/`.olm`), `package.json` (add `jszip`), `lib/i18n/en.json` + `lib/i18n/he.json` (`upload.help` mentions ZIP/OLM)

**Interfaces:**
- `npm i jszip` (server-only usage; add `import 'server-only'` to `lib/parse/archive.ts`).
- Produces: `extractEmailsFromArchive(buffer: Buffer, kind: 'zip' | 'olm'): Promise<{ raw: string; external_id: string | null }[]>` —
  - `zip`: every entry ending `.eml` parsed via existing `parseEml` from `lib/parse/eml.ts` (read that file for its exact signature and reuse it — its output must be rendered to the same `raw` header+body string shape the route's `.eml` branch builds), every `.txt` entry taken as raw text (`external_id: null`).
  - `olm` (an Outlook-for-Mac archive = a ZIP): entries matching `/message_\d+\.xml$/i` under any folder — extract fields with tolerant regexes over the XML text: subject `<OPFMessageCopySubject>([\s\S]*?)<\/OPFMessageCopySubject>`, sender `<OPFMessageCopySenderAddress>[\s\S]*?<emailAddress[^>]*OPFContactEmailAddressAddress="([^"]+)"`, date `<OPFMessageCopySentTime>([^<]+)<`, body `<OPFMessageCopyBody[^>]*>([\s\S]*?)<\/OPFMessageCopyBody>` (strip residual tags + decode `&amp;/&lt;/&gt;/&quot;/&#13;`), external_id from `<OPFMessageCopyMessageID>([^<]+)<` when present; build `raw` as `From: …\nDate: …\nSubject: …\n\n<body>`.
  - Entries that match neither → skipped. Cap: first 500 usable entries per archive.
- Upload route: `.zip`/`.olm` branch (before the generic text fallback): `const emails = await extractEmailsFromArchive(buffer, name.endsWith('.olm') ? 'olm' : 'zip')`; then reuse the existing `.jsonl` loop shape exactly (read the current `.jsonl` branch in the route and mirror it): `ingestDocument` per email with `external_id` (fallback `` `${dedupKey}:${i}` ``), `processDocument` only for the newest `PROCESS_CAP` (same constant), respond `{ ok: true, type: 'email_archive', stored, deduped, processed }`. The route's 20MB cap applies — larger exports 413 and Noa splits them (acceptable for POC).
- Tests (vitest, no network/supabase): (1) zip with one `.eml` entry (`From: a@b.c\nSubject: hi\n\nbody`) + one junk entry → 1 result, raw contains 'Subject: hi'; (2) OLM-shaped zip with one `message_0001.xml` using the OPF tags → subject/sender in raw, external_id set; (3) OLM message without `OPFMessageCopyMessageID` → external_id null.

- [ ] **Step 1:** Failing tests per above. **Step 2:** RED. **Step 3:** `npm i jszip`, implement `archive.ts`. **Step 4:** GREEN + `npx tsc --noEmit` + full `npx vitest run`. **Step 5:** Wire the upload-route branch + i18n `upload.help` (en: append " · ZIP/OLM → email archive import"; he: append " · ZIP/OLM → ייבוא ארכיון מיילים"). **Step 6:** Stage all (no commit).

---

### Task 8: Checkpoint — full verification + handoff to Dor

- [ ] Run `npm run check` — typecheck + lint + all vitest green.
- [ ] Run `npm run build` — green.
- [ ] Dev pass: `/work` 5 views + verbs + Payment Run; `/inbox` accept/reject; `/invoices` links; overview unchanged.
- [ ] End-to-end trust test: upload `.txt` email marking an existing open task done → task stays open + `task_done` proposal in `/inbox` → accept → task closes → `activity_log` shows `accept:task_done`.
- [ ] `git add -A`, report to Dor for `/commit-push`.

## Self-Review Notes

- Spec coverage: BUILD_SPEC §2 My Work (views, verbs, `+` disclosure, one canonical record, Payment Run) → Tasks 6–7. §6 steps 4/10 (reconciliation proposals, State Writer) → Task 3. §8 trust (manual outranks agents, audit, no silent overwrite) → Tasks 3–5. Review Inbox → Task 5. GAP-PLAN #1/#2/#7 fully mapped.
- Out of Sprint A scope by design: relationships / `what_this_unlocks` (Sprint C), evidence excerpts stay null until evidence links (Sprint C), Weekly Review (Sprint D), pin/snooze UI (actions shipped now, surfaced in Sprint C).
- Type consistency check done: `WorkVerb` names = `work.verb.*` keys; `ProposalType` union = SQL enum = `inbox.type.*` keys; `WaitingEditor` props match its current signature (`taskId,value,label,editTitle,cancelLabel,errorLabel`).
