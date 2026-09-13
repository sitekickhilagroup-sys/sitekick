// Demo Safety Gate — Data Inbox triage + manual-selection-only processing.
// Testable core logic (takes `admin` explicitly, same split as
// lib/import-queue.ts / app/actions/import-queue.ts); the 'use server'
// wrapper (app/actions/data-inbox.ts) just adds requireUser() + a real
// supabaseAdmin(), matching the existing pattern in this codebase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { processDocument } from './ingest.ts';
import { runPreflight, findBatchDuplicates, type PreflightResult, type PreflightGroup } from './preflight.ts';
import { BudgetExceededError, BudgetUnverifiableError, type BudgetScope } from './claude.ts';
import type { ProjectMatchCandidate } from './project-match.ts';
import type { DocKind } from './types.ts';

// Demo Safety Gate (Rotem, 2026-09-13): the ONLY way a document gets
// processed is a human explicitly selecting it, capped at PILOT_MAX_DOCS per
// invocation. lib/import-queue.ts's FIFO batch/"process all" machinery still
// exists (still budget-gated, since it also goes through processDocument ->
// runStructured) but is no longer wired to a button in Data Inbox — see
// app/(dash)/(focused)/upload/page.tsx.
export const PILOT_MAX_DOCS = 5;
export const PILOT_BUDGET_USD = Number(process.env.DEMO_PILOT_BUDGET_USD ?? 2);

export const TRIAGE_PAGE_SIZE = 200; // a real demo-scale page, not "unbounded growth forever"

export interface TriageDocument {
  id: string;
  kind: DocKind;
  source: string;
  received_at: string;
  /** Recovered from storage_path where a branch stored one, else the source
   *  — documents has no filename column (same recovery upload/page.tsx used
   *  before this rewrite). */
  name: string;
  preflight: PreflightResult;
  /** Set when findBatchDuplicates matched this document's content_hash
   *  against an earlier (by received_at) one in the same rendered batch —
   *  the id to point a "duplicate of" link at. */
  duplicateOfId?: string;
}

export interface DataInboxTriage {
  do_not_process: TriageDocument[];
  needs_selection: TriageDocument[];
  candidate: TriageDocument[];
  /** True count of unprocessed documents, regardless of page size — lets
   *  the UI say honestly "showing N of TOTAL" instead of silently hiding
   *  anything past TRIAGE_PAGE_SIZE (Demo Safety Gate hardening: an
   *  invisible document is its own kind of unreviewed auto-behavior). */
  totalUnprocessed: number;
  /** How many rows this page actually returned — offset + shown tells the
   *  caller whether there's another page to fetch. */
  shown: number;
  offset: number;
}

/** The three-group triage view (Demo Safety Gate item 2) — filtering, not a
 *  business decision: every group is derived from lib/preflight.ts's
 *  deterministic signals alone, nothing here reads document content with a
 *  model. Paged (newest-first, TRIAGE_PAGE_SIZE per page) rather than
 *  silently capped — see totalUnprocessed/shown/offset above. */
export async function getDataInboxTriage(admin: SupabaseClient, offset = 0): Promise<DataInboxTriage> {
  const [docsQ, projectsQ, countQ] = await Promise.all([
    admin.from('documents')
      .select('id,kind,source,storage_path,raw_text,received_at,content_hash')
      .is('processed_at', null)
      .order('received_at', { ascending: false })
      .range(offset, offset + TRIAGE_PAGE_SIZE - 1),
    admin.from('projects').select('id,name,city_case,address'),
    admin.from('documents').select('id', { count: 'exact', head: true }).is('processed_at', null),
  ]);
  const projects = (projectsQ.data ?? []) as ProjectMatchCandidate[];
  const docs = (docsQ.data ?? []) as {
    id: string; kind: DocKind; source: string; storage_path: string | null;
    raw_text: string | null; received_at: string; content_hash: string | null;
  }[];
  const totalUnprocessed = countQ.count ?? docs.length;
  // Defensive layer: a TRUE duplicate should never reach here at all
  // (ingestDocument's own dedup returns the existing row instead of
  // inserting), but this catches anything ingested before every path set
  // content_hash. Overrides every other signal — never a candidate,
  // however clean its project match looks.
  const duplicateOf = findBatchDuplicates(docs);

  const result: DataInboxTriage = {
    do_not_process: [], needs_selection: [], candidate: [],
    totalUnprocessed, shown: docs.length, offset,
  };
  for (const doc of docs) {
    const dupOriginalId = duplicateOf.get(doc.id);
    const preflight = dupOriginalId
      ? { group: 'do_not_process' as const, reasons: ['duplicate' as const], matchedProjectIds: [], sender: null }
      : runPreflight(doc, projects);
    const name = doc.storage_path?.split('/').pop() ?? doc.source;
    const entry: TriageDocument = {
      id: doc.id, kind: doc.kind, source: doc.source, received_at: doc.received_at, name, preflight,
      duplicateOfId: dupOriginalId,
    };
    result[preflight.group as PreflightGroup].push(entry);
  }
  return result;
}

export type PilotOutcome = 'succeeded' | 'failed' | 'budget_blocked';

export interface PilotDocResult {
  documentId: string;
  outcome: PilotOutcome;
  detail?: string;
}

export interface PilotRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  budgetBlocked: number;
  perDocument: PilotDocResult[];
}

/**
 * Manual-selection-only processing (Demo Safety Gate item 3): processes
 * ONLY the documents a human explicitly checked, never "the next N in
 * queue." Hard-capped at PILOT_MAX_DOCS (5) per call — not a UI suggestion,
 * enforced here too.
 *
 * Hardening (Rotem, 2026-09-13, round 2):
 * - Preflight is re-run HERE, server-side, against the SAME projects list
 *   the triage view uses — a document in the `do_not_process` group is
 *   rejected regardless of how its id arrived (the UI's own checkboxes
 *   already disable those, but a request naming the id directly, bypassing
 *   the UI entirely, must be refused the same way).
 * - The pilot's $2 cap is enforced by a single BudgetScope object shared
 *   across every document (and every retry) in this call — passed into
 *   processDocument -> extractComms/parseInvoice -> runStructured, which
 *   checks it against the REAL request payload (system + task list +
 *   document content, not a raw_text-length guess) before every attempt,
 *   and accumulates the REAL post-call cost into it afterward. There is no
 *   separate pre-estimate loop here anymore — runStructured's own check
 *   (real payload) is the only enforcement, so it can't drift out of sync
 *   with what's actually billed.
 */
export async function processSelectedDocuments(admin: SupabaseClient, documentIds: string[]): Promise<PilotRunResult> {
  if (documentIds.length === 0) return { attempted: 0, succeeded: 0, failed: 0, budgetBlocked: 0, perDocument: [] };
  if (documentIds.length > PILOT_MAX_DOCS) {
    throw new Error(`Pilot processing is capped at ${PILOT_MAX_DOCS} documents (got ${documentIds.length})`);
  }

  const [docsQ, projectsQ] = await Promise.all([
    admin.from('documents')
      .select('id,kind,raw_text,storage_path,received_at,processed_at,content_hash')
      .in('id', documentIds),
    admin.from('projects').select('id,name,city_case,address'),
  ]);
  const docs = (docsQ.data ?? []) as {
    id: string; kind: DocKind; raw_text: string | null; storage_path: string | null;
    received_at: string; processed_at: string | null; content_hash: string | null;
  }[];
  const projects = (projectsQ.data ?? []) as ProjectMatchCandidate[];
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Duplicate check against the WHOLE documents table, not just this
  // selection — a selected doc can duplicate something already fully
  // processed elsewhere. One query for every non-null content_hash among
  // the selected docs, keyed by hash so "does ANOTHER row share this" is a
  // simple lookup per document below.
  const hashes = [...new Set(docs.map((d) => d.content_hash).filter((h): h is string => !!h))];
  const byHash = new Map<string, { id: string }[]>();
  if (hashes.length) {
    const { data: hashRows } = await admin.from('documents').select('id,content_hash').in('content_hash', hashes);
    for (const row of (hashRows ?? []) as { id: string; content_hash: string }[]) {
      const list = byHash.get(row.content_hash) ?? [];
      list.push({ id: row.id });
      byHash.set(row.content_hash, list);
    }
  }

  const perDocument: PilotDocResult[] = [];
  let succeeded = 0, failed = 0, budgetBlocked = 0;
  const scope: BudgetScope = { capUsd: PILOT_BUDGET_USD, spentUsd: 0 };
  let scopeTripped = false; // once true, skip remaining docs without even re-attempting (they'd just be blocked again)

  for (const id of documentIds) {
    const doc = byId.get(id);
    if (!doc) { perDocument.push({ documentId: id, outcome: 'failed', detail: 'document not found' }); failed++; continue; }
    if (doc.processed_at) { perDocument.push({ documentId: id, outcome: 'failed', detail: 'already processed' }); failed++; continue; }

    // Duplicate against ANY other document (processed or not) sharing the
    // same content_hash — checked before preflight, since it overrides
    // every other signal (see findBatchDuplicates).
    const otherWithSameHash = doc.content_hash
      ? (byHash.get(doc.content_hash) ?? []).find((r) => r.id !== doc.id)
      : undefined;
    if (otherWithSameHash) {
      perDocument.push({
        documentId: id, outcome: 'failed',
        detail: `rejected: duplicate of document ${otherWithSameHash.id}`,
      });
      failed++;
      continue;
    }

    // Re-run preflight server-side — never trust that an id reaching this
    // function came from the UI's own (already-filtered) selection list.
    const preflight = runPreflight(doc, projects);
    if (preflight.group === 'do_not_process') {
      perDocument.push({
        documentId: id, outcome: 'failed',
        detail: `rejected: in the do-not-process group (${preflight.reasons.join(', ')})`,
      });
      failed++;
      continue;
    }

    if (scopeTripped) {
      perDocument.push({
        documentId: id, outcome: 'budget_blocked',
        detail: `pilot budget ($${PILOT_BUDGET_USD}) already reached this run — remaining selections skipped`,
      });
      budgetBlocked++;
      continue;
    }

    try {
      if (doc.kind === 'invoice_pdf') {
        if (!doc.storage_path) throw new Error('invoice_pdf has no storage_path');
        const { data: file, error: dlError } = await admin.storage.from('documents').download(doc.storage_path);
        if (dlError || !file) throw new Error(`storage download failed: ${dlError?.message ?? 'no file'}`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await processDocument(admin, { id: doc.id, kind: doc.kind, pdf_base64: buffer.toString('base64'), received_at: doc.received_at, budgetScope: scope });
      } else {
        await processDocument(admin, { id: doc.id, kind: doc.kind, raw_text: doc.raw_text, received_at: doc.received_at, budgetScope: scope });
      }
      succeeded++;
      perDocument.push({ documentId: id, outcome: 'succeeded' });
    } catch (e) {
      if (e instanceof BudgetExceededError || e instanceof BudgetUnverifiableError) {
        budgetBlocked++;
        scopeTripped = true; // either cap tripped (or spend became unverifiable) — no point trying the rest this run
        perDocument.push({ documentId: id, outcome: 'budget_blocked', detail: e.message });
      } else {
        failed++;
        perDocument.push({ documentId: id, outcome: 'failed', detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { attempted: perDocument.length, succeeded, failed, budgetBlocked, perDocument };
}
