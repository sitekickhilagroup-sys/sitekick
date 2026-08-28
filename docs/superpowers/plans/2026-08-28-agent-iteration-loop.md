# Agent iteration loop — improving extract-comms one real document at a time

Method (Dor, 2026-08-28): feed a real communication through the REAL product
path → compare the transcript against what the agent mapped → fix the gaps →
re-run the SAME document → measure. Repeat until the agent maps reliably at
the phase level and then the sub-stage level. Human rulings (Noa's review
decisions) become the learning signal between iterations.

## Test document

`August_24_2026_Internal_Meeting_Summary[1][1].docx` — internal meeting
summary covering FOUR projects (Blair, San Marco, Rinconia, Alta Mesa).
Noa uploaded it herself 2026-08-27 21:01 UTC → document `a951fbf5`.

## Iteration 1 — commit `38bba98` (deployed, prod smoke 307s)

**Found:** the agent ran on her upload for 26s, extracted rich content, then
`applyExtractResult` discarded ALL of it: the contract allowed one
`project_name` per document, a four-project meeting resolved to null, and the
null branch stamped `processed_at` and returned. 0 tasks, 0 proposals,
nobody told. (Dry-run of the same text: 11 tasks — 7 correct cross-project
existing_id matches — thrown away by architecture, not by the model.)

**Shipped:**
- Per-item `project_name` (required, nullable) on every task / blocker /
  decision / deadline_update / relationship / vendor_hours item. Top-level
  project_name now means "the whole document is this project", else null.
- `stage_key` + new `blocks_phase` constrained to the 5 canonical phase keys
  (tasks.stage_key had accumulated 12 vocabularies; 40 rows null).
- Prompt: PHASES catalog (definitions + "choose by which city process the
  work serves"); section headings count as property evidence; status-reports
  UPDATE the tracking task; settled scope-allocations ARE decisions.
- Routing (lib/proposals.ts): project resolved per item; create with no
  resolvable project → `task_create` review proposal (NEVER silently
  dropped); hallucinated existing_id → fuzzy fallback; update claim with no
  match → task_create proposal at 0.4; in-batch create dedup key is
  project-scoped (SM + Rinconia legitimately both "retain civil engineer");
  proposals carry `title` for the inbox.
- Apply: no early return; document keeps project_id null when multi-project;
  vendor_hours (NOT NULL project) skip loudly when unresolvable.

**Re-run of doc a951fbf5 (old → new):**

| metric | old run | new run |
|---|---|---|
| items applied | **0 (all discarded)** | 4 tasks + 15 proposals |
| projects attributed | — | 4/4 correct, per item |
| existing-task updates | 0 | 8 proposals, all with real targets @0.8 |
| stage_key | — | canonical only (plan_check ×2, planning ×1, 1 honest null) |
| blockers w/ quotes | 0 | 3 (Blair PC expiry, SM civil, AM notices) |
| decisions | 0 | 1 — the surveyor/civil scope split (was a round-1 miss) |
| Rinconia intake status | missed in dry run | now updates "Track the completeness review Ref #308694" |

**Residual (accepted for now):**
- "Authorize resubmittal fees if extension denied" created new beside open
  "PC Extension Approval for Blair" — arguably distinct deliverables; Noa's
  merge-or-keep ruling is exactly the signal iteration 2 learns from.
- Aug-25 planning submittal date and "geotech corrections underway" are
  status facts with no ask — not captured as tasks (defensible).
- task_update proposals carry no evidence quote (only blockers/deadlines/
  relationships require one) — candidate for iteration 2.

**15 proposals now sit pending in /inbox for Noa.** Her decisions there are
real review work AND the iteration-2 training set.

## Iteration 1.5 — summary + raw-transcript BUNDLE (`877766b` + `39b1c4f`, deployed)

Dor's twist: the Aug-24 summary has a parent — the raw 45-minute Teams
transcript (`Weekly LA Team Meeting (10).docx`, 41.6K chars, spoken, messy).
The two complement each other: the summary is curated intent, the transcript
carries owners, dates, amounts, timeline estimates and the verbatim quotes.

Shipped:
- `lib/bundle.ts` — orderBundle (name hints, then length) + bundleCommunication
  (marked merge: summary first, transcript second) + isBundleableName.
- `/api/upload` accepts TWO `file` entries: both .txt/.docx → one merged
  document (`upload:bundle:<A>:<bytes>+<B>:<bytes>` dedup key), one agent
  pass, result type `transcript_bundle`. Single file unchanged.
- Dropzone: `multiple`, drop/select two files → one request; result card
  "סיכום + תמלול עובדו יחד כפגישה אחת" (`upload.result_bundle`).
- Prompt: BUNDLED COMMUNICATION rules — summary decides WHICH items exist,
  transcript enriches + may add clearly-actionable items; small talk is
  never data ("I hate <vendor>", car chat filtered — verified).
- `stage_key`/`blocks_phase` required-nullable: on the 47K bundle the model
  skipped every optional stage_key (0/15); forcing the field fixed it
  (13/13 updates carried canonical stages on the next run).

Real bundle run → document `a59b42a4`: 1 task (SM geotech corrections —
genuinely new; the dry run had over-matched it onto Bob's soils-addendum
task, the real run correctly created) + 24 proposals: 13 task updates
(all 4 projects, canonical stages, transcript enrichment like "expects
word today/tomorrow", "~2-3 business days", Rafael-email-before-DocuSign),
2 blockers, 3 decisions (scope split, hold-structural, Carlos terms final),
1 deadline (Planning submittal → 2026-08-25 — a round-1 miss), 4
relationships, and the transcript-only ISA status-table ask as a
project-less task_create for review. The 15 summary-only proposals were
marked `ignored` (superseded) so Noa's inbox holds ONE coherent set.

## Iteration 1.6 — the Aug-3 pair (`1239dd2`, deployed)

Second pair from Dor: `8326 Internal Meeting Summary .pdf` ("8326" = the
DATE 8/3/26 — Noa's summary email, PDF export, @tags and open questions) +
`Weekly LA Team Meeting (8).docx` (the Aug-3 meeting itself, 4 hours,
49.6K chars). Note: OLDER than the Aug-24 meeting already in the system —
updates go through review, so stale data is human-gated.

Run 1 (doc `aa46e4ce`): 10 tasks + 24 proposals + the URGENT Blair draft
(PC expires 9/1, no filing appointment) + a vendor-quote-in-vendor_hours
oddity ($6K/$10K civil quotes with hours=0). Found:
- **BUG — cross-project existing_id**: model handed San Marco's landscape
  task id for a Rinconia item and Rinconia's designer id for an Alta Mesa
  item (the exact near-twin pairs Noa ruled `unrelated`). The
  hallucination guard checked existence, not project consistency.
- **MISS**: the Serena alignment meeting ("coordinate it ASAP") was not
  extracted. Interpersonal sensitivity likely suppressed it.
- **GAP**: the product bundle branch rejected .pdf — this real pair could
  not have been uploaded through the UI.

Fixes (all in `1239dd2`):
- routing: existing_id on ANOTHER project than the item's own attribution
  is rejected → same-project fuzzy → review proposal. Test added.
- prompt: a scheduling ask IS a task, neutral title, concern in the
  description.
- lib/pdf.ts (pdf-parse deep import — package root runs debug file reads
  under bundling and kills the build); .pdf bundleable; meeting tab accepts
  .pdf; single PDFs still go to the invoice agent.

Guarded re-run (round-1 proposals marked ignored): +4 tasks (Serena
expedite-intake, verify property lines, call structural re stamped plans,
reach Amin) + 37 proposals. Verified: Landscape→Rinconia, ID→Alta Mesa,
"Schedule alignment meeting with Serena re payments and expediting"
(neutral wording), deadline 2026-09-08 on the filing-appointment task,
decisions incl. "No ZAD required for Rinconia", ZAD dependency chain.

Residuals (accepted): "Reach Amin to schedule topo" is a near-dup of an
existing open task (fuzzy scored under 0.55 — the /work duplicate list
will offer the pair); two Dennis follow-up creates overlap (both in
review); two stage misjudgments (Carlos kickoff → construction, AM civil
→ bidding) — iteration-2 learning material; vendor quotes need a home
that isn't vendor_hours.

## Iteration 1.7 — re-upload identity + duplicate suppression (`cec2c08`, deployed)

Dor: "re-upload the same file — do we know? same file with additions — do
we take only the additions?"

- **Migration 0021** (applied + ledgered; 0018/0019 also backfilled into
  supabase_migrations.schema_migrations — 0015-0017 are intentionally
  unapplied, 0020 belongs to the profile session): `documents.content_hash`.
  ingestDocument dedups on external_id then content_hash. Route hashes the
  extracted text (bundle = merged text; PDFs/sheets/mp4 = bytes). PROBE
  passed: Aug-3 bundle content under invented filenames → `deduped:true`,
  nothing written.
- **filterDuplicateProposals** (three passes): exact keys → token-overlap
  fuzzy (blockers/decisions/relationships/creates, 0.6) → task-update
  facts-equal rule (due/status equal, owner/waiting only CONFLICT blocks,
  0.6 text overlap). A moved date, a done status, a different owner always
  pass. Plus: a create with ≥0.65 same-project title containment against an
  open task becomes a 0.5 task_update proposal — never a duplicate task
  (run 3 created "Retain civil engineer for grading at San Marco" beside
  the existing SM civil task; deleted, guard added).
- **Measured** on repeated re-processing of the Aug-3 bundle:
  skipped 2 → 6 → 15 → 25, kept 8 genuine fact-deltas, 0 duplicate tasks.
- Cleanup: the test-run proposal surplus (runs 3-6) marked ignored — Noa's
  queue remains the 10:10 set of 37.

Answer to the question: identical file (same name or renamed) → caught at
ingest, agent never runs. Extended file → new document, agent runs on all
of it, but items land as updates on existing tasks, re-asserted claims are
suppressed, and only genuine additions/changed facts reach the inbox.

## Iteration 2 — planned, NOT started

- Sub-stage mapping: the 45 substage_templates (5 phases) into the prompt;
  agent proposes a substage per task; server resolves to
  substage_template_id.
- Learning loop: every Noa ruling (accept/reject/edit/changeType, merges,
  task moves) already lands in activity_log with `review:*` actions — inject
  the recent rulings into the SYSTEM prompt as worked examples ("this is how
  Noa decided") so the agent converges without fine-tuning.
- Legacy stage_key cleanup: map the 12 dialects ('entitlements', 'Legal',
  'feasibility', …) onto the canonical 5 or park them.
- task_update proposals get evidence quotes.

## Notes

- Local runner for the loop (scratchpad): `dump-docx.mjs` (mammoth, same as
  product), `dry-extract.mjs` (agent only, no writes), `run-reprocess.mjs`
  (real processDocument against prod). Node 24 `--conditions=react-server`
  neutralizes `server-only`; `--env-file=.env.local`.
- Concurrent session warning: at commit time the tree carried an unrelated
  in-progress profile feature (migration 0020, chrome header deletions
  staged). Committed ONLY the five agent files; restored the other session's
  staged deletions afterwards.
