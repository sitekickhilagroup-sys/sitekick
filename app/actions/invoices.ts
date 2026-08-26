'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import {
  buildInvoiceRow, canonVendorName, findExactInvoiceDuplicate, findSuspectedInvoiceDuplicate,
  INVOICE_ERRORS, INVOICE_ROW_COLUMNS, validateInvoicePatch, vendorGroupKey,
  type InvoiceDupCandidate, type InvoicePatch,
} from '@/lib/invoice-rules';
import type { Invoice, InvoiceStatus } from '@/lib/types';

export type { InvoicePatch };

const CHAIN: InvoiceStatus[] = ['received', 'for_rowan_approval', 'approved', 'paid'];

export async function advanceInvoice(invoiceId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: inv } = await admin.from('invoices').select('status').eq('id', invoiceId).single();
  if (!inv) return;
  const idx = CHAIN.indexOf(inv.status as InvoiceStatus);
  if (idx === -1 || idx === CHAIN.length - 1) return;
  const next = CHAIN[idx + 1];
  const patch: Record<string, unknown> = { status: next };
  if (next === 'paid') patch.paid_date = laToday();
  const { error } = await admin.from('invoices').update(patch).eq('id', invoiceId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id, action: 'advance', after: patch });
  revalidatePath('/invoices');
  return { ok: true };
}

// Spec §יב: the Update Invoice editor — grown by E2 from status/paid-date/
// links/notes into the full row (Vendor, Invoice no., Project, Entity,
// Received date, Description, Amount join the same one save). Whitelist ->
// validate (E3's paid/payment-date rules included) -> update -> audited log,
// same shape as updateTaskDetails in app/actions/tasks.ts. This replaces the
// old updateInvoiceDetails, which only ever covered a subset of these columns
// and had no before-snapshot or undo.
export async function updateInvoice(invoiceId: string, patch: InvoicePatch): Promise<{ error: string } | { ok: true; undoId: string | null }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before } = await admin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!before) return { error: INVOICE_ERRORS.notFound };

  const validation = validateInvoicePatch(before as Invoice, patch);
  if ('error' in validation) return validation;

  const row = buildInvoiceRow(patch);
  if (Object.keys(row).length === 0) return { error: INVOICE_ERRORS.emptyPatch };

  const { error } = await admin.from('invoices').update(row).eq('id', invoiceId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id,
    action: 'edit', before, after: row,
  });
  revalidatePath('/invoices');
  return { ok: true as const, undoId };
}

/** Restores the invoice snapshot taken before updateInvoice's patch applied —
 *  same pattern as undoWorkVerb in app/actions/work.ts, scoped to invoices'
 *  own whitelist of columns (INVOICE_ROW_COLUMNS) and entity_type. */
export async function undoInvoiceEdit(logId: string): Promise<{ error: string } | { ok: true }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as { entity_type: string; entity_id: string; before_json: Record<string, unknown> | null } | null;
  if (!entry?.before_json || entry.entity_type !== 'invoice') return { error: INVOICE_ERRORS.nothingToUndo };
  const before = entry.before_json;
  const restore: Record<string, unknown> = {};
  for (const column of INVOICE_ROW_COLUMNS) restore[column] = before[column] ?? null;
  const { error } = await admin.from('invoices').update(restore).eq('id', entry.entity_id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'invoice', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo', after: restore,
  });
  revalidatePath('/invoices');
  return { ok: true as const };
}

export interface CreateInvoiceInput {
  vendorId: string;
  invoiceNo: string | null;
  projectId: string | null;
  entity: string | null;
  receivedDate: string | null;
  description: string | null;
  amountUsd: number;
  /** Set once the caller has already seen an exact-key dup and chosen "add
   *  anyway" (components/invoices/add-invoice.tsx) — same shape as
   *  createTaskChecked's own force flag in app/actions/tasks.ts. Only
   *  changes what an EXACT match does; a suspicion match never needed
   *  forcing in the first place (see below). */
  force?: boolean;
}

export interface InvoiceDupInfo {
  id: string;
  vendor: string;
  amount_usd: number;
  received_date: string | null;
}

/**
 * Add-Invoice (E4). The tracker is known to contain genuine duplicates —
 * lib/import/tracker.ts's own vendorKey doc tells the actual story: the same
 * vendor split across two rows by a punctuation difference let one $5,250
 * invoice become several, because the import upsert keys on (vendor_id,
 * number) and two different vendor_id rows never collide. This never
 * deletes or silently merges either side of that:
 *
 *   - exact key (normalized vendor + invoice_no) hit -> refuse the insert,
 *     hand back the existing row so the caller can point the user at it —
 *     unless `force` says the human already looked and wants a second row
 *     anyway (still flagged, never silently treated as "the same").
 *   - suspicion key (vendor + amount + received_date + entity + project) hit
 *     -> insert proceeds, flagged needs_verification: true.
 *   - no invoice_no at all -> insert proceeds, flagged needs_verification:
 *     true unconditionally (there is no exact key without a number to key
 *     on, so this is the only path a numberless invoice can ever take).
 *
 * A human (Noa) adjudicates every flagged row from there — nothing here ever
 * deletes or auto-resolves one.
 */
export async function createInvoice(
  input: CreateInvoiceInput,
): Promise<{ error: string } | { dup: InvoiceDupInfo } | { ok: true; id: string; needsVerification: boolean }> {
  const user = await requireUser();
  const admin = supabaseAdmin();

  if (!input.vendorId) return { error: INVOICE_ERRORS.vendorRequired };
  if (typeof input.amountUsd !== 'number' || !Number.isFinite(input.amountUsd)) {
    return { error: INVOICE_ERRORS.invalidAmount };
  }

  const patch: InvoicePatch = {
    vendor_id: input.vendorId,
    invoice_no: input.invoiceNo?.trim() || null,
    project_id: input.projectId || null,
    entity: input.entity?.trim() || null,
    received_date: input.receivedDate || null,
    description: input.description?.trim() || null,
    amount_usd: input.amountUsd,
  };
  // A brand-new row has no prior status/paid_date to violate — 'received'
  // with no paid_date is what a new invoice actually starts as (CHAIN[0] in
  // advanceInvoice above), so this reuses validateInvoicePatch's real
  // cross-field rules (amount shape, date shape) instead of a second copy.
  const validation = validateInvoicePatch({ status: 'received', paid_date: null }, patch);
  if ('error' in validation) return validation;

  // Vendor-hygiene canonicalization, reused (not reimplemented) from
  // page.tsx's own — see lib/invoice-rules.ts's canonVendorName/vendorGroupKey
  // doc comment for why this is deliberately NOT tracker.ts's stronger
  // vendorKey. Scoped to tab:'invoices' — the same population the Invoices
  // tab itself (and Add Invoice) shows; 'david' is a separately-tracked sheet
  // this flow never writes to or checks against.
  const [vendorsRes, existingRes] = await Promise.all([
    admin.from('vendors').select('id,name'),
    admin.from('invoices')
      .select('id,vendor_id,number,amount_usd,received_date,entity,project_id')
      .eq('tab', 'invoices'),
  ]);
  // A failed lookup here must not masquerade as "vendor required" below —
  // that would name the wrong reason for what is really a query failure.
  if (vendorsRes.error) return { error: vendorsRes.error.message };
  if (existingRes.error) return { error: existingRes.error.message };
  const { data: vendorRows } = vendorsRes;
  const { data: existingRows } = existingRes;
  const vendors = (vendorRows ?? []) as { id: string; name: string }[];
  const canonicalByKey = new Map<string, string>();
  for (const v of vendors) {
    const k = vendorGroupKey(v.name);
    if (!canonicalByKey.has(k)) canonicalByKey.set(k, canonVendorName(v.name));
  }
  const vendorNameById = new Map(vendors.map((v) => [v.id, canonicalByKey.get(vendorGroupKey(v.name)) ?? canonVendorName(v.name)]));
  const newVendorName = vendorNameById.get(input.vendorId);
  if (!newVendorName) return { error: INVOICE_ERRORS.vendorRequired };

  const candidates: InvoiceDupCandidate[] = ((existingRows ?? []) as Array<{
    id: string; vendor_id: string | null; number: string | null; amount_usd: number;
    received_date: string | null; entity: string | null; project_id: string | null;
  }>).map((r) => ({
    id: r.id,
    vendorName: r.vendor_id ? (vendorNameById.get(r.vendor_id) ?? '') : '',
    invoiceNo: r.number,
    amountUsd: Number(r.amount_usd),
    receivedDate: r.received_date,
    entity: r.entity,
    projectId: r.project_id,
  }));

  const query = {
    vendorName: newVendorName, invoiceNo: patch.invoice_no as string | null,
    amountUsd: input.amountUsd, receivedDate: patch.received_date as string | null,
    entity: patch.entity as string | null, projectId: patch.project_id as string | null,
  };

  const exactDup = findExactInvoiceDuplicate(query, candidates);
  if (exactDup && !input.force) {
    return { dup: { id: exactDup.id, vendor: exactDup.vendorName, amount_usd: exactDup.amountUsd, received_date: exactDup.receivedDate } };
  }

  const missingInvoiceNo = !query.invoiceNo;
  const suspected = !exactDup && findSuspectedInvoiceDuplicate(query, candidates);
  const needsVerification = missingInvoiceNo || !!suspected || !!(exactDup && input.force);

  const row = buildInvoiceRow(patch);
  row.tab = 'invoices';
  row.needs_verification = needsVerification;
  // NOTE: if `exactDup` shares this exact vendor_id (not just the same
  // canonical name — e.g. force:true after the SAME vendor+number was
  // already on file), the table's own `unique (vendor_id, number)`
  // constraint (0001_init.sql) will reject this insert outright. That
  // constraint predates this task and is untouched here; the resulting
  // Postgres error still surfaces below rather than being swallowed.
  const { data, error } = await admin.from('invoices').insert(row).select('id').single();
  if (error) return { error: error.message };

  // No `before` — nothing existed to snapshot, same as every other pure
  // creation event already in this codebase (createTask/createTaskChecked in
  // app/actions/tasks.ts, blocker_create/decision_create in
  // lib/state-writer.ts). `after` carries the full inserted row instead.
  await logActivity(admin, {
    entity_type: 'invoice', entity_id: data.id, actor: user.email ?? user.id,
    action: 'create', after: row,
  });
  revalidatePath('/invoices');
  return { ok: true as const, id: data.id, needsVerification };
}
