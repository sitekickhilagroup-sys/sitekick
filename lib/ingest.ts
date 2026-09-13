import type { SupabaseClient } from '@supabase/supabase-js';
import { extractComms, applyExtractResult, EXTRACT_COMMS_PROMPT_VERSION } from '../agents/extract-comms.ts';
import { parseInvoice, applyInvoiceParse } from '../agents/parse-invoice.ts';
import { loadRejectedPatterns } from './auto-triage.ts';
import {
  loadVerifiedNotes, loadMatchDecisions, renderVerifiedNotes, renderMatchDecisions,
} from './feedback-context.ts';
import { selectOpenTasksExcludingTest } from './open-tasks.ts';
import { MODELS, type BudgetScope } from './claude.ts';
import type { DocKind, DocSource, Project, Task, Vendor } from './types.ts';

export interface IngestInput {
  kind: DocKind;
  source: DocSource;
  external_id?: string | null;
  /** sha256 of the extracted content — catches the same file re-uploaded
   *  under another name, which the name+size external_id misses. */
  content_hash?: string | null;
  project_hint?: string | null;
  raw_text?: string | null;
  storage_path?: string | null;
}

export interface IngestOutcome {
  documentId: string | null;
  deduped: boolean;
  /** Only meaningful when deduped: was the EXISTING row already processed,
      or did a prior attempt stop after storing but before processing ran? */
  processed: boolean;
}

// Every raw input lands in documents first; dedup on external_id, then on
// content_hash (same file, different name — the external_id encodes name+size
// so a rename slips past it).
export async function ingestDocument(
  admin: SupabaseClient,
  input: IngestInput,
): Promise<IngestOutcome> {
  if (input.external_id) {
    const { data: existing } = await admin
      .from('documents')
      .select('id, processed_at')
      .eq('external_id', input.external_id)
      .maybeSingle();
    if (existing) return { documentId: existing.id, deduped: true, processed: existing.processed_at != null };
  }
  if (input.content_hash) {
    const { data: existing } = await admin
      .from('documents')
      .select('id, processed_at')
      .eq('content_hash', input.content_hash)
      .limit(1)
      .maybeSingle();
    if (existing) return { documentId: existing.id, deduped: true, processed: existing.processed_at != null };
  }
  const { data, error } = await admin
    .from('documents')
    .insert({
      kind: input.kind,
      source: input.source,
      external_id: input.external_id ?? null,
      content_hash: input.content_hash ?? null,
      raw_text: input.raw_text ?? null,
      storage_path: input.storage_path ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`document insert failed: ${error?.message}`);
  return { documentId: data.id, deduped: false, processed: false };
}

// Route a stored document through the right agent.
export async function processDocument(
  admin: SupabaseClient,
  doc: {
    id: string; kind: DocKind; raw_text?: string | null; pdf_base64?: string; project_hint?: string | null;
    /** documents.received_at — threaded to extractComms as the anchor for
     *  resolving relative dates ("end of week"), so a document processed
     *  again later (a retried import-queue batch) resolves them the same
     *  way as the first attempt would have. Omitted callers (a document
     *  being processed for the first time, right after creation) fall back
     *  to the real current date, which is correct for them too. */
    received_at?: string;
    /** Explicit reason to resend a document to the model even though it
     *  already succeeded under the current prompt_version + model (Cost
     *  Controls Release 1, step 2). Every current caller processes a
     *  document exactly once, right after creation, so this guard is a
     *  no-op for them today — it exists for a future deliberate reprocess
     *  action, which must set this rather than silently resending. */
    force?: boolean;
    /** Demo Safety Gate: a caller-scoped sub-budget (e.g. the Data Inbox
     *  pilot's $2 across up to 5 documents) — forwarded to whichever agent
     *  runs below, and on to runStructured, which enforces it against the
     *  real payload and accumulates the real post-call cost into it. See
     *  lib/claude.ts's BudgetScope. */
    budgetScope?: BudgetScope;
  },
): Promise<unknown> {
  if (doc.kind !== 'invoice_pdf' && !doc.force) {
    const { data: existing } = await admin
      .from('documents')
      .select('processed_at, prompt_version, extract_model')
      .eq('id', doc.id)
      .maybeSingle();
    if (
      existing?.processed_at
      && existing.prompt_version === EXTRACT_COMMS_PROMPT_VERSION
      && existing.extract_model === MODELS.extract
    ) {
      return { skipped: true, reason: 'already succeeded under current prompt_version and model' };
    }
  }

  const [projectsQ, tasksQ, vendorsQ] = await Promise.all([
    // city_case and address ride along for extract-comms' project-attribution
    // rules AND its deterministic project identification (Cost Controls
    // Release 1, step 3) — a case number or address fragment in an email is
    // often the only property evidence.
    admin.from('projects').select('id,name,city_case,address'),
    selectOpenTasksExcludingTest(admin),
    admin.from('vendors').select('id,name'),
  ]);
  const projects = (projectsQ.data ?? []) as (Pick<Project, 'id' | 'name'> & { city_case?: string | null; address?: string | null })[];
  const openTasks = (tasksQ.data ?? []) as Task[];
  const vendors = (vendorsQ.data ?? []) as Pick<Vendor, 'id' | 'name'>[];

  if (doc.kind === 'invoice_pdf') {
    const parse = await parseInvoice(
      { id: doc.id, raw_text: doc.raw_text, pdf_base64: doc.pdf_base64 },
      { projects, vendors, budgetScope: doc.budgetScope },
    );
    return applyInvoiceParse(admin, doc.id, parse, { projects });
  }

  // Source-side learning: titles the team explicitly dismissed ride into the
  // prompt so the same noise stops being produced at all. Plus feedback in use
  // (kill-switched): human-confirmed facts and reviewers' match decisions —
  // both loaders return empty when FEEDBACK_USE is off, so this is a no-op then.
  const [rejectedPatterns, verifiedNotes, matchDecisions] = await Promise.all([
    loadRejectedPatterns(admin),
    loadVerifiedNotes(admin, openTasks.map((t) => t.id)),
    loadMatchDecisions(admin),
  ]);
  const result = await extractComms(
    { id: doc.id, project_hint: doc.project_hint, raw_text: doc.raw_text ?? '', received_at: doc.received_at },
    {
      projects, openTasks, rejectedPatterns,
      verifiedNotesBlock: renderVerifiedNotes(verifiedNotes),
      matchDecisionsBlock: renderMatchDecisions(matchDecisions),
      budgetScope: doc.budgetScope,
    },
  );
  // Trust boundary: email (forwarded, polled, or an uploaded archive of
  // external mail) is attacker-controllable content — its new tasks go to the
  // review queue, never a direct live insert. Staff-authored transcripts/notes
  // (kind !== 'email') keep the existing one-step auto-create.
  return applyExtractResult(admin, doc.id, result, {
    projects, openTasks, allowAutoCreate: doc.kind !== 'email', docReceivedAt: doc.received_at,
  });
}
