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
