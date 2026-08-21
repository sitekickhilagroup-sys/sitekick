# Sprint C — Relationships, Portfolio Restructure, Client Design System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed task relationships with evidence (Blocks/Supports/Parallel/Unrelated/Needs verification) feed "what this unlocks" in priority; the overview becomes the demo's Portfolio (understand-only); the whole app adopts the client design system (Geist + semantic palette, red = verified blocker only).

**Architecture:** New `relationships` table + `relationship_create` proposal type flowing through the existing Sprint A inbox. Priority engine gains an `unlocks` count. `app/(dash)/page.tsx` is rebuilt as Portfolio accordions (legacy rails/tasks sections retire — `/work` from Sprint A owns acting). Design system is a token swap in `app/globals.css` + Geist font wiring in `app/layout.tsx`.

**Tech Stack:** Next.js 16, Supabase, `geist` npm package, Vitest.

**Spec:** `docs/client-handoff/SITEKICK_BUILD_SPEC.md` §4 (relationship contract), §2 (Portfolio); `docs/client-handoff/SITEKICK_DESIGN_SYSTEM.md` (= identical copy at repo root `SITEKICK_DESIGN_SYSTEM.md`, per Dor); `GAP-PLAN.md` items 4, 6.

## Global Constraints

Same as Sprints A/B (requireUser, laToday, i18n parity, RLS read policies, logical classes, stage-don't-commit, migration runner). Sprints A+B merged first — consumes `agent_proposals`, `applyProposal`, `logActivity`, `/projects/[id]`, `WorkRow`.

---

### Task 1: Migration 0004 — relationships + new proposal type

**Files:**
- Create: `supabase/migrations/0004_relationships.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: table `relationships`; enum value `relationship_create` added to `proposal_type`.
- Produces TS: `RelationshipType = 'blocks' | 'supports' | 'parallel' | 'unrelated' | 'needs_verification'`; `Relationship { id: string; project_id: string | null; from_task_id: string; to_task_id: string; type: RelationshipType; reason: string | null; confidence: number; evidence_document_id: string | null; verified_by: string | null; verified_at: string | null; manual_override: boolean; created_at: string }`; extend `ProposalType` union with `'relationship_create'`.

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0004_relationships.sql
-- Sprint C: typed dependencies with evidence. Co-occurrence is not dependency.

create type relationship_type as enum ('blocks','supports','parallel','unrelated','needs_verification');

create table relationships (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references projects(id) on delete cascade,
  from_task_id         uuid not null references tasks(id) on delete cascade,
  to_task_id           uuid not null references tasks(id) on delete cascade,
  type                 relationship_type not null,
  reason               text,
  confidence           numeric(3,2) not null default 0.50,
  evidence_document_id uuid references documents(id),
  verified_by          text,
  verified_at          timestamptz,
  manual_override      boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (from_task_id, to_task_id),
  check (from_task_id <> to_task_id)
);
create index idx_relationships_from on relationships(from_task_id);
create index idx_relationships_to   on relationships(to_task_id);

alter type proposal_type add value if not exists 'relationship_create';

alter table relationships enable row level security;
create policy "read relationships" on relationships for select to authenticated using (true);
```

- [ ] **Step 2: Apply** — `node scripts/apply-migration.mjs supabase/migrations/0004_relationships.sql` → 200. (If the Management API rejects `alter type … add value` inside the transaction, split it into its own file `0004b_proposal_type.sql` and apply separately.)
- [ ] **Step 3: Types** — append per Interfaces; `npx tsc --noEmit`; stage.

---

### Task 2: Extraction proposes relationships; State Writer commits them

**Files:**
- Modify: `agents/schemas.ts`, `agents/extract-comms.ts` (SYSTEM prompt), `lib/proposals.ts`, `lib/proposals.test.ts`, `lib/state-writer.ts`

**Interfaces:**
- `agents/schemas.ts`: `export const RelationshipOutSchema = z.object({ from_match: z.string().min(1), to_match: z.string().min(1), type: z.enum(['blocks','supports','parallel','unrelated','needs_verification']), reason: z.string().min(1) });` and `ExtractResultSchema` gains `relationships: z.array(RelationshipOutSchema)`.
- `routeExtractResult`: every extracted relationship → `ProposalDraft { type: 'relationship_create', payload: rel, target_task_id: null, confidence: 0.5, reasoning: rel.reason }`. Existing test fixtures add `relationships: []` to `base`.
- `applyProposal` new branch `relationship_create`: fetch open tasks of `p.project_id`; resolve `from_match`/`to_match` via `matchExistingTask({ title, project_id }, openTasks)`; either end unresolved → `{ error: 'could not match both tasks' }`; upsert on `(from_task_id,to_task_id)` (`onConflict: 'from_task_id,to_task_id'`) with `type, reason, confidence: p.confidence, evidence_document_id: p.document_id, verified_by: actor, verified_at: new Date().toISOString()`; log activity `entity_type: 'relationship'`.
- SYSTEM prompt addition (after the deadline_updates rule): `- relationships: when the text EXPLICITLY states one work item cannot proceed until another completes, emit type="blocks" with from_match (the blocking task's title words) and to_match (the blocked task). Helpful-but-not-stopping = "supports". Independent tracks mentioned together = "parallel". NEVER infer blocks from co-occurrence in the same email or meeting — when plausible but unproven use type="needs_verification".`

- [ ] **Step 1:** Failing test in `lib/proposals.test.ts`: result with `relationships: [{ from_match: 'Retain civil engineer', to_match: 'Grading plan', type: 'blocks', reason: 'CE must be retained before grading scope' }]` → one proposal `{ type: 'relationship_create', confidence: 0.5 }`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement all four file changes. **Step 4:** `npx vitest run` fully green. Stage.

---

### Task 3: Priority engine — what this unlocks

**Files:**
- Modify: `lib/types.ts` (`ActionWhy` gains `unlocks?: number`), `lib/priority.ts`, `lib/priority.test.ts`, `lib/queries.ts`, `agents/daily-digest.ts`, `components/overview/action-row.tsx`, `components/overview/top-actions.tsx`, `app/(dash)/page.tsx`, `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- `topActions(tasks, blockers, stagesByProject, names, opts, relationships?: Relationship[])` — optional final param, default `[]`. Per task: `unlocks = relationships.filter((r) => r.from_task_id === t.id && r.type === 'blocks' && (r.verified_by || r.manual_override)).length`; `score += unlocks * 18`; `why.unlocks = unlocks || undefined`.
- `lib/queries.ts` `getOverviewData`: add `supabase.from('relationships').select('*').eq('type', 'blocks')` to the `Promise.all`, pass to `topActions`. Same in `agents/daily-digest.ts`.
- `ActionRow`: render `why.unlocks` in the why-parts join as `labels.unlocksN.replace('{n}', String(action.why.unlocks))`; `Labels` (action-row) and `rowLabels` (top-actions Props) gain `unlocksN: string`; `app/(dash)/page.tsx` passes `unlocksN: t('actions.unlocks')`.
- i18n: en `"actions.unlocks": "unlocks {n}"`, he `"actions.unlocks": "משחרר {n}"`.

- [ ] **Step 1:** Failing test: verified `blocks` relationship from `t1`→`t2` raises `t1` score by 18 and sets `why.unlocks = 1`; an unverified one (no `verified_by`, no `manual_override`) changes nothing.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** all suites PASS. Stage.

---

### Task 4: Relationship editor in task details

**Files:**
- Create: `app/actions/relationships.ts`
- Create: `components/work/relation-editor.tsx`
- Modify: `components/work/work-row.tsx`, `app/(dash)/work/page.tsx`, `app/(dash)/projects/[id]/page.tsx`, `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- Actions (Sprint A pattern — requireUser/admin/error-return/logActivity/revalidate `/` + `/work`): `saveRelationship(fromTaskId: string, toTaskId: string, type: RelationshipType, reason: string)` — reject `fromTaskId === toTaskId`; upsert `onConflict: 'from_task_id,to_task_id'` with `manual_override: true, verified_by: user.email, verified_at: now, confidence: 1, project_id` (read from the from-task row); `deleteRelationship(id: string)`.
- `WorkRow` props gain `relations?: { rel: Relationship; otherTitle: string; direction: 'from' | 'to' }[]` and `taskOptions?: { id: string; title: string }[]`; renders `<RelationEditor taskId={task.id} relations={relations ?? []} taskOptions={taskOptions ?? []} labels={labels} />` inside the `<details>` body.
- `RelationEditor` ('use client'): existing relations as chips — text `${labels['rel.type.' + rel.type]} · ${otherTitle}` with direction hint (`direction === 'from'` → `labels.blocksThis` context for the OTHER task, i.e. from this task outward use `rel.blocks_this`, inbound use `rel.blocked_by_this`), delete button `aria-label={labels.remove}`; add form: `<select>` of `taskOptions`, `<select>` of 5 types (i18n `rel.type.*`), reason `<input>`, save via `saveRelationship`; `useTransition` + `role="alert"` error using `labels.error`.
- Pages: fetch `relationships` rows for the listed task ids (`.or('from_task_id.in.(…),to_task_id.in.(…)')` or two `.in()` queries merged) inside the existing `Promise.all`; build per-task `relations` (resolving `otherTitle` from the task list) and `taskOptions` (open tasks of the same project, excluding self).
- i18n en: `"rel.title": "Dependencies"`, `"rel.add": "Add dependency"`, `"rel.reason": "Reason"`, `"rel.remove": "Remove dependency"`, `"rel.type.blocks": "Blocks"`, `"rel.type.supports": "Supports"`, `"rel.type.parallel": "Parallel"`, `"rel.type.unrelated": "Unrelated"`, `"rel.type.needs_verification": "Needs verification"`, `"rel.blocked_by_this": "blocked by this"`, `"rel.blocks_this": "blocks this"`. he: `"rel.title": "תלויות"`, `"rel.add": "הוספת תלות"`, `"rel.reason": "סיבה"`, `"rel.remove": "הסרת תלות"`, `"rel.type.blocks": "חוסם"`, `"rel.type.supports": "תומך"`, `"rel.type.parallel": "מקביל"`, `"rel.type.unrelated": "לא קשור"`, `"rel.type.needs_verification": "דורש אימות"`, `"rel.blocked_by_this": "נחסם על ידי זה"`, `"rel.blocks_this": "חוסם את זה"`.

- [ ] **Step 1:** Actions. **Step 2:** `RelationEditor`. **Step 3:** Wire `WorkRow` + both pages. **Step 4:** `npm run check` green; dev round-trip: add a blocks relation → `unlocks 1` appears on the blocker task in Portfolio top actions. Stage.

---

### Task 5: Portfolio restructure (`app/(dash)/page.tsx`)

**Files:**
- Create: `components/portfolio/project-accordion.tsx`
- Modify: `app/(dash)/page.tsx`, `lib/queries.ts`, `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- Page becomes understand-only (BUILD_SPEC §2). Order: (1) plan banner → `/work` (open count); (2) inbox banner → `/inbox` when pending > 0; (3) `portfolio.map` heading + project accordions; (4) existing `WhatsStuck`, legacy `ProjectRails` (kept until Noa signs off the accordions — removed at Sprint D checkpoint), `DecisionsWeek`, `CompareCharts`. `TopActions` and `TasksSection` imports removed (files remain).
- `getOverviewData` additions (same `Promise.all`): `pendingProposals: number` (head count on `agent_proposals` state=pending); `phases` rows; `workstreams` rows; returned `portfolio: { project: Project; currentPhaseLabel: string | null; workstreams: Workstream[]; mainBlocker: Blocker | null; nextAction: Action | null }[]` — `mainBlocker` = project's active blocker with max `days_stuck`; `nextAction` = highest-score entry of the computed `actions` for that project; `currentPhaseLabel` = phase label for `project.current_phase_key`.
- `ProjectAccordion` ('use client', `useState(open)`, first project defaults open): header = name (`Link` to `/projects/[id]`), `city_case` mono chip, phase pill (`bg-sage text-white`), workstream chips (`bg-mist-soft text-mist`), risk/on-hold pill (reuse `city_on_hold` + `labels.onHold`); body rows: `labels.next` → nextAction title; `labels.blocker` → `mainBlocker.what · mainBlocker.blocked_by`; footer `Link` `labels.investigate + ' →'`.
- i18n en: `"portfolio.open_plan": "Open today's plan"`, `"portfolio.open_plan_sub": "{n} open items, ranked by impact and timing"`, `"portfolio.review_pending": "{n} agent suggestions await review"`, `"portfolio.next": "What must happen next"`, `"portfolio.blocker": "Main blocker"`, `"portfolio.investigate": "Investigate project"`, `"portfolio.map": "Where everything stands"`. he: `"portfolio.open_plan": "פתיחת תוכנית היום"`, `"portfolio.open_plan_sub": "{n} פריטים פתוחים, מדורגים לפי השפעה ותזמון"`, `"portfolio.review_pending": "{n} הצעות סוכן ממתינות לאישור"`, `"portfolio.next": "מה חייב לקרות עכשיו"`, `"portfolio.blocker": "החסם המרכזי"`, `"portfolio.investigate": "חקירת הפרויקט"`, `"portfolio.map": "איפה הכול עומד"`.

- [ ] **Step 1:** Extend `getOverviewData`. **Step 2:** Build `ProjectAccordion`. **Step 3:** Rebuild page order. **Step 4:** `npm run check` + `npm run build` green; dev: accordion hierarchy matches demo (position → next → blocker → investigate). Stage.

---

### Task 6: Client design system — tokens + Geist

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`, `package.json` (add `geist`), `components/overview/tasks-section.tsx`

**Exact values (from `docs/client-handoff/SITEKICK_DESIGN_SYSTEM.md`):**
- `:root` light tokens become: `--bg: #FBFBF7` (Paper) · `--card: #FFFFFF` (Surface) · `--card2: #F4F4EE` · `--inset: #EFEFE9` · `--line: #DFE5DF` · `--line2: #E9EDE9` · `--ink: #16221F` · `--ink2: #71807B` (Muted) · `--ink3: #8B9792` · `--sage: #316C5B` (Primary Green) · `--sage-soft: #DCEBE4` (Soft Green) · `--sage-line: #BCD8CB` · `--mist: #416B84` (External-waiting Blue) · `--mist-soft: #EAF2F7` (Soft Blue) · `--apricot: #A96725` (Amber) · `--apricot-soft: #FFF3DE` (Soft Amber) · `--coral: #A3483F` (Blocking Red) · `--coral-soft: #FBE8E5` (Soft Red) · `--moss: #2F7A5E` · `--moss-soft: #DFF0E7` · `--chart1: #416B84` · `--chart2: #A96725` · new `--deep: #172923` (Deep Surface) · new `--gold: #D9B578` (Insight Gold). Add `@theme inline` lines `--color-deep: var(--deep); --color-gold: var(--gold);`.
- `[data-theme="dark"]`: keep block structure; retune to the same semantic hues (spec defines light only — dark derives): `--bg: #141C19` · `--card: #1C2622` · `--card2: #212C27` · `--inset: #18211D` · `--line: #32403A` · `--line2: #283530` · `--ink: #E7ECEA` · `--ink2: #A4B0AB` · `--ink3: #7C8883` · `--sage: #7FB8A2` · `--sage-soft: #23372F` · `--sage-line: #3A5648` · `--mist: #8FB4CC` · `--mist-soft: #22333F` · `--apricot: #D9A05B` · `--apricot-soft: #3B2F1F` · `--coral: #D98E83` · `--coral-soft: #402A27` · `--moss: #7FBB9B` · `--moss-soft: #24382E` · `--chart1: #6E9EC0` · `--chart2: #C08A4A` · `--deep: #172923` · `--gold: #D9B578`.
- Fonts: `npm i geist`; `app/layout.tsx`: `import { GeistSans } from 'geist/font/sans'; import { GeistMono } from 'geist/font/mono';` → `<html … className={`${GeistSans.variable} ${GeistMono.variable}`}>`; `globals.css` `@theme inline`: `--font-sans: var(--font-geist-sans), system-ui, sans-serif;` `--font-serif: var(--font-geist-sans), system-ui, sans-serif;` `--font-mono: var(--font-geist-mono), ui-monospace, monospace;` (spec: ONE family — existing `font-serif` headings collapse into Geist without touching components). Add heading utility override at the end of globals.css: `.font-serif { font-weight: 650; letter-spacing: -0.025em; }`.
- Semantic red audit (spec: red = verified blocker ONLY): `components/overview/tasks-section.tsx` critical-row tint `bg-coral-soft/40` → `bg-apricot-soft/50` (critical priority = attention, not a verified blocker). Coral stays on: blocker chips (`action-row.tsx` ⚠, `whats-stuck.tsx`), error/save-failure states, `rel.type.blocks` chips.

- [ ] **Step 1:** `npm i geist`. **Step 2:** Token swap (both themes). **Step 3:** Font wiring + weight override. **Step 4:** Red audit edit. **Step 5:** `npm run check` + build; dev both themes: body contrast (ink on bg) reads AA, waiting chips blue, critical rows amber; screenshot light + dark for Dor. Stage.

---

### Task 7: Checkpoint

- [ ] `npm run check` + `npm run build` green.
- [ ] Acceptance: `blocks` can only enter via inbox accept or manual editor (never straight from co-occurrence); ranked items show why + unlocks; Portfolio understand-only with acting in `/work`; red restricted to verified blockers + errors; Geist active (inspect computed font-family).
- [ ] `git add -A`, report to Dor for `/commit-push`.

## Self-Review Notes

- `alter type … add value` isolated at the end of 0004 with a documented split fallback (Task 1 Step 2).
- `ActionWhy.unlocks` optional → old digest jsonb rows render fine.
- Type consistency: `RelationshipType` union = SQL enum = `rel.type.*` keys; `topActions` optional param keeps `agents/daily-digest.ts` compiling at every intermediate step; `unlocksN` added to BOTH label types (action-row `Labels`, top-actions `rowLabels`).
