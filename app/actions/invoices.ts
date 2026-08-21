'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import type { InvoiceStatus } from '@/lib/types';

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

// Spec §יב: the Update Invoice editor — status, payment date, both links and
// notes in one save. Same https-only rule as saveInvoiceLinks.
const STATUSES: InvoiceStatus[] = ['received', 'for_rowan_approval', 'approved', 'paid', 'on_hold'];

export async function updateInvoiceDetails(
  invoiceId: string,
  patch: { status: InvoiceStatus; paidDate: string | null; invoiceUrl: string | null; receiptUrl: string | null; notes: string | null },
) {
  const user = await requireUser();
  if (!STATUSES.includes(patch.status)) return { error: 'invalid status' };
  const okUrl = (u: string | null) => u === null || u === '' || /^https:\/\//.test(u);
  if (!okUrl(patch.invoiceUrl) || !okUrl(patch.receiptUrl)) return { error: 'links must start with https://' };
  const okDate = (d: string | null) => d === null || d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!okDate(patch.paidDate)) return { error: 'invalid date' };
  const admin = supabaseAdmin();
  const row = {
    status: patch.status,
    paid_date: patch.paidDate || (patch.status === 'paid' ? laToday() : null),
    invoice_url: patch.invoiceUrl || null,
    receipt_url: patch.receiptUrl || null,
    notes: patch.notes?.trim() || null,
  };
  const { error } = await admin.from('invoices').update(row).eq('id', invoiceId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id, action: 'update', after: row });
  revalidatePath('/invoices');
  return { ok: true };
}

// Item 7: invoice/receipt links — Noa pastes Drive/Dropbox share links after
// scanning paperwork; https:// only (no raw file paths / local drive letters).
export async function saveInvoiceLinks(invoiceId: string, invoiceUrl: string | null, receiptUrl: string | null) {
  const user = await requireUser();
  const ok = (u: string | null) => u === null || u === '' || /^https:\/\//.test(u);
  if (!ok(invoiceUrl) || !ok(receiptUrl)) return { error: 'links must start with https://' };
  const admin = supabaseAdmin();
  const patch = { invoice_url: invoiceUrl || null, receipt_url: receiptUrl || null };
  const { error } = await admin.from('invoices').update(patch).eq('id', invoiceId);
  if (error) return { error: error.message };
  await logActivity(admin, { entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id, action: 'links', after: patch });
  revalidatePath('/invoices');
  return { ok: true };
}
