'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import type { InvoiceStatus } from '@/lib/types';

const CHAIN: InvoiceStatus[] = ['received', 'for_rowan_approval', 'approved', 'paid'];

export async function advanceInvoice(invoiceId: string) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');

  const admin = supabaseAdmin();
  const { data: inv } = await admin.from('invoices').select('status').eq('id', invoiceId).single();
  if (!inv) return;
  const idx = CHAIN.indexOf(inv.status as InvoiceStatus);
  if (idx === -1 || idx === CHAIN.length - 1) return;
  const next = CHAIN[idx + 1];
  const patch: Record<string, unknown> = { status: next };
  if (next === 'paid') patch.paid_date = new Date().toISOString().slice(0, 10);
  await admin.from('invoices').update(patch).eq('id', invoiceId);
  revalidatePath('/invoices');
}
