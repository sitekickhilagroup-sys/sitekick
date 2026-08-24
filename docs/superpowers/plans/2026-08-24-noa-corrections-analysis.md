# "תיקונים נעה" — Defect Catalogue

Companion to `2026-08-24-ux-ui-version-fixing.md`. Phase 7 of that plan implements what is catalogued here.

**Source:** Google Doc tab "תיקונים נעה".
**Analysed against:** commit `b8889d1`, 2026-08-24.

**Headline:** this tab is **not** a small styling list. It is a functional and data-integrity backlog requiring new server logic, migrations, and thirteen separate cleanup passes over live Supabase rows. The UX/UI tab's "no schema changes" rule is scoped to *purely visual* work and does not apply here.

---

## 1. Duplicates (כפילויות)

> "בבדיקת מסך Waiting נמצאו לפחות 11 קבוצות של כפילויות ודאיות. לכן הכיתוב במערכת Nothing is duplicated אינו נכון כרגע."
> *"Reviewing the Waiting screen, at least 11 groups of certain duplicates were found. Therefore the system's copy 'Nothing is duplicated' is currently untrue."*

Eleven tasks appear **both** under General and under their real project: Hold Letter Corrections; Retain Civil Engineer for Grading Plan & B Permit; Retain Surveyor / Updated Survey / Topo; Retain Landscape Consultant; Retain Certified Arborist; Form LLC for San Marco; New / Updated Renders; Confirm Hilla Group LLC authorization documents; Two Arborist documents to complete and sign (all San Marco); Review New Lawsuit - Flicker; Write email to Chilean architect (both Flicker).

Tasks in one chain must **not** be merged — Rinconia's `Soils Addendum → LADBS Review → Soil Approval Letter` must be linked as sequential dependencies instead.

### Required fix

1. A **Merge duplicate** action on existing tasks, not only on agent proposals.
2. The merge picks one **Master Action**.
3. It transfers source evidence, notes, status history, waiting-on, due dates, and project/phase/sub-stage links.
4. The loser is kept as **Merged** — history is never deleted.
5. The merge is undoable.
6. All screens show only the Master Action.
7. Fix the task's project ID rather than leaving a project task under General.
8. A task affecting several projects becomes a **Shared Action** linked to each project — not several copies.
9. Before creating a task the agent runs a **Duplicate Check** on: similar title, same project, same phase and sub-stage, same party waited on, same source or email thread, same required outcome.

### Required Review Inbox behaviour

When the agent finds a similar task it must show the existing task beside the new proposal and offer: Update existing task · Merge duplicate · **Keep both and link them** · Information only · Create new task.

> "אין להמשיך לעדכן ידנית את כל רשימת Waiting לפני תיקון הכפילויות, משום שזה עלול לקבע מידע שגוי בשתי רשומות שונות."
> *"Do not keep manually updating the whole Waiting list before the duplicates are fixed — it risks locking wrong information into two separate records."*

### Why it fails today

| Location | Behaviour | Root cause |
|---|---|---|
| `lib/dedup.ts:38-55` `matchExistingTask()` | Token match, threshold 0.55 | **Line 43** `if (t.project_id !== candidate.project_id) continue;` — candidates are only compared inside the same project, so a San Marco task and its `project_id = null` twin are structurally never compared. Direct cause of all eleven groups. |
| `app/actions/tasks.ts:57-101` `createTaskChecked()` | Manual add-action check, similarity ≥ 0.5 | **Line 72** applies the same project scoping. Title-only — no phase/sub-stage, waiting-on party, source thread, or required-outcome signal. |
| `lib/import/tracker.ts:74` `applyTaskRows()` | Excel tracker import | `matchProject()` (`:10-21`) returns `null` for a blank or unrecognised project cell, so the row lands with `project_id = null`, renders as General, and is then invisible to the matcher. This *creates* the twins. |
| `app/actions/proposals.ts:131-148` `decideProposal()` | Applies the chosen change type | `'merge_duplicate'` is **not a merge** — it falls to the generic branch and patches title/owner/due/description. No Master Action, no transfer, no Merged state. |
| `components/inbox/review-board.tsx:37-39` `TREATMENTS` | Drawer dropdown | Missing "Keep both and link them". `keep_open` leaves both rows and creates no link, although a `relationships` table exists (`supabase/migrations/0004_relationships.sql`) and is unused here. |
| `lib/i18n/en.json:225` | `"work.sub": "… Nothing is duplicated."` | The untrue copy Noa cites. |

There is **no merge for already-created tasks anywhere**: no `merged_into` column or `merged` state on `tasks` (`supabase/migrations/0001_init.sql:100-118`), and no shared-action model.

### Also in this section — do not lose

"לא נותן לשמור" (*it won't let me save*). "לא צריך להופיע כל ה-109 להיום" (*all 109 should not appear for Today; only a sensible ranked number*). **Project Process:** the project is not on hold; add an **Impact on process** field under Update with values **Primary Blocker / Workstream Blocker / Future Gate / External Gate / Not Blocking / Verify**, kept separate from task status; then recompute each project card's Blockers count and Main Blocker. **My Work:** normalise free-text "waiting on" into a fixed template; `Hold Letter Corrections` and `Retain Civil Engineer for Grading Plan & B Permit` are attributed to the wrong project (both → San Marco), as are Rinconia tasks sitting under General; Project / Phase / Sub-stage / Workstream must be editable on any existing task; Today's ranking is wrong — Financing/Budget/Bank Accounts outrank stage-threatening work, and the expected eight-item order is listed verbatim in the spec slice at `08-noa-hebrew.md:84-91`. Ranking must weigh active stage impact, Primary vs Workstream Blocker, city deadline or expiry, our-action vs external wait, dated commitment, wait duration and follow-up need, evidence quality and freshness, and Noa's manual priority — **"a Blocking tag alone cannot determine Priority."**

---

## 2. Weekly Review — reported defects

Spec status: *"Reviewed - failed functional testing; corrections required."* Observed baseline: **103 actions** — Blair 21, Rinconia 13, Alta Mesa 14, San Marco 17, Flicker 6, General 32.

**§1 Preparing the review.** 103 actions is too large; duplicates enter; project tasks appear under General; **Flicker appears although it is not an active project**; old unchanged tasks enter; every action is listed separately even when several share a topic; there is no way to choose what enters; active vs information-only vs future is not distinguished. Prepare must by default include only active projects, Master Actions with no duplicates, tasks still open from the previous meeting, tasks changed/added/completed this week, Open/Waiting/Blocked/Carry-forward, and the latest weekly note — plus manual **Include / Remove / Add / Restore**, where removing never alters the underlying task.
*Live:* `app/actions/weekly.ts:72` selects **every** open task with no `projects.active` filter and no dedup, even though `supabase/migrations/0007_alignment.sql:11-12` already adds `projects.active` and marks Flicker inactive. `lib/weekly.ts:22-57` has no inclusion concept; `0005_weekly_review.sql:15-26` has no `included`/`removed_at`. → **logic + migration + UI**

**§2 Review structure.** Must read Project → Sub-topic → (Action, Owner, Current status, Latest weekly note, Next step, Due date). *Live:* the hierarchy exists (`app/(dash)/weekly/page.tsx:96-132`, `components/weekly/review-board.tsx:73-137`) but **`Next step` exists nowhere** — not in the row (`review-board.tsx:244-300`) nor the schema. → **UI + migration**

**§3 Status update during the meeting.** "Open looks like a button but is only a text tag"; it cannot be clicked; clicking the task opens no editor; **after Save Review the review becomes view-only**; there is no Edit or Reopen; a note cannot be updated after saving. Each task must allow Open/Completed/Waiting/Blocked/Carry-forward/Not-applicable directly, plus editing weekly note, owner, due date and next step. Save must version, not lock; if locking is wanted, split **Save draft / Finalize / Reopen**.
*Live:* `review-board.tsx:22` `saved = review.status === 'saved'` → `:25` `readOnly = saved || present` → `:261` renders a static `<span role="status">` and `:263` hides the editor. A real `<select>` exists only in draft mode (`:283-293`). `app/actions/weekly.ts:235-246` only ever sets `status:'saved'` — **no reopen action**. The enum `weekly_review_status` (`0005_weekly_review.sql:4`) is only `('preparing','saved')`. Owner/Due/Next-step are display-only (`:253-259`). → **logic + migration + UI**

**§4 Data persistence.** Worked before locking: the Carlos task in Blair took Status Waiting plus a note and survived refresh. Still to verify: changes survive refresh, propagate to **My Work** and **Project Process**, never yield three different statuses for one task on three screens, retain who/when, and can be rolled back.
*Live — real defect:* `app/actions/weekly.ts:218-233` `setItemSnapshot()` writes only `weekly_review_items.status_snapshot` and never touches `tasks`; its own comment (`:212-214`) calls this deliberate. So **Waiting / Blocked / Carry-forward / No-update set in the meeting never reach My Work or Project Process** — exactly the three-statuses risk. Only `setItemStatus()` (`:153-177`) writes through, and only for `completed`/`not_applicable`. Actor and timestamp are captured via `logActivity` → `activity_log`, so that half holds; there is no undo on Weekly. → **logic**

**§5 Sunday Draft / Monday Presentation.** Sunday must support reviewing the week, checking still-open tasks, fixing wording and notes, adding or removing actions, showing new agent proposals, and saving a draft. Monday must be clean and team-facing **and still allow updating status and note without leaving the screen** — *"Monday Presentation should not be a locked screenshot of the Sunday Draft."*
*Live:* `review-board.tsx:23,25` forces `readOnly` in present mode — precisely the locked screenshot the spec forbids. No proposal surface inside the draft; proposals live only at `app/(dash)/inbox/page.tsx`. → **logic + UI**

**§6 Completed tasks.** A task completed this week must stay in **that** week's review with Completed, a completion date and the last note, and must not auto-carry next week.
*Live:* `lib/weekly.ts:44-55` iterates `input.openTasks` only, so a task completed this week that was not already on the prior review **never enters this week's review**. Meanwhile `:31-43` carries **every** prior item forward regardless of status, so completed items **do** leak into next week. Both halves are inverted. No completion-date column. → **logic + migration**

**§7 Carry Forward.** Carry only Open/Waiting/Blocked/Carry-forward; preserve the previous week's note and show space for a new one without erasing history.
*Live:* `lib/weekly.ts:31-43` carries everything with no status gate, and **line 40 sets `weekly_note: null`**, dropping the prior note. `app/actions/weekly.ts:88-102` re-merges notes only within the current review. → **logic**

**§8 Upload recording or meeting summary.** "Upload recording or transcript does not actually work with a Word file" — the field advertises MP4/TXT/DOCX but DOCX never completes. Needs real DOCX (and MP4, TXT; consider PDF and DOC), upload progress, file name and upload time, processing status, a clear failure message, remove-and-re-upload, and storage against the matching review. After processing it must **propose** new tasks, updates, completions, owner changes, due changes, waiting/blocked and notes — and **every significant proposal goes through Review before changing the system**.
*Live:* `review-board.tsx:356-369` — `accept=".mp4,.txt,.docx"`, no progress, name, time, processing state or re-upload; failures render the generic `common.error_save`. Client guard `:324` fails when `documentId` is absent — and `app/api/upload/route.ts:176` returns `{ok:true, deduped:true}` **with no `documentId`** for a DOCX that dedupes, which the client then reports as an error. `:183` also returns thrown errors as HTTP 200 `{ok:false}`. MP4 (`:65-77`) is stored and linked only — **transcription is explicitly not implemented**. PDF routes to the invoice agent (`:50`). No `.doc`. `attachRecording` (`app/actions/weekly.ts:248-259`) stores one `recording_document_id` per review with no filename, time or status. → **logic + migration + UI**

**§9 Sync with the rest of the system.** Weekly must not be a separate task store; one record must appear in My Work, Project Process and Weekly Review, and a meeting update must propagate everywhere. A weekly note may stay separate history, but **the active status must be uniform**.
*Live:* same root cause as §4. Also `setItemStatus` revalidates `/weekly`, `/`, `/work` (`:175`) but **not** the project process route, and `setItemSnapshot` revalidates only `/weekly`. → **logic**

### Weekly Review — acceptance conditions

- [ ] Prepare Review introduces no duplicates
- [ ] Inactive projects do not enter by default
- [ ] General holds only genuinely general tasks
- [ ] A task can be added to and removed from the review
- [ ] Open can be changed to another status
- [ ] A note can be edited during the meeting
- [ ] Save does not lock the review
- [ ] A saved review can be reopened
- [ ] DOCX or MP4 upload works and shows clear status
- [ ] An update persists after refresh
- [ ] An update syncs with My Work and Project Process
- [ ] Completed tasks stay in the current review
- [ ] Only open tasks carry to next week
- [ ] A history of every weekly review is retained

> *"Do not run Prepare Review for real use until the corrections are complete and re-tested."*

---

## 3. Invoices — reported defects

Spec status: *"Reviewed - functional and data corrections required."* Source of truth is the **Invoices** tab of `Hilla US - Invoices Tracker.xlsx`. The **To Pay** tab was deliberately excluded at Noa's request.

**§1 Record-count mismatch.** The Excel holds **97 valid invoice records**; the system shows more records and more vendors, including duplicated and stale data. Needs a **Reconciliation** view: count in Excel, count in system, records added, changed, suspected duplicate, and present-in-system-but-absent-from-source. **A record missing from the source must never be auto-deleted — it moves to `Verify`.**
*Live:* `lib/import/tracker.ts:23-61` is upsert-only, returning `{upserted, failed}` — no diff, no classification, no UI. `invoice_status` (`0001_init.sql:10`) has no `verify`. → **logic + migration + data cleanup**

**§2 Duplicates.** **Thang Le $5,250** appears more than once though the Excel holds exactly one row (Rinconia / 2650 Rinconia LLC / "Thang le& Associates" / $5,250 / Paid / **payment date March 17, 2026**) — *"the duplication was probably created during the import process."* The Excel itself may also hold SNO Solutions duplicates: two rows at Invoice No. 1 / $500 / May 27 2026, and three at Invoice No. 10 / $181.30 / July 4 2026. Flag `Verify`, never auto-delete. Detection must key on **normalised vendor, invoice number, amount, invoice received date, entity, project**.
*Live — root cause:* `0001_init.sql:206` `unique (vendor_id, number)` with `tracker.ts:57` `onConflict:'vendor_id,number'`. Two failure modes: **(a)** `tracker.ts:37-38` upserts vendors on the **exact** name, so "Thang Le & Associates" and "Thang le& Associates" become two `vendor_id`s and the invoice upsert can never collide; **(b)** Postgres treats `NULL` as distinct in a unique constraint, so any blank invoice number inserts a fresh row on every import. Amount, received date, entity and project are not in the key. → **logic + migration + data cleanup**

**§3 Vendor names.** Multiple spellings for one vendor: `Thang Le & Associates` / `Thang le& Associates`; `Grover Hollingsworth` / `Grover-Hollingsworth`; `A.G.I Geotechnical` / `A.G.I. Geotechnical`; `PREMISE` / `PREMISE LLC`; `Crest Real Estate` / `Crest Real Estate LLC`. Needs one unified **display name**, retention of the **original name from the invoice**, **aliases**, a **Merge vendors** action, and prevention of new vendors created by differences in capitalisation, period, space or hyphen.
*Live:* `app/(dash)/invoices/page.tsx:37-47` — `canon()` only trims and collapses whitespace, `vKey()` lowercases; display/grouping only, and it handles none of the five cases. `vendors.name` is `not null unique` (`0001_init.sql:162-173`) with no display name, original name or aliases. No merge action. → **logic + migration + data cleanup**

**§4 Project / entity assignment.** Invoices show under **General** although the entity or the Excel points at a project — **Thang Le → Rinconia, Grover-Hollingsworth → Rinconia, PREMISE `INV-HILLA-RIN002` → Rinconia**. Rules must run in order: Excel property/project → LLC/entity → invoice number or description → vendor and existing engagement → previous manual assignment. **When project and entity contradict, the record moves to `Verify`.**
*Live:* `lib/import/tracker.ts:10-21` implements rule 1 only and returns `null` otherwise; `page.tsx:60,244` render null as General. Rules 2-5 and the contradiction path do not exist. The PREMISE case is decidable by rule 3 — `INV-HILLA-`**`RIN`**`002`. → **logic + data cleanup**

**§5 Invoice edit form.** Editable today: status, paid date, invoice link, receipt link. **Not** editable: vendor, invoice number, project, entity, invoice received date, description, amount. All must become editable **with audit history** recording previous value, new value, updated by, updated at and source of change.
*Live:* `components/invoices/link-editor.tsx:35-148` and `app/actions/invoices.ts:33-56` cover only the first set. **Audit gap:** `invoices.ts:53` calls `logActivity(… after: row)` with **no `before`**, so `activity_log.before_json` stays null and "previous value" is never captured; there is no source-of-change field and no history UI. → **logic + UI**

**§6 Invoice date.** **Service Month must not be the primary date.** The primary date is **Invoice Received Date**, exactly as entered in the Excel; Service Month may exist as a secondary field. Worked example **AVALON #3931** — received July 29 2026 / San Marco / Hilla Group LLC / $1,200 / Received — matches the source correctly today.
*Live:* the displayed date is `page.tsx:252` `inv.received_date ?? inv.invoice_date ?? ''`. **No `service_month` column or string exists anywhere in the repo.** `lib/parse/xlsx.ts:113` maps `excelDate(pick(o,'receiveddate','received'))`; `pick()` matches by normalised substring, so a sheet whose only date header is "Service Month" yields `received_date = null` and the row falls back to `invoice_date`. **Verify against the real workbook before writing code** — this reads as a column-mapping problem, not a rendering bug. → **logic + migration + re-import**

**§7 Changing to Paid.** Must require a payment date and a receipt or transfer confirmation where one exists; must persist across refresh; must allow deleting the paid date when moving off Paid, correcting a wrong paid date, adding or replacing a receipt link, and undo or history. *"We did not change a real invoice for the purposes of this test."*
*Live:* `app/actions/invoices.ts:22` — `advanceInvoice()` silently stamps `paid_date = laToday()`, overwriting the real payment date. `:46` — `paid_date: patch.paidDate || (patch.status==='paid' ? laToday() : null)`, so **clearing the date while still Paid silently re-stamps today**, making correction-to-blank impossible; moving off Paid does clear it, which is right. No receipt requirement, no undo, no history. Data consequence: `lib/import/tracker.ts:56` wrote `paid_date = received_date` for every imported Paid invoice. → **logic + UI + data cleanup**

**§8 Links.** Two separate links are needed — **Invoice** and **Receipt / Transfer Confirmation** — opening in a new tab, shown only when a URL exists, showing **"Missing link"** when absent, never presenting a receipt as an invoice, and editable.
*Live:* `page.tsx:205-219` renders **three** links (`invoice_url`, `receipt_url`, `transfer_confirmation_url`), each conditional, new-tab correct. **No "Missing link" state.** Mislabelling root cause: `lib/import/tracker.ts:54` writes the Excel's invoice-link column (`xlsx.ts:114`) into **`transfer_confirmation_url`**, so the invoice link surfaces under the transfer-confirmation label. `link-editor.tsx` cannot edit that column at all. → **logic + UI + data cleanup**

**§9 Payment Summary.** The header shows **42 open invoices totalling $127,849**, but Payment Summary shows *"No invoices match this filter"* with no visible filter to explain it. Required: the tab loads with no hidden filter, moving between tabs resets irrelevant filters, the summary uses the same records as the list, Received / For Rowan approval / Approved totals match the source, **Paid invoices are excluded from the amount due**, and grouping by entity and project is correct.
*Live — confirmed root cause:* `page.tsx:58` `if (inv.tab !== tab) return false;`. `tab` is a **stored column** (`invoices.tab invoice_tab not null default 'invoices'`, `0001_init.sql:199`) and the importer **hard-codes `tab:'invoices'`** (`tracker.ts:51`). So `payment_summary` matches zero rows and renders `invoices.empty` — a misleading message, since no filter is responsible. The header total (`page.tsx:75-76`) counts all invoices ignoring `tab`, which is why 42 / $127,849 coexists with an empty tab. Payment Summary is also not a summary: it re-renders the flat table with no grouping and no totals. → **logic + UI + data cleanup**

**§10 Statuses.** Excel uses Received, For Rowan Approval, Approved, Paid, On Hold. The system must match and show **Received → For Rowan Approval → Approved → Paid** with **On Hold as a separate track**, changeable manually and from an approval process without creating a new record.
*Live:* the enum is right (`0001_init.sql:10`, labels `lib/i18n/en.json:102-106`). But **`lib/parse/xlsx.ts:87-93` never maps "On Hold"** — `norm("On Hold")` = `"onhold"` matches none of `paid`/`rowan`/`approv` and falls through to **`received`**; `InvoiceRow['status']` (`xlsx.ts:16`) does not even include `'on_hold'`. `components/invoices/status-chain.tsx:22-24` renders On Hold as a dead grey chip with no advance control — a terminal state in the UI. Manual change already avoids creating a record. → **logic + UI + data cleanup**

**§11 Add a new invoice.** Needs Add invoice with received date, project, entity, vendor, invoice number, invoice link, description, amount, status, notes; a duplicate check showing the similar invoice **before** saving; and saving must **not** be blocked by a missing invoice number — it shows `Verify` instead.
*Live:* **no add-invoice UI or action exists.** `app/actions/invoices.ts` exposes only `advanceInvoice`, `updateInvoiceDetails`, `saveInvoiceLinks`. No `verify` status. → **new feature: logic + UI + migration**

### Invoices — acceptance conditions

- [ ] The record count is explained against the source
- [ ] The Thang Le duplication is resolved
- [ ] The SNO duplicates are flagged for review
- [ ] Vendor names are unified
- [ ] Project and entity assignments are correct
- [ ] All invoice fields are editable
- [ ] Invoice Received Date is the primary displayed date
- [ ] Invoice link and receipt link are separate
- [ ] A change to Paid persists after refresh
- [ ] The paid date can be corrected or deleted
- [ ] Payment Summary displays the open invoices
- [ ] Summary totals match the invoice list
- [ ] A change history exists
- [ ] Adding an invoice checks for duplicates before saving

> *"The section is not approved for routine use until fixed and re-tested."*

---

## 4. Overlap with the visual redesign

Bundle these with the corresponding redesign phase — they rewrite the same JSX, and doing them separately means touching it twice.

- **Weekly Review** (`components/weekly/review-board.tsx`, `app/(dash)/weekly/page.tsx`): §2 Next-step field; §3 live status control after save and in presentation mode, plus inline owner/due/next-step editing and Save-draft / Finalize / Reopen; §5 editable Monday mode; §8 upload card with progress and status; §1 Include / Remove / Add / Restore controls. Everything in Weekly §1-§8 except the data-selection logic in `lib/weekly.ts` and `app/actions/weekly.ts` lands in these two files.
- **Invoices** (`app/(dash)/invoices/page.tsx`, `components/invoices/*`): §5 turns `link-editor.tsx` into a full edit form; §8 links plus the Missing-link state (`page.tsx:204-241`); §9 Payment Summary (`page.tsx:49-99` plus a new grouped summary component, and `filter-bar.tsx` for reset-on-tab-switch); §10 On Hold track (`status-chain.tsx`); §11 add-invoice dialog; §3 vendor unification moving out of `page.tsx:34-47` into the data layer; §6 primary date at `page.tsx:251-254`.
- **Review Inbox** (`components/inbox/review-board.tsx:37-39,338-388`): "Keep both and link them" plus a real merge flow changes the drawer footer and treatment dropdown.

**Do not bundle with a visual pass** — pure server/data work with no JSX: `lib/weekly.ts`, `app/actions/weekly.ts`, `lib/dedup.ts`, `lib/import/tracker.ts`, `lib/parse/xlsx.ts`, `app/actions/invoices.ts`, and all migrations.

---

## 5. Data-integrity items — cleanup, not code

**These are wrong or duplicated rows already in Supabase. Fixing the code stops new bad rows; it does not repair existing ones.** Each needs its own data pass.

| # | Item | What is wrong in the data | Cleanup |
|---|---|---|---|
| D1 | The 11 duplicate task groups | Two `tasks` rows per group — one with the right `project_id`, one with `null` (General). | Merge into Master Actions once the merge feature exists. Do not hand-fix in SQL or history is lost. |
| D2 | Wrong project attribution in My Work | `Hold Letter Corrections`, `Retain Civil Engineer…` and the Rinconia tasks carry `project_id = null`. | Update `tasks.project_id` — same rows as D1. |
| D3 | Invoice record-count mismatch | More invoice and vendor rows than the 97 in the Excel, including stale rows. | Reconciliation run; stale rows → `Verify`, never auto-delete. |
| D4 | Thang Le $5,250 duplicated | Multiple `invoices` rows under two `vendor_id`s and/or a null invoice number. | Merge to one row with an audit trail; confirm the paid date is **March 17, 2026**. |
| D5 | SNO Solutions duplicates | Duplicated **in the source Excel itself** — 2 rows @ No. 1 / $500 / May 27 2026, 3 rows @ No. 10 / $181.30 / July 4 2026. **No code change can decide these.** | Flag `Verify`; Noa adjudicates against the source. |
| D6 | Split vendor rows | `vendors` holds both spellings of at least five vendors. | Merge pass; keep originals as aliases. |
| D7 | Invoices under General | `project_id = null` on Thang Le, Grover-Hollingsworth and PREMISE `INV-HILLA-RIN002` — all Rinconia. | Backfill once the rule chain exists; contradictions → `Verify`. |
| D8 | Wrong paid dates | `tracker.ts:56` set `paid_date = received_date` for every imported Paid invoice. **All Paid rows carry a fabricated payment date.** | Re-derive from the Excel payment-date column. Most silently-wrong dataset in the section. |
| D9 | Invoice links in the wrong column | The Excel invoice link went to `transfer_confirmation_url` on every imported row. | Column move after confirming what the Excel column actually holds. |
| D10 | On Hold imported as Received | `mapInvoiceStatus()` never recognised "On Hold", so those rows sit as `received` and inflate the open-money header. | Re-map from source after the parser fix. Affects the 42 / $127,849 headline. |
| D11 | All invoices stored with `tab='invoices'` | Hard-coded at import — the reason Payment Summary is empty. | Backfill, or better, drop `tab` as a stored discriminator and derive the view. |
| D12 | Service Month vs Received Date | No `service_month` in code or schema, so this is source-column mapping, not rendering. `received_date` is likely null for a subset. | Confirm the real Excel headers, then re-import. |
| D13 | 103 weekly-review items already generated | The current review row already holds 103 items including Flicker and the General duplicates. Fixing `prepareCurrentReview` does not clean it. | Re-prepare after the logic fix — and only after D1/D2, or the duplicates regenerate. |

| D14 | Every blocker is unclassified | Migration 0009 added `blockers.kind` and defaulted existing rows to `verify`, because none carries the evidence the mandatory blocker test requires. Until they are reclassified, **every project reports 0 confirmed blockers** and the same count under Verify. | Reclassify from the Blocker Audit tab, which gives the correct kind, `blocks_phase`, `blocked_deliverable` and `release_condition` per blocker per project, plus the expected count for each of the four projects. Set `manually_corrected_by` so agents cannot overwrite Noa's calls. |

**Ordering:** D1/D2 before D13. D6 before D4 — invoices cannot be merged while the vendor rows are still split. D14 should land before Portfolio is shown to Noa, or the cards will read as having no blockers at all.
