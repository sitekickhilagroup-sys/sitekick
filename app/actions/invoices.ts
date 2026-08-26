'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import { buildInvoiceRow, INVOICE_ERRORS, INVOICE_ROW_COLUMNS, validateInvoicePatch, type InvoicePatch } from '@/lib/invoice-rules';
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
