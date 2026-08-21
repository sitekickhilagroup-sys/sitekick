# Sprint D — Weekly Review Screen + Meeting Evidence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sunday preparation / Monday meeting screen: Project > Sub-topic > Actions with carry-forward (including completed items), per-item weekly notes, an explicit Save Review, and Teams/MP4/transcript upload feeding the existing evidence pipeline.

**Architecture:** `weekly_reviews` + `weekly_review_items` snapshot canonical tasks per meeting (items reference `task_id` — one canonical record, snapshots only freeze status text + note). Pure helpers compute the meeting date (next Monday, LA calendar) and the carry-forward merge. Recording upload reuses `/api/upload` (txt transcripts flow through extract-comms → Review Inbox from Sprint A; MP4 is stored as evidence, transcription marked future work exactly like the client demo).

**Tech Stack:** Next.js 16, Supabase, Vitest.

**Spec:** `docs/client-handoff/SITEKICK_BUILD_SPEC.md` §2 (Weekly Review), §3 (`weekly_reviews`, `weekly_review_items`); `SITEKICK_IMPLEMENTATION_GUIDE.md` §5; `GAP-PLAN.md` item 5.

## Global Constraints

Same as Sprints A–C. Sprint A merged first (needs `logActivity`, inbox pipeline, `verbToPatch`); Sprint B helpful but not required (sub-topic falls back to stage label). Final checkpoint here also retires the legacy overview rails if Noa approved the Sprint C Portfolio.

---

### Task 1: Migration 0005 — weekly review tables

**Files:**
- Create: `supabase/migrations/0005_weekly_review.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces TS: `WeeklyReview { id: string; meeting_date: string; status: 'preparing' | 'saved'; source_review_id: string | null; recording_document_id: string | null; created_at: string }`; `WeeklyReviewItem { id: string; weekly_review_id: string; task_id: string; project_id: string | null; subtopic: string | null; status_snapshot: string; weekly_note: string | null; sequence: number; carried_from: string | null }`.

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0005_weekly_review.sql
-- Sprint D: Sunday prep / Monday meeting. Items snapshot canonical tasks.

create type weekly_review_status as enum ('preparing','saved');

create table weekly_reviews (
  id                    uuid primary key default gen_random_uuid(),
  meeting_date          date not null unique,
  status                weekly_review_status not null default 'preparing',
  source_review_id      uuid references weekly_reviews(id),
  recording_document_id uuid references documents(id),
  created_at            timestamptz not null default now()
);

create table weekly_review_items (
  id               uuid primary key default gen_random_uuid(),
  weekly_review_id uuid not null references weekly_reviews(id) on delete cascade,
  task_id          uuid not null references tasks(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  subtopic         text,
  status_snapshot  text not null,
  weekly_note      text,
  sequence         int not null default 0,
  carried_from     uuid references weekly_review_items(id),
  unique (weekly_review_id, task_id)
);
create index idx_wri_review on weekly_review_items(weekly_review_id);

alter table weekly_reviews      enable row level security;
alter table weekly_review_items enable row level security;
create policy "read weekly_reviews"      on weekly_reviews      for select to authenticated using (true);
create policy "read weekly_review_items" on weekly_review_items for select to authenticated using (true);
```

- [ ] **Step 2: Apply** — `node scripts/apply-migration.mjs supabase/migrations/0005_weekly_review.sql` → 200.
- [ ] **Step 3: Types** — append per Interfaces; typecheck; stage.

---

### Task 2: Pure helpers — meeting date + carry-forward merge

**Files:**
- Create: `lib/weekly.ts`
- Test: `lib/weekly.test.ts`

**Interfaces:**
- `nextMonday(today: string): string` — YYYY-MM-DD of the Monday ≥ today (a Monday returns itself). Pure string math (parse as UTC noon to dodge DST).
- `buildReviewItems(input: { openTasks: Task[]; doneSinceTasks: Task[]; priorItems: WeeklyReviewItem[]; stageLabels: Map<string, string> }): Array<{ task_id: string; project_id: string | null; subtopic: string | null; status_snapshot: string; weekly_note: string | null; sequence: number; carried_from: string | null }>` — merge rule (spec: carry forward EVERY prior action including completed, with latest status): (1) every prior item's task appears first, `carried_from` = prior item id, `weekly_note` = null (fresh week), `status_snapshot` = current task status if found in openTasks/doneSinceTasks else the prior snapshot, `subtopic` = stageLabels.get(current stage_key) ?? prior subtopic; (2) open tasks not in prior items appended after, `subtopic` = stageLabels.get(stage_key) ?? null; (3) `sequence` = 1-based order priors-then-new.
- Consumed by: Task 3 actions.

- [ ] **Step 1: Failing tests**

```ts
// lib/weekly.test.ts
import { describe, expect, it } from 'vitest';
import { buildReviewItems, nextMonday } from './weekly.ts';
import type { Task, WeeklyReviewItem } from './types.ts';

describe('nextMonday', () => {
  it('thursday → next monday', () => expect(nextMonday('2026-08-20')).toBe('2026-08-24'));
  it('monday stays', () => expect(nextMonday('2026-08-24')).toBe('2026-08-24'));
  it('sunday → next day', () => expect(nextMonday('2026-08-23')).toBe('2026-08-24'));
});

const mk = (id: string, status: string, stage: string | null = null) =>
  ({ id, project_id: 'p1', title: id, status, stage_key: stage, created_at: '2026-08-01' }) as unknown as Task;

describe('buildReviewItems', () => {
  const prior: WeeklyReviewItem[] = [{
    id: 'i1', weekly_review_id: 'r1', task_id: 't1', project_id: 'p1',
    subtopic: 'Planning', status_snapshot: 'open', weekly_note: 'chase CE', sequence: 1, carried_from: null,
  }];
  it('carries prior items forward with fresh note and current status', () => {
    const out = buildReviewItems({ openTasks: [], doneSinceTasks: [mk('t1', 'done')], priorItems: prior, stageLabels: new Map() });
    expect(out[0]).toMatchObject({ task_id: 't1', carried_from: 'i1', weekly_note: null, status_snapshot: 'done', subtopic: 'Planning' });
  });
  it('appends new open tasks after carried ones', () => {
    const out = buildReviewItems({ openTasks: [mk('t2', 'open', 'sk')], doneSinceTasks: [], priorItems: prior, stageLabels: new Map([['sk', 'Plan Check']]) });
    expect(out.map((i) => i.task_id)).toEqual(['t1', 't2']);
    expect(out[1]).toMatchObject({ subtopic: 'Plan Check', carried_from: null, sequence: 2 });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/weekly.ts
// Weekly review helpers. nextMonday is date arithmetic on an LA-calendar
// string (not a new "today" source — callers pass laToday()).
import type { Task, WeeklyReviewItem } from './types.ts';

export function nextMonday(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const add = (8 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export interface ReviewItemDraft {
  task_id: string;
  project_id: string | null;
  subtopic: string | null;
  status_snapshot: string;
  weekly_note: string | null;
  sequence: number;
  carried_from: string | null;
}

export function buildReviewItems(input: {
  openTasks: Task[]; doneSinceTasks: Task[]; priorItems: WeeklyReviewItem[]; stageLabels: Map<string, string>;
}): ReviewItemDraft[] {
  const current = new Map<string, Task>();
  for (const t of [...input.openTasks, ...input.doneSinceTasks]) current.set(t.id, t);
  const out: ReviewItemDraft[] = [];
  const seen = new Set<string>();
  let seq = 0;

  for (const prior of [...input.priorItems].sort((a, b) => a.sequence - b.sequence)) {
    const task = current.get(prior.task_id);
    seen.add(prior.task_id);
    out.push({
      task_id: prior.task_id,
      project_id: task?.project_id ?? prior.project_id,
      subtopic: (task?.stage_key ? input.stageLabels.get(task.stage_key) : undefined) ?? prior.subtopic,
      status_snapshot: task?.status ?? prior.status_snapshot,
      weekly_note: null,
      sequence: ++seq,
      carried_from: prior.id,
    });
  }
  for (const t of input.openTasks) {
    if (seen.has(t.id)) continue;
    out.push({
      task_id: t.id,
      project_id: t.project_id,
      subtopic: (t.stage_key ? input.stageLabels.get(t.stage_key) : undefined) ?? null,
      status_snapshot: t.status,
      weekly_note: null,
      sequence: ++seq,
      carried_from: null,
    });
  }
  return out;
}
```

- [ ] **Step 4: PASS.** Stage.

---

### Task 3: Weekly review server actions

**Files:**
- Create: `app/actions/weekly.ts`

**Interfaces (all Sprint A action pattern — requireUser, admin writes, `{ ok } | { error }` returns, logActivity, `revalidatePath('/weekly')`):**
- `prepareCurrentReview(): Promise<{ ok: true; reviewId: string } | { error: string }>` — meeting date = `nextMonday(laToday())`; reuse existing `weekly_reviews` row for that date or insert one with `source_review_id` = latest `status='saved'` review id; gather: prior saved review's items, open tasks, done tasks with `last_touched >=` prior meeting date (skip when no prior), stageLabels from `project_stages` (`select('stage_key,label')`, first label per key); compute `buildReviewItems`; upsert items with `onConflict: 'weekly_review_id,task_id'` — but first fetch existing items of this review and preserve any non-null `weekly_note` (notes survive re-preparing).
- `saveItemNote(itemId: string, note: string)` — `weekly_note` = trimmed note or null.
- `setItemStatus(itemId: string, taskId: string, verb: 'completed' | 'not_applicable' | 'sent_email')` — apply `verbToPatch(verb, null, laToday())` to the canonical task (spec: updates propagate everywhere), then set the item's `status_snapshot` to `'done'` for completed, `'dropped'` for not_applicable, else leave; logActivity on the task exactly like `applyWorkVerb`.
- `saveReview(reviewId: string)` — status `'saved'`, activity `action: 'save_review'`, also `revalidatePath('/')`.
- `attachRecording(reviewId: string, documentId: string)` — sets `recording_document_id`.

- [ ] **Step 1: Implement per interfaces** (import `verbToPatch` from `@/lib/work-verbs`, `nextMonday`/`buildReviewItems` from `@/lib/weekly`, `logActivity` from `@/lib/state-writer`).
- [ ] **Step 2:** `npx tsc --noEmit`; stage.

---

### Task 4: Weekly Review page `/weekly`

**Files:**
- Create: `app/(dash)/weekly/page.tsx`
- Create: `components/weekly/review-board.tsx`
- Modify: `app/api/upload/route.ts` (`.mp4` branch), `app/(dash)/layout.tsx` (nav), `lib/i18n/en.json`, `lib/i18n/he.json`

**Interfaces:**
- `.mp4` upload branch (add right after the `.pdf` branch in `app/api/upload/route.ts`): store buffer to storage bucket `documents` path `recordings/${Date.now()}-${file.name}` contentType `video/mp4`; `ingestDocument(admin, { kind: 'transcript', source: 'upload', storage_path: path, external_id: dedupKey })`; do NOT call `processDocument` (transcription = future work, mirroring the client demo's design-only upload); respond `{ ok: true, type: 'recording', documentId }`. `.txt`/`.docx` keep flowing through the existing extract-comms path (proposals land in `/inbox` via Sprint A).
- Page (`export const dynamic = 'force-dynamic'`): reads the review row where `meeting_date = nextMonday(laToday())` + its items + task titles + project names. No review row → renders a client "Prepare" button that calls `prepareCurrentReview` then `router.refresh()`. With review → group items: Project (name) → Sub-topic (`subtopic` or `t('weekly.general')`) → rows ordered by `sequence`; pass to `ReviewBoard`.
- `ReviewBoard` ('use client') props `{ review: WeeklyReview; groups: Array<{ projectName: string; subtopics: Array<{ name: string; items: Array<{ item: WeeklyReviewItem; title: string }> }> }>; labels: Record<string, string> }`. Row: title, status chip (`done` → `bg-sage-soft text-sage`, `dropped` → `bg-inset text-ink3`, else `bg-mist-soft text-mist`), note `<input defaultValue={item.weekly_note ?? ''}>` saving on blur via `saveItemNote` (useTransition, `role="alert"` error with `labels.error`), buttons Completed / N-A via `setItemStatus` (hidden when review saved). Footer: meeting date (mono), `saveReview` button (disabled + `labels.saved` when `review.status === 'saved'`), upload input `accept=".mp4,.txt,.docx"` posting FormData to `/api/upload`, then `attachRecording(review.id, documentId)`; show `labels.uploaded` on success.
- i18n en: `"nav.weekly": "Weekly Review"`, `"weekly.title": "Weekly review"`, `"weekly.sub": "Prepare Sunday, run Monday — everything carried forward with current status"`, `"weekly.prepare": "Prepare this week's review"`, `"weekly.meeting": "Meeting date"`, `"weekly.save": "Save review"`, `"weekly.saved": "Review saved"`, `"weekly.note": "Weekly note"`, `"weekly.upload": "Upload recording or transcript"`, `"weekly.uploaded": "Recording attached"`, `"weekly.general": "General"`. he: `"nav.weekly": "סקירה שבועית"`, `"weekly.title": "סקירה שבועית"`, `"weekly.sub": "מכינים בראשון, מריצים בשני — הכול עובר קדימה עם סטטוס עדכני"`, `"weekly.prepare": "הכנת הסקירה השבועית"`, `"weekly.meeting": "תאריך הפגישה"`, `"weekly.save": "שמירת הסקירה"`, `"weekly.saved": "הסקירה נשמרה"`, `"weekly.note": "הערה שבועית"`, `"weekly.upload": "העלאת הקלטה או תמלול"`, `"weekly.uploaded": "ההקלטה צורפה"`, `"weekly.general": "כללי"`.

- [ ] **Step 1: i18n.** **Step 2: mp4 branch.** **Step 3: page + board.** **Step 4: nav `{ href: '/weekly', label: t('nav.weekly') }`.** **Step 5: Verify** — prepare → grouped items appear; note survives reload AND re-prepare; Completed here closes the task in `/work` (canonical record); save freezes controls; `.txt` upload → proposals in `/inbox`; `.mp4` stores + attaches. Stage.

---

### Task 5: Checkpoint + legacy cleanup

- [ ] `npm run check` + `npm run build` green.
- [ ] Acceptance (BUILD_SPEC §9): Weekly Review carries forward prior actions including completed with current status + notes; manual meeting updates are authoritative activity (activity_log rows); recording upload stores evidence.
- [ ] If Noa approved the Sprint C Portfolio: remove the `ProjectRails` render from `app/(dash)/page.tsx`; delete `components/overview/tasks-section.tsx` + `components/overview/top-actions.tsx` only if `grep -r "tasks-section\|top-actions" app components` shows no remaining imports.
- [ ] Update `docs/client-handoff/GAP-PLAN.md` item statuses (living specification promise).
- [ ] `git add -A`, report to Dor for `/commit-push`, then Vercel deploy check.

## Self-Review Notes

- Items reference `task_id` (one-canonical-record rule); board mutations go through `verbToPatch` — the same path `/work` uses.
- `nextMonday` UTC-noon math documented as arithmetic, not a "today" source; callers feed `laToday()`.
- MP4 transcription explicitly deferred (client demo ships it as interaction design only); `.txt`/`.docx` path fully live through Sprint A inbox.
- Type consistency: `ReviewItemDraft` produced by Task 2 matches `weekly_review_items` insert columns; `setItemStatus` verb subset ⊆ `WorkVerb`.
