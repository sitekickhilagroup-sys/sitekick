import type { SupabaseClient } from '@supabase/supabase-js';
import { extractComms, applyExtractResult } from '../agents/extract-comms.ts';
import { parseInvoice, applyInvoiceParse } from '../agents/parse-invoice.ts';
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
  doc: { id: string; kind: DocKind; raw_text?: string | null; pdf_base64?: string; project_hint?: string | null },
): Promise<unknown> {
  const [projectsQ, tasksQ, vendorsQ] = await Promise.all([
    // city_case rides along for extract-comms' project-attribution rules —
    // a case number in an email subject is often the only property evidence.
    admin.from('projects').select('id,name,city_case'),
    admin.from('tasks').select('*').eq('status', 'open'),
    admin.from('vendors').select('id,name'),
  ]);
  const projects = (projectsQ.data ?? []) as (Pick<Project, 'id' | 'name'> & { city_case?: string | null })[];
  const openTasks = (tasksQ.data ?? []) as Task[];
  const vendors = (vendorsQ.data ?? []) as Pick<Vendor, 'id' | 'name'>[];

  if (doc.kind === 'invoice_pdf') {
    const parse = await parseInvoice(
      { id: doc.id, raw_text: doc.raw_text, pdf_base64: doc.pdf_base64 },
      { projects, vendors },
    );
    return applyInvoiceParse(admin, doc.id, parse, { projects });
  }

  const result = await extractComms(
    { id: doc.id, project_hint: doc.project_hint, raw_text: doc.raw_text ?? '' },
    { projects, openTasks },
  );
  return applyExtractResult(admin, doc.id, result, { projects, openTasks });
}
