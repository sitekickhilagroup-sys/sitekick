// Demo Safety Gate — Data Inbox triage + manual-selection-only processing.
// Testable core logic (takes `admin` explicitly, same split as
// lib/import-queue.ts / app/actions/import-queue.ts); the 'use server'
// wrapper (app/actions/data-inbox.ts) just adds requireUser() + a real
// supabaseAdmin(), matching the existing pattern in this codebase.
import type { SupabaseClient } from '@supabase/supabase-js';
import { processDocument } from './ingest.ts';
import { runPreflight, type PreflightResult, type PreflightGroup } from './preflight.ts';
import { estimateCallCostUsd, MODELS, BudgetExceededError } from './claude.ts';
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

const TRIAGE_LIMIT = 200; // a real demo backlog, not "unbounded growth forever"

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
}

export interface DataInboxTriage {
  do_not_process: TriageDocument[];
  needs_selection: TriageDocument[];
  candidate: TriageDocument[];
}

/** The three-group triage view (Demo Safety Gate item 2) — filtering, not a
 *  business decision: every group is derived from lib/preflight.ts's
 *  deterministic signals alone, nothing here reads document content with a
 *  model. */
export async function getDataInboxTriage(admin: SupabaseClient): Promise<DataInboxTriage> {
  const [docsQ, projectsQ] = await Promise.all([
    admin.from('documents')
      .select('id,kind,source,storage_path,raw_text,received_at')
      .is('processed_at', null)
      .order('received_at', { ascending: false })
      .limit(TRIAGE_LIMIT),
    admin.from('projects').select('id,name,city_case,address'),
  ]);
  const projects = (projectsQ.data ?? []) as ProjectMatchCandidate[];
  const docs = (docsQ.data ?? []) as {
    id: string; kind: DocKind; source: string; storage_path: string | null;
    raw_text: string | null; received_at: string;
  }[];

  const result: DataInboxTriage = { do_not_process: [], needs_selection: [], candidate: [] };
  for (const doc of docs) {
    const preflight = runPreflight(doc, projects);
    const name = doc.storage_path?.split('/').pop() ?? doc.source;
    const entry: TriageDocument = { id: doc.id, kind: doc.kind, source: doc.source, received_at: doc.received_at, name, preflight };
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
 * enforced here too. On top of that, tracks its OWN running cost estimate
 * across this invocation and stops selecting further documents once
 * PILOT_BUDGET_USD ($2) would be exceeded — a tighter, per-run sub-cap
 * layered on top of runStructured's unconditional, global DEMO_BUDGET_USD
 * ($20) cap, which still applies to every one of these calls regardless.
 * Every stop this makes (pilot cap or the global cap tripping inside
 * runStructured) is recorded per-document, never a silent skip.
 */
export async function processSelectedDocuments(admin: SupabaseClient, documentIds: string[]): Promise<PilotRunResult> {
  if (documentIds.length === 0) return { attempted: 0, succeeded: 0, failed: 0, budgetBlocked: 0, perDocument: [] };
  if (documentIds.length > PILOT_MAX_DOCS) {
    throw new Error(`Pilot processing is capped at ${PILOT_MAX_DOCS} documents (got ${documentIds.length})`);
  }

  const { data: rows } = await admin
    .from('documents')
    .select('id,kind,raw_text,storage_path,received_at,processed_at')
    .in('id', documentIds);
  const docs = (rows ?? []) as {
    id: string; kind: DocKind; raw_text: string | null; storage_path: string | null;
    received_at: string; processed_at: string | null;
  }[];
  const byId = new Map(docs.map((d) => [d.id, d]));

  const perDocument: PilotDocResult[] = [];
  let succeeded = 0, failed = 0, budgetBlocked = 0;
  let pilotSpentEstimateUsd = 0;
  let pilotCapTripped = false;

  for (const id of documentIds) {
    const doc = byId.get(id);
    if (!doc) { perDocument.push({ documentId: id, outcome: 'failed', detail: 'document not found' }); failed++; continue; }
    if (doc.processed_at) { perDocument.push({ documentId: id, outcome: 'failed', detail: 'already processed' }); failed++; continue; }

    if (pilotCapTripped) {
      perDocument.push({
        documentId: id, outcome: 'budget_blocked',
        detail: `pilot budget ($${PILOT_BUDGET_USD}) already reached this run — remaining selections skipped`,
      });
      budgetBlocked++;
      continue;
    }

    // Pre-call estimate — same estimator runStructured's own global gate
    // uses — checked against the tighter pilot sub-cap BEFORE attempting the
    // call. A PDF has no raw_text to size from yet; 4000 chars is a
    // deliberately generic small-document floor for that case only — the
    // REAL, exact check still happens inside runStructured against the
    // actual request payload (including the PDF bytes) and is what actually
    // blocks an underestimated call.
    const estInputChars = doc.raw_text?.length ?? 4000;
    const estThisCallUsd = estimateCallCostUsd(MODELS.extract, estInputChars, 16000) ?? 0;
    if (pilotSpentEstimateUsd + estThisCallUsd > PILOT_BUDGET_USD) {
      perDocument.push({
        documentId: id, outcome: 'budget_blocked',
        detail: `estimated ~$${estThisCallUsd.toFixed(4)} would exceed the pilot cap ($${PILOT_BUDGET_USD})`,
      });
      budgetBlocked++;
      pilotCapTripped = true;
      continue;
    }
    // Counted against the pilot cap as soon as we commit to attempting the
    // call, not only on success — a call that fails AFTER a real, billed
    // Anthropic request (e.g. extraction succeeded, a later DB write did
    // not) still spent money; under-counting that would let the pilot
    // silently exceed its own budget on a run with partial failures.
    pilotSpentEstimateUsd += estThisCallUsd;

    try {
      if (doc.kind === 'invoice_pdf') {
        if (!doc.storage_path) throw new Error('invoice_pdf has no storage_path');
        const { data: file, error: dlError } = await admin.storage.from('documents').download(doc.storage_path);
        if (dlError || !file) throw new Error(`storage download failed: ${dlError?.message ?? 'no file'}`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await processDocument(admin, { id: doc.id, kind: doc.kind, pdf_base64: buffer.toString('base64'), received_at: doc.received_at });
      } else {
        await processDocument(admin, { id: doc.id, kind: doc.kind, raw_text: doc.raw_text, received_at: doc.received_at });
      }
      succeeded++;
      perDocument.push({ documentId: id, outcome: 'succeeded' });
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        budgetBlocked++;
        pilotCapTripped = true; // the global cap tripped — no point trying the rest this run either
        perDocument.push({ documentId: id, outcome: 'budget_blocked', detail: e.message });
      } else {
        failed++;
        perDocument.push({ documentId: id, outcome: 'failed', detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { attempted: perDocument.length, succeeded, failed, budgetBlocked, perDocument };
}
