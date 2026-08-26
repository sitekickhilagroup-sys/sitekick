# QA Fix Work Plan — every page, every failure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every failure found in the two QA documents — Dor's My Work results (23 FAIL / 2 PENDING of 62) and Rotem's 4-page checklist (Project Process, Data Inbox, Invoices, Weekly Review) — page by page, with audited/undoable writes and no invented data.

**Architecture:** Three kinds of work, kept separate: (1) code fixes in Next.js 15 App Router pages + server actions, reusing the existing `activity_log` + `before_json` undo pattern; (2) one shared Task Details editor used by both My Work and Project Process; (3) data-repair passes on Supabase rows (never delete — merge/flag `Verify`), run only after the tooling that makes them auditable exists.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (service-role via `supabaseAdmin`), Tailwind, vitest, i18n via `lib/i18n/{en,he}.json`.

**Spec:**
- `../../../SiteKick_QA_Final_For_Rotem.html` (Rotem checklist — 4 pages, PAGES data)
- `../../../SiteKick_My_Work_QA_For_Dor.html` (Dor results — item numbers #1–#62 cited below)
- `docs/superpowers/plans/2026-08-24-noa-corrections-analysis.md` (root-cause analysis; D1–D14 data table)

## Global Constraints

- **Never hard-delete** rows. Duplicates → merge into a Master Action (0010 pattern) or flag; uncertain rows → `Verify`, Noa adjudicates.
- **Every material write is audited and undoable**: `logActivity(admin, { …, before })` → `undoId`; undo restores from `before_json` (pattern: `app/actions/work.ts`).
- **Test records only** when a check would mutate real data; otherwise get approval first (both QA docs' "known" sections).
- **i18n parity**: every new label lands in BOTH `lib/i18n/en.json` and `lib/i18n/he.json` (`parity.test.ts` enforces).
- **RTL-safe**: logical properties (`start/end`, `ms-/me-`), `rtl:-scale-x-100` for direction arrows — as the codebase already does.
- **No fabricated UI states**: no fake progress bars (the upload API is a single POST — text status only, as `dropzone.tsx` documents).
- **Commits**: suggested messages are given per task; Dor reviews and commits via `/commit-push` (no auto-commit — global rule).
- Dev server for verification via the Browser pane (`preview_start`), routes `/work`, `/projects`, `/upload`, `/invoices`, `/weekly`.

## Traceability — QA item → task

| QA source | Items | Task |
|---|---|---|
| Dor #12 | Blocking count 31 vs 24 | A1 |
| Dor #27 | Missing Open Payment Summary link | A2 |
| Dor #47 | "Nothing is duplicated" shown while dupes exist | A3 |
| Dor #54 | Note invisible after refresh; due not on card | A4 |
| Dor #15–20 | Today ranking ≠ business priority | A5 |
| Dor #51, #52 | Update lacks Owner/Waiting/Project/Phase/Sub-stage/Workstream | A6 |
| Dor #56 | Task change absent from Weekly Review | A7 |
| Dor #31, #34, #38–45; #33 (pending) | General misassignment + 11 dup groups + free-text owners | B1 |
| Dor #29 (pending) | Payment Run totals vs Invoices | E7 (verify after) |
| Rotem process: refresh keeps selection | | C1 |
| Rotem process: actions per sub-stage, ≤4 + View all, View register → right record | | C2 |
| Rotem process: history/Undo for update | | C3 |
| Rotem process: Update incl. Impact on process + Project/Phase/Sub-stage/Workstream | | A6 + C4 |
| Rotem process: remaining visual/behavior items | | C5 (walk) |
| Rotem weekly: Finalize/Reopen separate from Save | | D1 |
| Rotem weekly: edit Owner/Due/Next step | | D2 |
| Rotem weekly: counter scope, carry rules, upload details, suggestions approval | | D3–D6 |
| Rotem invoices: stale filter → "No matches" in Payment Summary | | E1 |
| Rotem invoices: full edit form | | E2 |
| Rotem invoices: Paid ⇄ Payment date rules | | E3 |
| Rotem invoices: Add Invoice + dup check | | E4 |
| Rotem invoices: history/Undo | | E5 |
| Rotem invoices: reconciliation summary (Source/System/Added/Changed/Dups/Orphans) | | E6 |
| Rotem invoices: data facts (Thang Le ×1 → Rinconia; AVALON Jul 29; SNO → Verify; counts vs 97) | | E7 |
| Rotem inbox: full page | | F1 (walk + fixes) |
| Both docs, all pages: final re-test | | G1 |

**Ordering:** A-tasks are independent of each other except A6 before C4. B1 before B2 (weekly regen) and before re-testing #31–45. E7's vendor merge (D6) before Thang Le merge (D4). C/D/E/F phases can run in any order after A.

---

## Phase A — My Work: the 23 fails with verified root causes

### Task A1: Blocking card count = what the list shows

**Files:**
- Modify: `app/(dash)/(standard)/work/page.tsx` (`countOf`, ~line 218)
- Modify: `lib/i18n/en.json`, `lib/i18n/he.json`

**Root cause (verified):** `countOf('blocking')` returns `critical tasks + blockers.length` (24 + 7 = 31), but the list renders 24 task rows plus 7 visually different blocker cards — Dor counted 24.

**Interfaces:** none new — display-only change.

- [ ] **Step 1:** In `work/page.tsx`, make the card count tasks only, and say the split in the tab strip:

```ts
const countOf = (v: WorkView) => filterView(tasks, v, today).length;
const blockingBreakdown = view === 'blocking'
  ? t('work.blocking_breakdown')
      .replace('{tasks}', String(countOf('blocking')))
      .replace('{blockers}', String(blockers.length))
  : null;
```

Render `blockingBreakdown` inside the `.register-context` strip (the `activeTab` block) when non-null, in place of the generic sub.

- [ ] **Step 2:** Add labels — en: `"work.blocking_breakdown": "{tasks} blocking tasks · {blockers} live blockers"`; he: `"work.blocking_breakdown": "{tasks} משימות חוסמות · {blockers} חסמים פעילים"`.
- [ ] **Step 3:** `npx vitest run lib/i18n/parity.test.ts` → PASS.
- [ ] **Step 4:** Browser: `/work?view=blocking` — card number equals task-row count; strip explains the blocker cards.
- [ ] **Step 5:** Suggested commit: `fix(work): blocking card counts tasks only, breakdown names the blockers`

### Task A2: Payment Run → "Open Payment Summary" link

**Files:**
- Modify: `app/(dash)/(standard)/work/page.tsx` (Payment Run `<details>` footer, next to the existing `work.open_invoices` link)
- Modify: `lib/i18n/en.json`, `lib/i18n/he.json`

**Root cause (verified):** only `Open all invoices` exists; Dor #27.

- [ ] **Step 1:** Beside the existing footer link add:

```tsx
<Link href="/invoices?tab=payment_summary" className="inline-flex min-h-11 items-center px-1 text-xs text-mist hover:underline sm:min-h-0">
  {t('work.open_payment_summary')} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
</Link>
```

- [ ] **Step 2:** Labels — en: `"work.open_payment_summary": "Open Payment Summary"`; he: `"work.open_payment_summary": "פתח Payment Summary"`.
- [ ] **Step 3:** Browser: link opens `/invoices` with the Payment Summary tab active (tab param verified in code: `sp.tab`, key `payment_summary`).
- [ ] **Step 4:** Suggested commit: `feat(work): Payment Run links to the Payment Summary tab`

### Task A3: honest duplicate line instead of static "Nothing is duplicated"

**Files:**
- Modify: `app/(dash)/(standard)/work/page.tsx`
- Modify: `lib/i18n/en.json` (key `work.sub`, line ~249), `lib/i18n/he.json`
- Modify: `lib/dedup.ts`; Test: `lib/dedup.test.ts` (extend)

**Root cause (verified):** `work.sub` is unconditional header copy; Dor #47 saw it above real duplicates.

- [ ] **Step 1:** Failing test in `lib/dedup.test.ts`: two tasks, `"Hold Letter Corrections"` with `project_id: 'san-marco'` and the same title with `project_id: null` → `findDuplicatePairs` returns 1 pair; two unrelated titles → 0. Run: `npx vitest run lib/dedup.test.ts` → FAIL (function missing).
- [ ] **Step 2:** Implement in `lib/dedup.ts`:

```ts
/** Pairs of open tasks that look like the same work (General twin ↔ project row). */
export function findDuplicatePairs(open: Task[]): Array<[Task, Task]> {
  const pairs: Array<[Task, Task]> = [];
  for (let i = 0; i < open.length; i++) {
    const match = matchExistingTask(
      { title: open[i].title, project_id: open[i].project_id, stage_key: open[i].stage_key },
      open.slice(i + 1),
    );
    if (match) pairs.push([open[i], match]);
  }
  return pairs;
}
```

Run again → PASS.

- [ ] **Step 3:** In `work/page.tsx` compute `const dupPairs = findDuplicatePairs(tasks);`. Render under the header: if `dupPairs.length > 0`, an amber banner linking to `/work?view=all` with `t('work.dup_warning').replace('{n}', …)`; otherwise append the calm claim. Change `work.sub` to drop the claim (en: `"One task record, shown through the view that helps you act."`), add `"work.sub_clean": "Nothing is duplicated."` (he: `"אין כפילויות."`) shown only when `dupPairs.length === 0`, and `"work.dup_warning": "{n} possible duplicate pairs — review before trusting counts"` (he: `"‏{n} זוגות כפילות אפשריים — לבדוק לפני שסומכים על המספרים"`).
- [ ] **Step 4:** Browser: with current (dirty) data the banner shows; after B1 cleanup it disappears.
- [ ] **Step 5:** Suggested commit: `fix(work): duplicate claim is computed, not asserted`

### Task A4: notes survive refresh and show on the row

**Files:**
- Create: `supabase/migrations/0015_task_details.sql` (shared with A5/A6 — written once here)
- Modify: `lib/work-verbs.ts`; Test: `lib/work-verbs.test.ts`
- Modify: `lib/types.ts` (Task), `components/work/work-table-row.tsx`, `app/actions/work.ts` (undo whitelist)

**Root cause (verified):** `verbToPatch('note')` patches only `last_touched`; the text lives solely in the audit row, so after refresh nothing on the card shows it (Dor #54). `delayed`/`scheduled` DO patch `due`; the card shows `task.due` in the Due column — keep, verify in Step 5.

- [ ] **Step 1:** Write migration `0015_task_details.sql`:

```sql
-- 0015: fields the QA round showed are missing.
alter table tasks add column if not exists latest_note text;
alter table tasks add column if not exists substage_template_id uuid references substage_templates(id);
alter table tasks add column if not exists workstream_id uuid references workstreams(id);
alter table projects add column if not exists business_rank int;
comment on column projects.business_rank is 'Noa''s standing priority: 1=Blair, 2=San Marco, 3=Rinconia, 4=Alta Mesa. Null = unranked (General last).';
update projects set business_rank = 1 where name ilike '%blair%';
update projects set business_rank = 2 where name ilike '%san marco%';
update projects set business_rank = 3 where name ilike '%rinconia%';
update projects set business_rank = 4 where name ilike '%alta mesa%';
```

(Before applying: confirm the two FK table names against `0012_process_library.sql` / `0003_process_model.sql`; adjust if the template/workstream tables are named differently.)

- [ ] **Step 2:** Failing test in `lib/work-verbs.test.ts`: `verbToPatch('note', 'called the city', today)` → patch contains `latest_note: 'called the city'`. Run → FAIL.
- [ ] **Step 3:** Implement in `lib/work-verbs.ts`:

```ts
case 'note':
  if (!text) return { error: 'input required' };
  return { patch: { latest_note: text, ...base }, action };
```

Run → PASS.

- [ ] **Step 4:** Render in `work-table-row.tsx` under the title (before the meta line):

```tsx
{task.latest_note && (
  <span className="mt-0.5 block text-[10px] leading-[1.4] text-sk-muted">“{task.latest_note}”</span>
)}
```

Add `latest_note`, `substage_template_id`, `workstream_id` to `Task` in `lib/types.ts`; add `latest_note` to the restore whitelist in `undoWorkVerb` (`app/actions/work.ts`, the `for (const k of [...])` list).

- [ ] **Step 5:** Browser: add a note → visible on the row → refresh → still visible → Undo → gone. Set `delayed` with a date → Due column shows it after refresh.
- [ ] **Step 6:** Suggested commit: `fix(work): notes persist to the task and render on the row`

### Task A5: Today ranking follows the approved business order

**Files:**
- Modify: `lib/priority.ts`; Test: `lib/priority.test.ts`
- Modify: `app/(dash)/(standard)/work/page.tsx` (today branch + group order + whyNow), `lib/types.ts` (Project.business_rank)
- Uses: `projects.business_rank` from 0015 (Task A4)

**Root cause (verified):** the Today sort is `scoreTask(t, { today })` — no `currentStageKey` passed, `process_impact` never weighed, no notion of Blair > San Marco > Rinconia > Alta Mesa. Finance/admin rows outrank stage blockers (Dor #15–20). Expected result (Dor's notes): slots 1-2 Blair, 3-4 San Marco, 5-6 Rinconia, 7-8 Alta Mesa — top-2 per project in business order, exceptions only for `manual_priority` and hard due dates, each with a visible reason.

**Interfaces:**
- Produces: `rankToday(tasks: Task[], ctx: TodayRankContext): Task[]`, `IMPACT_WEIGHT: Record<NonNullable<Task['process_impact']>, number>` — consumed by `work/page.tsx`.

- [ ] **Step 1:** Failing tests in `lib/priority.test.ts`:

```ts
import { rankToday } from './priority.ts';

const P = { blair: 'p1', sanMarco: 'p2', rinconia: 'p3', altaMesa: 'p4' };
const ranks = new Map([[P.blair, 1], [P.sanMarco, 2], [P.rinconia, 3], [P.altaMesa, 4]]);
const mk = (over: Partial<Task> & { id: string }): Task => ({
  project_id: null, document_id: null, title: 'x', description: null, owner: null,
  waiting_for: null, due: null, stage_key: null, priority: 'normal', status: 'open',
  planned: false, follow_up_date: null, check_back_on: null, source: null,
  last_touched: '2026-08-26', created_at: '', manual_priority: null, snoozed_until: null,
  process_impact: null, merged_into: null, merged_at: null, merged_by: null,
  latest_note: null, substage_template_id: null, workstream_id: null, ...over,
});

test('today: two per project in business order; blockers beat finance rows', () => {
  const tasks = [
    mk({ id: 'fin', title: 'Construction Financing', project_id: P.blair, process_impact: 'not_blocking' }),
    mk({ id: 'b1', project_id: P.blair, process_impact: 'primary_blocker' }),
    mk({ id: 'b2', project_id: P.blair, process_impact: 'workstream_blocker' }),
    mk({ id: 's1', project_id: P.sanMarco, process_impact: 'primary_blocker' }),
    mk({ id: 's2', project_id: P.sanMarco, process_impact: 'external_gate' }),
    mk({ id: 'r1', project_id: P.rinconia, process_impact: 'primary_blocker' }),
    mk({ id: 'r2', project_id: P.rinconia, process_impact: 'workstream_blocker' }),
    mk({ id: 'a1', project_id: P.altaMesa, process_impact: 'primary_blocker' }),
    mk({ id: 'a2', project_id: P.altaMesa, process_impact: 'workstream_blocker' }),
    mk({ id: 'gen', title: 'General admin' }),
  ];
  const out = rankToday(tasks, { today: '2026-08-26', businessRankByProject: ranks });
  expect(out.map((t) => t.id)).toEqual(['b1', 'b2', 's1', 's2', 'r1', 'r2', 'a1', 'a2']);
});

test('today: manual_priority overrides everything, in its own order', () => {
  const tasks = [
    mk({ id: 'b1', project_id: P.blair, process_impact: 'primary_blocker' }),
    mk({ id: 'noa', project_id: P.altaMesa, manual_priority: 1 }),
  ];
  const out = rankToday(tasks, { today: '2026-08-26', businessRankByProject: ranks });
  expect(out[0].id).toBe('noa');
});

test('today: overdue commitment may jump a non-primary sibling inside its project', () => {
  const tasks = [
    mk({ id: 'b1', project_id: P.blair, process_impact: 'workstream_blocker' }),
    mk({ id: 'late', project_id: P.blair, process_impact: 'not_blocking', due: '2026-08-01' }),
  ];
  const out = rankToday(tasks, { today: '2026-08-26', businessRankByProject: ranks });
  expect(out[0].id).toBe('late'); // the "documented reason" case
});
```

Run `npx vitest run lib/priority.test.ts` → FAIL (`rankToday` missing).

- [ ] **Step 2:** Implement in `lib/priority.ts`:

```ts
/** 0013 impact, weighed for ranking. A Blocking tag alone must not decide. */
export const IMPACT_WEIGHT: Record<NonNullable<Task['process_impact']>, number> = {
  primary_blocker: 60, workstream_blocker: 45, external_gate: 18,
  verify: 10, future_gate: 6, not_blocking: 0,
};

export interface TodayRankContext {
  today: string;
  businessRankByProject: Map<string, number>; // projects.business_rank
  currentStageByProject?: Map<string, string | null>;
  limit?: number; // default 8
}

function todayScore(t: Task, ctx: TodayRankContext): number {
  let s = scoreTask(t, {
    today: ctx.today,
    currentStageKey: t.project_id ? ctx.currentStageByProject?.get(t.project_id) ?? null : null,
  });
  if (t.process_impact) s += IMPACT_WEIGHT[t.process_impact];
  if (t.due && t.due < ctx.today) s += 15; // a dated commitment already missed
  return s;
}

/**
 * Noa's Today: manual priorities first (her explicit order), then the top-2 of
 * each project walking business_rank 1→4, then best-of-the-rest to fill.
 * Inside a project, impact + due decide — an overdue commitment can jump a
 * sibling, which is exactly the "documented reason" the QA allows.
 */
export function rankToday(tasks: Task[], ctx: TodayRankContext): Task[] {
  const limit = ctx.limit ?? 8;
  const eligible = tasks.filter((t) => !t.snoozed_until || t.snoozed_until <= ctx.today);
  const manual = eligible.filter((t) => t.manual_priority != null)
    .sort((a, b) => a.manual_priority! - b.manual_priority!);
  const rest = eligible.filter((t) => t.manual_priority == null);

  const byProject = new Map<string, Task[]>();
  for (const t of rest) {
    if (!t.project_id) continue;
    const list = byProject.get(t.project_id);
    if (list) list.push(t); else byProject.set(t.project_id, [t]);
  }
  const projectOrder = [...byProject.keys()].sort((a, b) =>
    (ctx.businessRankByProject.get(a) ?? 99) - (ctx.businessRankByProject.get(b) ?? 99));

  const picked: Task[] = [...manual];
  const taken = new Set(picked.map((t) => t.id));
  for (const pid of projectOrder) {
    if (picked.length >= limit) break;
    const top2 = byProject.get(pid)!
      .filter((t) => !taken.has(t.id))
      .sort((a, b) => todayScore(b, ctx) - todayScore(a, ctx))
      .slice(0, 2);
    for (const t of top2) { picked.push(t); taken.add(t.id); }
  }
  if (picked.length < limit) {
    const fill = rest.filter((t) => !taken.has(t.id))
      .sort((a, b) => todayScore(b, ctx) - todayScore(a, ctx));
    picked.push(...fill.slice(0, limit - picked.length));
  }
  return picked.slice(0, limit);
}
```

Run tests → PASS (tune the +15 overdue bump only if the third test demands; tests are the contract).

- [ ] **Step 3:** In `work/page.tsx`: today branch of `filterView` → call `rankToday(tasks, { today, businessRankByProject, currentStageByProject })` (move the today case out of `filterView` into the page, or pass ctx through). `businessRankByProject` = `new Map(projects.filter((p) => p.business_rank != null).map((p) => [p.id, p.business_rank!]))`; `currentStageByProject` from `project_stages` rows as `topActions` derives them (add that query to the batch if not present). On the today view, order the project groups by business rank asc (General last) instead of max-score. Add `business_rank: number | null` to `Project` in `lib/types.ts`.
- [ ] **Step 4:** Extend `whyNowFor` to open with the impact label when set — `t('work.why.impact.' + task.process_impact)`; six label pairs in both locales (Primary Blocker/חוסם ראשי, Workstream Blocker/חוסם מסלול, Future Gate/שער עתידי, External Gate/שער חיצוני, Not Blocking/לא חוסם, Verify/לאימות). This is the checklist's "documented reason".
- [ ] **Step 5:** `npx vitest run` → PASS; `npm run build` → clean.
- [ ] **Step 6:** Browser `/work` (Today): Blair first, then San Marco, Rinconia, Alta Mesa; finance/admin rows below stage blockers; Why-now names the impact.
- [ ] **Step 7:** Suggested commit: `feat(work): Today ranks by business priority + process impact, two per project`

### Task A6: full "Edit details" on any task (Owner, Waiting, Due, Project, Phase, Sub-stage, Workstream, Impact)

**Files:**
- Create: `components/work/task-editor.tsx`
- Modify: `app/actions/tasks.ts` (new `updateTaskDetails`), `app/actions/work.ts` (undo whitelist)
- Modify: `components/work/verb-menu.tsx` (8th item opens the editor), `components/work/work-table-row.tsx`, `app/(dash)/(standard)/work/page.tsx` (option lists)
- Modify: `lib/i18n/en.json`, `lib/i18n/he.json`

**Root cause (verified):** VerbMenu offers 7 verbs only (Dor #51/#52); the process page has the same gap (Rotem: editable Project/Phase/Sub-stage/Workstream + a separate Impact-on-process field).

**Interfaces:**
- Produces: `updateTaskDetails(taskId: string, patch: TaskDetailsPatch): Promise<{ok: true; undoId: string | null} | {error: string}>`

```ts
export interface TaskDetailsPatch {
  owner?: string | null; waiting_for?: string | null; due?: string | null;
  project_id?: string | null; stage_key?: string | null;
  substage_template_id?: string | null; workstream_id?: string | null;
  process_impact?: Task['process_impact'];
}
```

- Produces: `<TaskEditor task options labels />` client component — reused by C4.
- Consumes: 0015 columns (Task A4).

- [ ] **Step 1:** Server action in `app/actions/tasks.ts`, mirroring `applyWorkVerb`'s audit shape:

```ts
const DETAIL_KEYS = ['owner', 'waiting_for', 'due', 'project_id', 'stage_key',
  'substage_template_id', 'workstream_id', 'process_impact'] as const;

export async function updateTaskDetails(taskId: string, patch: TaskDetailsPatch) {
  const user = await requireUser();
  const clean: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) if (k in patch) clean[k] = (patch as Record<string, unknown>)[k] ?? null;
  if (clean.due != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(clean.due))) return { error: 'invalid date' };
  if (Object.keys(clean).length === 0) return { error: 'empty patch' };
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (!before) return { error: 'task not found' };
  const { error } = await admin.from('tasks').update({ ...clean, last_touched: laToday() }).eq('id', taskId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'task', entity_id: taskId, actor: user.email ?? user.id,
    action: 'edit:details', before, after: clean,
  });
  revalidatePath('/'); revalidatePath('/work'); revalidatePath('/weekly'); revalidatePath('/projects/[id]', 'page');
  return { ok: true as const, undoId };
}
```

Undo: extend `undoWorkVerb`'s restore whitelist with all `DETAIL_KEYS` (its `before_json` already carries the full row).

- [ ] **Step 2:** `TaskEditor`: bottom-sheet/popover form (same responsive pattern as VerbMenu's menu) with Owner `<input>`, Waiting on `<input>`, Due `<input type="date">`, Project `<select>` (active projects + General=null), Phase `<select>` (5 phases), Sub-stage `<select>` (templates filtered by the chosen phase), Workstream `<select>` (project's workstreams; empty = none), Impact on process `<select>` with exactly Primary Blocker / Workstream Blocker / Future Gate / External Gate / Not Blocking / Verify (values = the `ProcessImpact` union). Save → `updateTaskDetails` → the existing "Recorded · Undo" chip — lift VerbMenu's result chip into a shared `<SavedChip message undoId onUndo labels />` in `components/work/saved-chip.tsx` and use it in both.
- [ ] **Step 3:** VerbMenu: 8th menu item `labels.editDetails` opens TaskEditor (props passed down from the row). `work/page.tsx` supplies `substageOptions` (query `substage_templates` id+phase_key+name — add to the parallel batch), `workstreamOptions` (query `workstreams` id+project_id+name), `phaseOptions` (from `phasesQ`), `projectOptions` (already loaded for AddAction).
- [ ] **Step 4:** Labels both locales: `work.edit_details` ("Edit details…" / "עריכת פרטים…"), `work.impact` ("Impact on process" / "השפעה על התהליך"), six impact values (reuse A5 Step 4's keys), `work.substage` ("Sub-stage" / "תת־שלב"), `work.workstream` ("Workstream" / "מסלול עבודה"). `npx vitest run lib/i18n/parity.test.ts` → PASS.
- [ ] **Step 5:** Browser: on a QA test task — change Owner + Project + Impact → save → refresh → persisted; Undo → restored; the change shows on `/projects/<id>` (revalidated).
- [ ] **Step 6:** Suggested commit: `feat(tasks): full details editor — owner, dates, project, phase, sub-stage, workstream, impact`

### Task A7: task writes flow into the open Weekly Review

**Files:**
- Modify: `app/actions/weekly.ts` (new `syncTaskIntoOpenReview` helper) — called from `app/actions/work.ts` (`applyWorkVerb`), `app/actions/tasks.ts` (`updateTaskDetails`, AddAction's create)
- Test: `lib/weekly.test.ts` (pure slice)

**Root cause (verified):** weekly items materialize only at prepare time (`lib/weekly.ts` builds from `openTasks` once); a task created/updated afterwards never joins (Dor #56 — the Blair QA task showed in Project Process but not in Weekly).

**Interfaces:**
- Produces: `syncTaskIntoOpenReview(admin, taskId): Promise<void>` — idempotent; no-op when no `status='preparing'` review exists.

- [ ] **Step 1:** BEFORE coding, read the prepare flow's insert in `app/actions/weekly.ts` and copy its exact snapshot column set (title/project/owner snapshots per 0005), so synced items are indistinguishable from prepared ones. Then implement:

```ts
export async function syncTaskIntoOpenReview(admin: SupabaseClient, taskId: string) {
  const { data: review } = await admin.from('weekly_reviews')
    .select('id').eq('status', 'preparing')
    .order('week_start', { ascending: false }).limit(1).maybeSingle();
  if (!review) return;
  const { data: existing } = await admin.from('weekly_review_items')
    .select('id').eq('review_id', review.id).eq('task_id', taskId).maybeSingle();
  if (existing) return;
  const { data: task } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (!task || task.status !== 'open') return;
  await admin.from('weekly_review_items').insert({
    review_id: review.id, task_id: taskId, status_snapshot: 'open',
    /* + the snapshot columns copied from prepare */
  });
}
```

- [ ] **Step 2:** `await` it at the end of the success paths of `applyWorkVerb`, `updateTaskDetails`, and the AddAction create action (wrap in try/catch — a weekly failure must not fail the primary write; log it).
- [ ] **Step 3:** If a mapper is extracted (task → snapshot row), unit-test it in `lib/weekly.test.ts`; the DB behavior is verified in browser.
- [ ] **Step 4:** Browser: with a draft review open, create a QA task on `/work` under Blair → `/weekly` shows it under Blair without re-preparing.
- [ ] **Step 5:** Suggested commit: `fix(weekly): new and edited tasks join the open review immediately`

---

## Phase B — Data repair (My Work truth)

### Task B1: General → real projects; merge the 11 duplicate groups; normalize Owner/Waiting

**Files:**
- Create: `scripts/audit-task-assignment.ts` (run: `npx tsx scripts/audit-task-assignment.ts`, service-role env from `.env.local`)
- Uses: the Master-Action merge (0010, `app/actions/tasks.ts`) and the same audited update shape as A6
- Reference: the 11 named groups in `docs/superpowers/plans/2026-08-24-noa-corrections-analysis.md` (San Marco ×9, Flicker ×2) + Rinconia rows under General

**Rules (both QA docs):** merge, never delete; ambiguous → leave + flag for Noa; every change writes `activity_log` with `before` so Undo exists.

- [ ] **Step 1:** Script phase 1 — REPORT ONLY. For every open task with `project_id is null`: propose a project via (a) the analysis doc's named list, (b) `matchExistingTask` against project-assigned tasks, (c) title keyword (San Marco / Rinconia / Flicker / Blair / Alta Mesa). Output `scratch/task-assignment-proposals.csv`: `task_id,title,proposal,rule,dup_of_task_id`. Also list distinct `owner` / `waiting_for` spellings with counts, as the normalization map draft.
- [ ] **Step 2:** Dor reviews the CSV (ambiguous rows go to Noa). Only approved rows continue.
- [ ] **Step 3:** Script phase 2 — APPLY approved rows: misassignment → update `project_id` + `logActivity('edit:details', before)`; General-twin duplicate → merge the General row INTO the project row via the Master-Action path (`status='merged'`, `merged_into`), never the reverse; Owner/Waiting → apply the approved spelling map the same audited way.
- [ ] **Step 4:** Verify in browser: General holds only true general rows (#31); Hold Letter Corrections + Retain Civil Engineer once each, under San Marco (#38/#39/#44); no Rinconia/Flicker rows under General (#40/#41/#42/#45); A3's banner reads 0 → clean line (#47); owners consistent (#43); no project claims "1 task today" without a task (#33).
- [ ] **Step 5:** Suggested commit (script only): `chore(data): task assignment audit + apply tooling (D1/D2)`

### Task B2: regenerate the weekly review after B1 (D13)

- [ ] **Step 1:** With Dor's explicit go-ahead (data-changing): re-run Prepare for the current week on `/weekly` so the item snapshot rebuilds without merged/reassigned ghosts. A7 keeps it current afterwards.
- [ ] **Step 2:** Verify: every project once, General separate and clean, per-sub-topic numbering continuous (Rotem weekly §2).
- [ ] **Step 3:** No commit (data action).

---

## Phase C — Project Process page (Rotem #process)

### Task C1: selection survives refresh (URL state)

**Files:**
- Modify: `components/process/process-explorer.tsx`

**Root cause (verified):** `selectedKey` / `selectedSubId` are `useState` — refresh resets to the current phase / first open sub-stage (checklist: refresh must not lose the selection).

- [ ] **Step 1:** Derive selection from the URL:

```tsx
const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
const urlPhase = params.get('phase');
const selectedKey = phases.some((p) => p.key === urlPhase) ? urlPhase! : current;
const urlSub = params.get('sub');
const setSel = (phase: string, sub: string | null) => {
  const q = new URLSearchParams(params.toString()); q.set('phase', phase);
  if (sub) q.set('sub', sub); else q.delete('sub');
  router.replace(`${pathname}?${q.toString()}`, { scroll: false });
};
```

`pickPhase(key)` → `setSel(key, firstOpenOf(key))`; sub-stage click → `setSel(selectedKey, template.id)`; `selectedSubId` = `urlSub ?? firstOpen?.template.id ?? null`. Remove the two `useState`s.

- [ ] **Step 2:** Browser: pick phase 4 + a sub-stage → hard refresh → same selection; project switcher still navigates cleanly.
- [ ] **Step 3:** Suggested commit: `fix(process): phase and sub-stage selection live in the URL`

### Task C2: connected actions belong to the sub-stage — ≤4 shown, View all, deep-linked register

**Files:**
- Modify: `components/process/process-explorer.tsx` (ExplorerTask + SubstageDetail), `app/(dash)/(standard)/projects/[id]/page.tsx` (populate the new field)
- Modify: `app/(dash)/(standard)/work/page.tsx`, `components/work/work-table-row.tsx` (highlight target row)
- Modify: `lib/i18n/en.json`, `lib/i18n/he.json`

**Root cause (verified):** SubstageDetail lists the whole phase's tasks; "View register" / "Open register" are generic `/work?view=all` — not the specific record; no cap / View-all.

- [ ] **Step 1:** Extend `ExplorerTask` with `substage_template_id: string | null` and populate it in the page query. In SubstageDetail:

```tsx
const mine = tasks.filter((t) => t.substage_template_id === template.id);
const phaseOnly = tasks.filter((t) => !t.substage_template_id);
const shown = mine.slice(0, 4);
```

Render `shown`; when `mine.length > 4` add a `View all ({mine.length})` link → `/work?view=all&substage=${template.id}`. When `mine.length === 0 && phaseOnly.length > 0`, keep today's phase-level list under a caption `labels.phaseLevel` ("Phase-level actions — not yet linked to a sub-stage" / "פעולות ברמת השלב — טרם שויכו לתת־שלב") so nothing disappears before A6/B1 backfill the links.

- [ ] **Step 2:** Per-task "Open register" → `/work?view=all&task=${task.id}#task-${task.id}`. In `work/page.tsx`: read `sp.task` + `sp.substage`; `substage` filters the all view (`filtered.filter((t) => t.substage_template_id === spSubstage)`); pass `highlight` to `WorkTableRow`, which sets `id={'task-' + task.id}` on its `<li>` and a `ring-2 ring-sage` class when highlighted.
- [ ] **Step 3:** Labels both locales (`process.view_all`: "View all ({n})" / "הצג הכול ({n})"; `process.phase_level` as above). Parity test → PASS.
- [ ] **Step 4:** Browser: a linked sub-stage shows only its own actions, capped at 4; View all lands filtered; Open register lands scrolled to the highlighted row.
- [ ] **Step 5:** Suggested commit: `feat(process): sub-stage-scoped actions with capped list and deep-linked register`

### Task C3: sub-stage status changes get Undo + history

**Files:**
- Modify: `app/actions/process.ts` (`setSubstageStatus` + new `undoSubstageChange`)
- Modify: `components/process/process-explorer.tsx` (SubstageDetail shows the SavedChip after a change)

- [ ] **Step 1:** Mirror `applyWorkVerb`: snapshot `before` from `project_substages`, update, `logActivity({ entity_type: 'project_substage', …, before })`, return `undoId`. `undoSubstageChange(logId)` restores `status` + `note` from `before_json` (accept only `entity_type === 'project_substage'`).
- [ ] **Step 2:** UI: after `setStatus` succeeds show A6's `SavedChip` with Undo.
- [ ] **Step 3:** Browser: flip a status → chip → Undo → previous status back; `activity_log` holds both rows.
- [ ] **Step 4:** Suggested commit: `feat(process): sub-stage status changes are audited and undoable`

### Task C4: full editor + Impact on the process page's action rows

**Files:**
- Modify: `components/process/process-explorer.tsx` (mini-task rows), `app/(dash)/(standard)/projects/[id]/page.tsx` (pass A6's option lists)

- [ ] **Step 1:** Alongside `VerbMenu`, mount A6's `TaskEditor` trigger on each mini-task with the same options (projects / phases / sub-stage templates / workstreams — add to this page's query batch what's missing). Covers Rotem: Update changes Status + Note ✓ (VerbMenu), Project/Phase/Sub-stage/Workstream editable, Impact on process as a separate field with all six values.
- [ ] **Step 2:** Browser: from a sub-stage action, change its Sub-stage → the row moves lists after refresh; an Impact set here shows in `/work` Why-now (A5) and in Weekly (A7).
- [ ] **Step 3:** Suggested commit: `feat(process): action rows get the full details editor`

### Task C5: process checklist walk — verify the rest, fix inline

- [ ] **Step 1:** Browser pass (desktop + tablet + mobile via `resize_window`) over the remaining Rotem #process items: Current Position card visible + correct incl. mobile; 5 phases one row ≥640px (`sm:grid-cols-5`); parallel note directly under the rail; active sub-stage light-green (`bg-sk-green-soft`), never inverted; sub-stage order + statuses match data; missing instance shows "Not activated" (logic exists — verify); long names wrap, no ellipsis; empty sub-stage shows its empty state with no stale panel data (`key={selectedSub.template.id}` remount — verify); switching projects swaps everything with no mixing; no horizontal page scroll; all controls tappable (min-h-11) on mobile.
- [ ] **Step 2:** Fix visual-level failures inline in `process-explorer.tsx` / `phase-column.tsx`; anything structural becomes its own follow-up task.
- [ ] **Step 3:** Suggested commit (if fixes): `fix(process): checklist walk corrections`

---

## Phase D — Weekly Review (Rotem #weekly)

### Task D1: Finalize / Reopen, separate from Save

**Files:**
- Create: `supabase/migrations/0016_weekly_finalize.sql`
- Modify: `app/actions/weekly.ts`, `components/weekly/review-board.tsx`, i18n both locales

- [ ] **Step 1:** Migration:

```sql
alter type weekly_review_status add value if not exists 'final';
alter table weekly_reviews add column if not exists finalized_at timestamptz;
alter table weekly_review_items add column if not exists next_step text;
```

(Postgres note: `alter type … add value` cannot run inside the same transaction that uses the value — keep this migration free of inserts using `'final'`.)

- [ ] **Step 2:** Actions `finalizeReview(reviewId)` / `reopenReview(reviewId)` — `status='final', finalized_at=now()` / back to `'preparing', finalized_at=null`; both audited (`entity_type: 'weekly_review'`).
- [ ] **Step 3:** UI: a secondary `Finalize` button beside Save (confirm inline: locks the record for the meeting; Reopen reverses); when final — item inputs disabled, badge "Finalized {date}", `Reopen` shown. Save never locks (checklist: Save keeps it a draft). Labels both locales.
- [ ] **Step 4:** A7's sync targets only `status='preparing'` — finalized reviews stay frozen. Verify `lib/weekly.ts` carry logic reads the prior review regardless of its status.
- [ ] **Step 5:** Browser: Save (editable) → Finalize (locked) → refresh (still locked) → Reopen (editable).
- [ ] **Step 6:** Suggested commit: `feat(weekly): finalize and reopen, distinct from saving the draft`

### Task D2: Next step field + Owner/Due editing on review items

**Files:**
- Uses: `weekly_review_items.next_step` from 0016 (D1)
- Modify: `components/weekly/review-board.tsx`, `app/actions/weekly.ts` (extend the item-save action), i18n

- [ ] **Step 1:** Item row gains a `Next step` textarea (mirrors the note pattern: `onBlur` save through the snapshot-save action extended to accept `next_step`, plus editable Owner input + Due date input in Sunday mode; Monday mode renders them read-only — the checklist's "אם הוגדרו לעריכה" allows Sunday-only editing; note the choice in a code comment).
- [ ] **Step 2:** Row reading order per checklist: Project > Sub-topic > Action > Owner > Status > Latest note > Next step > Due — place Next step after the note block.
- [ ] **Step 3:** Browser: edit all three on a test item → refresh → persisted; Monday mode clean.
- [ ] **Step 4:** Suggested commit: `feat(weekly): next-step field and inline owner/due editing`

### Task D3: completion counter scope — verify

- [ ] **Step 1:** `review-board.tsx:46-51` derives progress from `allItems` (this review only). Hand-count done/total against the UI. Correct → mark passed; wrong copy → fix the label only.
- [ ] **Step 2:** Commit only if changed.

### Task D4: upload card detail + in-flight lock

**Files:** `components/weekly/review-board.tsx` (upload card, ~lines 317-390)

- [ ] **Step 1:** Replace the two booleans with `lastFile: { name: string; at: string } | null` + keep the error flag; on success render `{name} · {date} · Processed`; on failure keep error + retry via the same input. Add `disabled={pending}` to the `<input type="file">` itself (the button already has it) so a double-pick during flight is impossible. Re-picking the same file re-fires (`e.target.value = ''` — already there; verify).
- [ ] **Step 2:** Visible copy lists exactly `.mp4, .txt, .docx` (matches `accept` — checklist: supported only if shown).
- [ ] **Step 3:** Browser: upload a small `.txt` twice fast → one document row; an oversized/wrong file → error + retry works.
- [ ] **Step 4:** Suggested commit: `fix(weekly): upload card shows file, date, status; input locked in flight`

### Task D5: transcript suggestions go through approval

- [ ] **Step 1:** Trace the pipeline: weekly upload → `/api/upload` → document row → does extraction emit `agent_proposals` for weekly content? Read `app/api/upload/route.ts` + `lib/ingest.ts` and answer definitively.
- [ ] **Step 2:** If proposals exist: banner on `/weekly` when pending proposals touch this review's tasks → link `/inbox` ("suggestions await approval before anything is applied"). If extraction does not run for weekly docs: honest v1 = a static line under the upload card — "Recordings are stored and linked; suggestions arrive in the Review Inbox before anything is applied" — and the pipeline becomes its own follow-up. Do NOT fake suggestions.
- [ ] **Step 3:** Suggested commit: `feat(weekly): transcript suggestions surface through the review inbox` (or the copy-only variant).

### Task D6: carry-forward rules — lock with tests

- [ ] **Step 1:** In `lib/weekly.test.ts` add/confirm: `done` / `dropped` do NOT carry; `open` / `waiting` / `blocked` / `carried` DO; the latest note rides along; completed-this-week stays in the CURRENT review (`doneSinceTasks`). Write any missing case first (watch it fail only if the code is actually wrong — otherwise it locks existing behavior).
- [ ] **Step 2:** "After the meeting" explainer copy states exactly what is kept vs carried (both locales) — verify/adjust strings.
- [ ] **Step 3:** Suggested commit (if changed): `test(weekly): carry rules locked`

---

## Phase E — Invoices (Rotem #invoices)

### Task E1: tab switches drop stale row filters

**Files:** `app/(dash)/(focused)/invoices/page.tsx` (primaryTabs links)

**Root cause (verified):** tab links carry `?vendor=` / `?status=` etc., so Payment Summary can render "No matches" off a leftover filter.

- [ ] **Step 1:** Tab links become `/invoices?tab=${key}` only — no other params carried.
- [ ] **Step 2:** Browser: filter by vendor on Invoices → switch to Payment Summary → full summary; back → filters cleared (predictable), Reset still clears in-view filters.
- [ ] **Step 3:** Suggested commit: `fix(invoices): tab switch clears row filters`

### Task E2: full invoice edit form

**Files:**
- Modify: `components/invoices/link-editor.tsx` (grows into the full editor — keep the filename; it is the row's single edit affordance)
- Modify: `app/actions/invoices.ts` (new `updateInvoice` + `undoInvoiceEdit`), `app/(dash)/(focused)/invoices/page.tsx` (pass vendors/projects/entity options)
- Create: `lib/invoice-rules.ts` + `lib/invoice-rules.test.ts` (pure validation — E3 lives here)
- i18n both locales

**Interfaces:**
- Produces: `updateInvoice(id: string, patch: InvoicePatch)`:

```ts
export interface InvoicePatch {
  vendor_id?: string | null; invoice_no?: string | null; project_id?: string | null;
  entity?: string | null; received_date?: string | null; description?: string | null;
  amount_usd?: number; status?: Invoice['status']; paid_date?: string | null;
  invoice_url?: string | null; transfer_confirmation_url?: string | null; notes?: string | null;
}
```

- [ ] **Step 1:** `updateInvoice`: whitelist the patch → `validateInvoicePatch(before, patch)` (E3) → update → `logActivity({ entity_type: 'invoice', action: 'edit', before, after })` → `{ok, undoId}`. `undoInvoiceEdit(logId)` restores the whitelisted columns from `before_json` (accept only `entity_type === 'invoice'`).
- [ ] **Step 2:** Editor UI: add Vendor `<select>` (vendors), Invoice no., Project `<select>` (incl. General=null), Entity input with `<datalist>` of existing entities, Received date, Description, Amount — above the existing status/paid/links/notes block. SavedChip on save.
- [ ] **Step 3:** Browser (test row): edit every field → refresh → persisted with cents exact (`moneyExact`); Undo restores.
- [ ] **Step 4:** Suggested commit: `feat(invoices): full edit form with audited undo`

### Task E3: Paid ⇄ Payment date rules

**Files:** `lib/invoice-rules.ts` (+ test), consumed by E2's action; confirm-clear UX in the editor.

- [ ] **Step 1:** Failing tests in `lib/invoice-rules.test.ts`:

```ts
import { validateInvoicePatch } from './invoice-rules.ts';

test('paid requires a payment date', () => {
  expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'paid' }))
    .toEqual({ error: 'paid date required' });
  expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'paid', paid_date: '2026-03-17' }))
    .toEqual({ ok: true });
});

test('leaving paid must state what happens to the date', () => {
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved' }))
    .toEqual({ error: 'confirm paid date' });
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved', paid_date: null }))
    .toEqual({ ok: true });
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved', paid_date: '2026-03-17' }))
    .toEqual({ ok: true });
});
```

Run → FAIL. Implement `validateInvoicePatch(prev: Pick<Invoice,'status'|'paid_date'>, patch: InvoicePatch)` accordingly (also: `amount_usd` finite ≥ 0; date fields match `YYYY-MM-DD`). Run → PASS.

- [ ] **Step 2:** Editor UX: when status moves off `paid`, ask "Keep the recorded payment date?" — Keep sends `paid_date: prev`, Clear sends `paid_date: null` (checklist: "החזרת סטטוס מ־Paid מנקה או מבקשת אישור").
- [ ] **Step 3:** Browser: Paid without date blocked with message; with date saved + survives refresh.
- [ ] **Step 4:** Suggested commit: `feat(invoices): paid status enforces payment-date rules`

### Task E4: Add Invoice with duplicate check

**Files:**
- Create: `components/invoices/add-invoice.tsx`; header button on the invoices page
- Modify: `app/actions/invoices.ts` (`createInvoice`), i18n
- Create: `supabase/migrations/0017_invoice_verify.sql`:

```sql
alter table invoices add column if not exists needs_verification boolean not null default false;
```

- [ ] **Step 1:** `createInvoice(input)`: duplicate check before insert — exact key (normalized vendor + invoice_no) hit → return `{dup: {id, vendor, amount_usd, received_date}}`, no insert; suspicion key (vendor + amount + received_date + entity + project) hit → insert with `needs_verification: true`; missing invoice_no → allowed ONLY with `needs_verification: true` (checklist: "חסר Invoice no. מותר רק עם Verify"). Insert audited (`action: 'create'`).
- [ ] **Step 2:** Dialog mirrors AddAction's dup-confirm UX: "Same invoice — open it" / "Add anyway → saved as Verify".
- [ ] **Step 3:** Rows with `needs_verification` render an apricot `Verify` chip next to status (type + table row + i18n).
- [ ] **Step 4:** Browser: add a test invoice twice → second attempt surfaces the first; add one without a number → forced Verify chip.
- [ ] **Step 5:** Suggested commit: `feat(invoices): add-invoice flow with duplicate detection and Verify`

### Task E5: change history visible per invoice

**Files:** `components/invoices/link-editor.tsx` (editor footer), `app/(dash)/(focused)/invoices/page.tsx` (fetch trail server-side)

- [ ] **Step 1:** Collapsed "History" `<details>` in the editor: last 10 `activity_log` rows for the invoice (`entity_type='invoice'`) — actor, action, date, changed keys (diff `before_json` vs `after_json` keys). Read-only; Undo remains newest-edit-only via the chip.
- [ ] **Step 2:** Browser: after E2/E3 edits the trail lists them (checklist: "קיימת היסטוריה או Undo").
- [ ] **Step 3:** Suggested commit: `feat(invoices): per-invoice change history`

### Task E6: reconciliation summary (Source ↔ System)

**Files:**
- Create: `lib/reconcile.ts` + `lib/reconcile.test.ts`
- Create: `components/invoices/reconcile-report.tsx`; wire as a demoted third tab `/invoices?tab=reconciliation` (like `david`)
- Modify: `app/actions/invoices.ts` (upload-and-parse action reusing `lib/parse/xlsx.ts`)

**Reality (verified):** imports never snapshotted source rows — reconciliation re-reads the Excel: upload → parse in memory → diff → render.

- [ ] **Step 1:** Pure diff, failing tests first:

```ts
export interface InvoiceRowRef { vendor: string; invoice_no: string | null; amount_usd: number; received_date: string | null; }
export interface ReconcileReport {
  source: number; system: number;
  added: InvoiceRowRef[];                            // in system, not in source
  orphans: InvoiceRowRef[];                          // in source, not in system
  changed: Array<{ ref: InvoiceRowRef; fields: string[] }>;
  suspectedDuplicates: InvoiceRowRef[][];            // same-key group >1, either side
}
export function reconcile(source: ParsedInvoice[], system: Invoice[], vendorName: (id: string | null) => string): ReconcileReport
```

Key = normalized vendor + invoice_no when present, else vendor + amount + received_date. Tests: the SNO shape (2× No.1/$500/2026-05-27 and 3× No.10/$181.30/2026-07-04) → `suspectedDuplicates`; an extra system row (Thang-Le style) → `added`; a `paid_date` drift → `changed` naming the field. Fail → implement → pass.

- [ ] **Step 2:** UI: upload control + six stat tiles (Source, System, Added, Changed, Suspected duplicates, Orphans — the checklist's exact list) + expandable row lists. Per-row action: "Flag Verify" (`needs_verification=true`) only — nothing auto-applies, nothing deletes.
- [ ] **Step 3:** Browser with the real Excel (Dor supplies the file): tiles render; cross-check "מול 97 הרשומות התקינות".
- [ ] **Step 4:** Suggested commit: `feat(invoices): source-vs-system reconciliation report`

### Task E7: invoice data passes (D3–D12) — through the new tooling

Order matters; every step is SELECT/report-first → Dor/Noa approve → apply via the audited actions/flags:

- [ ] **D6 vendors:** report case/spacing twins in `vendors`; approved merges update `invoices.vendor_id` to the keeper + log; loser rows stay as inert aliases.
- [ ] **D4 Thang Le:** after D6 — merge to ONE row under Rinconia, paid **2026-03-17** (analysis §2); checklist asserts "$5,250 מופיעה פעם אחת ומשויכת ל־Rinconia".
- [ ] **D5 SNO:** flag all five rows `needs_verification=true`; zero deletions (checklist: stay Verify until approved).
- [ ] **D7 General invoices:** Thang Le / Grover-Hollingsworth / PREMISE `INV-HILLA-RIN002` → Rinconia via `updateInvoice`; contradictions → Verify.
- [ ] **D8 paid dates:** re-derive every `paid` row's `paid_date` from the Excel payment column via E6's parse (report first — the most silently-wrong dataset: import set `paid_date = received_date`).
- [ ] **D9 link columns:** confirm which Excel column holds the invoice link; move `transfer_confirmation_url` → `invoice_url` where the report says so.
- [ ] **D10 On Hold:** parser already maps `hold → on_hold` (`lib/parse/xlsx.ts:102`); re-map rows imported before the fix; re-check the open-money header — closes Dor #29 together with the rest of E7.
- [ ] **D12 AVALON #3931:** verify `received_date = 2026-07-29` (analysis says it matches — confirm, no write).
- [ ] **D3/D11:** counts vs the 97 source rows via E6; backfill `tab` if the report shows Payment Summary starved by the hard-coded `tab='invoices'`.
- [ ] **Close:** re-run E6 → Added/Changed/Orphans ≈ 0 or each residual explained; `/work` Payment Run totals match `/invoices` (Dor #29).
- [ ] Commit only scripts added: `chore(data): invoice reconciliation passes`

---

## Phase F — Data Inbox page (Rotem #inbox)

### Task F1: checklist walk + targeted fixes

Code recon says this page is largely compliant (4 tabs + one surface at a time + active ring; paste↔file toggle; busy-guarded dropzone with retry and `router.refresh()`; permanent queue card with empty state; honest MP4 / no-MBOX copy — the checklist's "known" notes accept exactly these). So: walk every item, fix what fails.

- [ ] **Step 1:** Browser pass, desktop + mobile, over all 4 checklist sections: header/nav mark; layout split; tab switching (one surface only); project selection survives a tab switch (state lives inside Dropzone — if a tab remount resets it, lift `project` up into IntakePanel); chosen file name shows; double-upload impossible while busy; error + retry; queue columns (title / source type / filename / status / Review); "Review when ready" links only ready items; a failed POST inserts no queue row (no dupes after retry); refresh loses nothing.
- [ ] **Step 2:** Fix each failing item in `components/upload/intake-panel.tsx` / `app/(dash)/(focused)/upload/dropzone.tsx` / `app/(dash)/(focused)/upload/page.tsx`.
- [ ] **Step 3:** Suggested commit: `fix(upload): inbox checklist corrections`

---

## Phase G — Close the loop

### Task G1: full re-test against both QA docs

- [ ] **Step 1:** `npx vitest run` + `npm run build` → green.
- [ ] **Step 2:** Browser: re-run Dor's 23 FAIL + 2 PENDING on `/work` — target 0 FAIL (B-dependent items only after B1/B2).
- [ ] **Step 3:** Walk Rotem's checklist end-to-end on all four routes, both viewports, filling the interactive doc (statuses persist in localStorage; "העתקת דוח" exports).
- [ ] **Step 4:** Deliver the filled report; anything still red becomes the next follow-up list.

---

## Self-review notes

- **Spec coverage:** every Dor FAIL/PENDING and every Rotem section maps to a task (traceability table). Features the checklist itself flags as possibly-unbuilt (full edit form, Add Invoice, Reconciliation) are built in E2/E4/E6. Items recon already shows compliant are verified, not rebuilt (C5, D3, D6, F1).
- **Known unknowns made explicit, each resolved inside its task by reading a named file:** FK table names for 0015 (A4 Step 1 ← 0012/0003); weekly snapshot columns (A7 Step 1 ← prepare's insert); whether weekly-doc extraction exists (D5 Step 1 ← `app/api/upload/route.ts`, `lib/ingest.ts`). No silent guessing.
- **Type consistency:** `TaskDetailsPatch` / `updateTaskDetails` (A6) are the names C4 + B1 consume; `rankToday` / `TodayRankContext` (A5) match the work-page usage; 0015 columns (`latest_note`, `substage_template_id`, `workstream_id`, `business_rank`) are referenced under those exact names by A4/A5/A6/C2; `needs_verification` (0017) is shared by E4/E6/E7; `SavedChip` (A6) is reused by C3/C4/E2.
