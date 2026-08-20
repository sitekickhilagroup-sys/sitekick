import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { runStructured } from '../lib/claude.ts';
import type { Project, Vendor } from '../lib/types.ts';
import { InvoiceParseSchema, type InvoiceParse } from './schemas.ts';
import { laToday } from '../lib/date.ts';

const SYSTEM = `You parse construction/consulting invoices for Hilla Group (LA real-estate developer).
Extract the vendor, project, invoice number, amount in USD, and dates.
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
): Promise<{ invoice_id: string | null }> {
  const project = parse.project_name
    ? ctx.projects.find((p) => p.name === parse.project_name) ?? null
    : null;
  if (!project) return { invoice_id: null };

  const { data: vendor } = await admin.from('vendors')
    .upsert({ name: parse.vendor_name }, { onConflict: 'name' })
    .select('id').single();

  const { data: invoice } = await admin.from('invoices').upsert({
    project_id: project.id,
    vendor_id: vendor?.id ?? null,
    document_id: docId,
    number: parse.number,
    amount_usd: parse.amount_usd,
    invoice_date: parse.invoice_date ?? null,
    received_date: parse.received_date ?? laToday(),
    status: 'received',
    tab: 'invoices',
  }, { onConflict: 'vendor_id,number' }).select('id').single();

  await admin.from('documents').update({
    processed_at: new Date().toISOString(),
    project_id: project.id,
  }).eq('id', docId);

  return { invoice_id: invoice?.id ?? null };
}
