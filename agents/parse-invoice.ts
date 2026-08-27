import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { runStructured } from '../lib/claude.ts';
import type { Project, Vendor } from '../lib/types.ts';
import { InvoiceParseSchema, type InvoiceParse } from './schemas.ts';
import { laToday } from '../lib/date.ts';

const SYSTEM = `You parse documents for Hilla Group (LA real-estate developer).

STEP 1 — classify document_kind. Only a document that actually BILLS money
(an invoice number or "amount due" / "please remit") is an 'invoice'.
A contract or executed agreement is 'contract'. A fee proposal or quote is
'proposal'. A city permit, hold letter, or agency correspondence is
'permit_or_letter'. Anything else is 'other'. A contract's total value is
NOT an amount due — never report it as one.

STEP 2 — extract the vendor, project, invoice number, amount in USD, and
dates. For a non-invoice, still name the vendor/project when clear, set
number to null and amount_usd to 0.

Match project_name to the provided list; null when unclear.
Dates as YYYY-MM-DD. amount_usd is the total due. Never invent values.`;

export interface InvoiceContext {
  projects: Pick<Project, 'id' | 'name'>[];
  vendors: Pick<Vendor, 'id' | 'name'>[];
  client?: Anthropic;
}

export async function parseInvoice(
  doc: { id: string; raw_text?: string | null; pdf_base64?: string },
  ctx: InvoiceContext,
): Promise<InvoiceParse> {
  const projectList = ctx.projects.map((p) => `- ${p.name}`).join('\n');
  const vendorList = ctx.vendors.map((v) => `- ${v.name}`).join('\n');
  const preamble = `PROJECTS:\n${projectList}\n\nKNOWN VENDORS (reuse exact names when they match):\n${vendorList}\n\nINVOICE:`;

  const content: Anthropic.ContentBlockParam[] = doc.pdf_base64
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.pdf_base64 } },
        { type: 'text', text: preamble },
      ]
    : [{ type: 'text', text: `${preamble}\n${doc.raw_text ?? ''}` }];

  return runStructured({
    job: 'extract',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    schema: InvoiceParseSchema,
    toolName: 'report_invoice',
    toolDescription: 'Report the parsed invoice fields.',
    client: ctx.client,
  });
}

export async function applyInvoiceParse(
  admin: SupabaseClient,
  docId: string,
  parse: InvoiceParse,
  ctx: { projects: Pick<Project, 'id' | 'name'>[] },
): Promise<{ invoice_id: string | null; document_kind: InvoiceParse['document_kind'] }> {
  const project = parse.project_name
    ? ctx.projects.find((p) => p.name === parse.project_name) ?? null
    : null;

  // A contract, proposal, permit, or letter is stored as a document — it must
  // never become an invoices row. This is exactly how five phantom "invoices"
  // (a $37K proposal among them) landed in the payment view on 2026-08-23.
  if (parse.document_kind !== 'invoice') {
    await admin.from('documents').update({
      processed_at: new Date().toISOString(),
      ...(project ? { project_id: project.id } : {}),
    }).eq('id', docId);
    return { invoice_id: null, document_kind: parse.document_kind };
  }

  if (!project) {
    // Same reasoning as applyExtractResult: the agent read the invoice and
    // genuinely found no project match — a real outcome, not a stalled one —
    // so it's stamped processed rather than left to read as never processed
    // on a later dedup hit.
    await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', docId);
    return { invoice_id: null, document_kind: parse.document_kind };
  }

  const { data: vendor } = await admin.from('vendors')
    .upsert({ name: parse.vendor_name }, { onConflict: 'name' })
    .select('id').single();

  // Was an upsert on (vendor_id, number) — a conflict target 0018 removed, so
  // every agent insert had been failing silently (the error was never read).
  // Agent-created rows now INSERT flagged needs_verification, same policy as
  // Add Invoice's uncertain paths: a human confirms before the row is trusted.
  const { data: invoice, error } = await admin.from('invoices').insert({
    project_id: project.id,
    vendor_id: vendor?.id ?? null,
    document_id: docId,
    number: parse.number,
    amount_usd: parse.amount_usd,
    invoice_date: parse.invoice_date ?? null,
    received_date: parse.received_date ?? laToday(),
    status: 'received',
    tab: 'invoices',
    needs_verification: true,
  }).select('id').single();
  if (error) {
    // A duplicate under 0018's (vendor, number, entity) key or any other
    // insert failure: keep the document, surface nothing false.
    await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', docId);
    return { invoice_id: null, document_kind: parse.document_kind };
  }

  await admin.from('documents').update({
    processed_at: new Date().toISOString(),
    project_id: project.id,
  }).eq('id', docId);

  return { invoice_id: invoice?.id ?? null, document_kind: parse.document_kind };
}
