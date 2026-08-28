# Noa's answers + Rotem's round — executed 2026-08-27 (evening)

Everything below is deployed (`5b7e979` → `979d7b6` → `02f7829`) and applied to prod data.
Full pre-change backup: session scratchpad `invoices-backup-2026-08-27.json` (104 rows).

## Code shipped

| Commit | What |
|---|---|
| `5b7e979` | Migration 0018 — invoice identity (vendor, number, entity) per Noa Q7; `service_month` (Q10); import matches explicitly instead of blind upsert; link-column URL guard; matchProject handles number-ranges/street suffixes (Rinconia) |
| `979d7b6` | Rotem 03: /invoices 500 — function props into client components (Next 16); Rotem 04: verb menu clipped by `overflow-hidden`, not missing; Rotem 14: finalized fields get a real disabled look; Noa Q12: RTI-progress ordering (`lib/project-order.ts`), /projects lands on the most advanced project |
| `02f7829` | Import matches by canonical vendorKey, not raw vendor_id (vendor punctuation twins created 20 invoice duplicates; cleaned) |

## Data pass (prod, via Management API — each change one statement)

- **Q1+Q2+Q3 merges**: 11 pairs folded (General → project side), `status='merged'` + `merged_into`; +3 pairs Dor merged live in the /work UI (total 14). Gap-fill: 2 document_id copies. Landscape SM↔Rinconia marked `unrelated` (Q3).
- **Q2**: Rinconia civil-engineer task retitled `Retain civil engineer for Rinconia grading`.
- **Q4+Q6**: owner canon applied everywhere — Abhi (Crest) / Rowan (Premise) / Refael / Serena (ReDefined); arrows split into owner + waiting_for.
- **B1 backfill**: 47 open tasks assigned to 20 substage templates by content (Noa's core complaint — was 0/106).
- **Q12**: business_rank recomputed to RTI order — Blair 1, Rinconia 2, San Marco 3, Alta Mesa 4, Flicker null. QA residue reset: SM "Entitlement granted" → waiting.
- **Invoices import**: Noa's sheet, 98 rows via the same logic as the product path (auth-gated route). Result validated EXACTLY against her Dashboard: sheet-sourced rows = 35 open / $86,037.76.
- **Cleanup**: Thang Le ×4 deleted (Q8); 20 vendor-twin duplicates deleted; transfer_confirmation_url==invoice_url cleared. Final count: 100 invoices (95 sheet + 5 awaiting Noa).

## Open items

- **Noa**: Q5 ("—" owners) still unanswered; 9 paid-without-date rows; 5 system-only invoices to keep/kill; ops-tracker owner spellings must be canonized before its next upload (import would overwrite the canon).
- **Rotem**: round-2 doc covers everything; SM "Appraisal (waiting)" instance awaiting her confirm-reset.
- **paid delta**: sheet-sourced paid $109,166 vs her Dashboard $114,779 — likely her Dashboard formula counts beyond the Invoices tab; with Noa.
- **OLM archive**: 605MB > 20MB upload cap — needs an offline ingest path.
- ~~**Security (low)**: proxy.ts prefetch auth skip~~ — closed 2026-08-28 (`b8205a5`): the exemption predated getClaims (local JWKS verify), removed entirely; prefetch-headed requests now 307 to /login on prod.
- **audit trail**: activity_log inserts for this data pass were blocked by the session's permission classifier — this file + the JSON backup are the ledger. undoMerge falls back to 'open' correctly for the 11 script merges.
- ~~UI merge `eabc1ae2 (interior designer) → 107eb421 (retain engineer)`~~ — un-merged 2026-08-28 per Dor (actor was actually Noa, 2026-08-27 20:25 UTC — the near-identical titles baited the dedup list). Loser restored from the audit entry's before_json; survivor needed no unwind; pair marked `unrelated` so it never re-offers.

## Artifacts

- Noa: https://claude.ai/code/artifact/f91435db-174d-42f1-b864-8b8defcbc04f
- Rotem: https://claude.ai/code/artifact/b7e72651-8ac6-4d91-8aca-0a26c73d0247

## Round 3 (2026-08-28) — commit 4f9830e

Inputs: Rotem's QA docx (all 27 items pass; 2 leftovers) + Noa's
sitekickreport.html (15 items: 3 critical, 4 structure, 6 agent, 3 asks).

Shipped (all in 4f9830e, migration 0019 applied to prod):
- Reopen: /work "Completed" tab (last 100 closed, done+dropped) + reopenTask
  with undo. VerbMenu: 350ms double-click guard + armed confirm on
  completed/not_applicable.
- Sub-stages: upcoming instance stays visible with note (bank bounce fixed);
  manual reorder arrows (project_substages.position, ±5 between ×10 library
  slots, computed server-side via computeSubstageMove); depends_on field +
  list line; done chip solid green; add-substage input on every phase's bank
  (Bidding gap); sub-stage eyebrow above titles in My Work.
- Invoices: status 'cancelled' (enum 0019) — off-chain, out of open totals.
  PREMISE INV-100A + ABC set to cancelled (hard DELETE blocked by permission
  classifier; cancel achieves Rotem's intent, rows auditable). Header back
  to 35 / $86,037.76.
- Agents: attribution from property evidence only (vendor never attributes;
  city_case now in the prompt's project list); blocking = stops-a-stage;
  task titles are actions, never stage names; waiting_for from this
  project's text only; evidence quotes REQUIRED on blocker/deadline/
  relationship claims and carried to evidence_excerpt (was hardcoded null);
  in-batch create dedupe (triple-LID class).
- Data: Blair + 'Design / Engineering' workstream (plan_check).

Open / deferred:
- Hard-delete of the 2 cancelled PREMISE rows — needs Dor (classifier).
- Structured dependencies (depends_on is free text by design for now).
- Noa's per-substage explanations she typed into notes stay as-is.
