import type { SupabaseClient } from '@supabase/supabase-js';
import { matchExistingTask } from '../dedup.ts';
import type { InvoiceRow, TaskRow } from '../parse/xlsx.ts';
import type { Project, Task } from '../types.ts';

// Writers for Excel tracker uploads. Idempotent: invoices upsert on
// (vendor, number); tasks reuse the extract-comms matcher so re-uploading
// the tracker updates rows instead of duplicating them (client item 1).

// Address noise the tracker and the projects table disagree on: a house-number
// range one side shortens ("2650-2656 Rinconia" vs "2650 Rinconia") and a
// trailing street suffix one side drops ("… Dr"). The LEADING number is kept —
// it is what tells "3701 Alta Mesa" from "3941 Alta Mesa", two real properties.
function addressNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/(\d+)\s*[-–]\s*\d+/g, '$1')
    .replace(/\b(dr|drive|way|st|street|ave|avenue|rd|road|ln|lane)\b\.?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchProject(name: string | null, projects: Pick<Project, 'id' | 'name'>[]): string | null {
  if (!name) return null;
  const n = addressNorm(name);
  if (n === 'all' || n === '') return null;
  const hit = projects.find((p) => {
    const pn = addressNorm(p.name);
    return pn.includes(n) || n.includes(pn) ||
      pn.replace(/[^a-z0-9]/g, '').includes(n.replace(/[^a-z0-9]/g, '')) ||
      n.replace(/[^a-z0-9]/g, '').includes(pn.replace(/[^a-z0-9]/g, ''));
  });
  return hit?.id ?? null;
}

/**
 * Identity key for a vendor name.
 *
 * The vendors table is unique on the exact string, so "Thang Le & Associates"
 * and "Thang le& Associates" became two rows with two ids — and because the
 * invoice upsert keys on (vendor_id, number), the same invoice could then never
 * collide with itself. That is how one $5,250 invoice became several.
 *
 * Differences in case, spacing, periods and hyphens are collapsed, and a
 * trailing corporate suffix is dropped so "PREMISE" and "PREMISE LLC" resolve
 * together — both cases the audit names explicitly.
 */
export function vendorKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-_/&,]/g, ' ')
    .replace(/\b(llc|inc|ltd|corp|co|company|associates|assoc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export async function applyInvoiceRows(
  admin: SupabaseClient,
  docId: string,
  rows: InvoiceRow[],
  projects: Pick<Project, 'id' | 'name'>[],
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0, failed = 0;
  const vendorIds = new Map<string, string>();

  // Load the existing vendors once and index them by identity key, so a name
  // that differs only in punctuation reuses the row instead of creating a twin.
  const { data: existingVendors } = await admin.from('vendors').select('id,name');
  for (const v of (existingVendors ?? []) as { id: string; name: string }[]) {
    const k = vendorKey(v.name);
    if (k && !vendorIds.has(k)) vendorIds.set(k, v.id);
  }

  // Q7 (Noa): invoice identity is (vendor, number, entity) — migration 0018.
  // The old blind upsert keyed on (vendor_id, number) alone, so the same
  // number across two entities collided, and a numberless row NEVER matched
  // (unique nulls are distinct) — every re-upload inserted a fresh twin
  // (the Thang Le ×4 audit case). Match existing rows explicitly instead:
  // by the full identity key when the row has a number, and by
  // (vendor, entity, amount) when it does not.
  const entityNorm = (e: string | null) => (e ?? '').trim().toLowerCase();
  const idKey = (vendorId: string | null, number: string | null, entity: string | null) =>
    `${vendorId ?? ''}::${(number ?? '').trim().toLowerCase()}::${entityNorm(entity)}`;
  const numberlessKey = (vendorId: string | null, entity: string | null, amount: number) =>
    `${vendorId ?? ''}::${entityNorm(entity)}::${amount.toFixed(2)}`;

  const { data: existingInvoices } = await admin.from('invoices')
    .select('id,vendor_id,number,entity,amount_usd');
  const byIdentity = new Map<string, string>();
  const byNumberless = new Map<string, string>();
  for (const inv of (existingInvoices ?? []) as
    { id: string; vendor_id: string | null; number: string | null; entity: string | null; amount_usd: number }[]) {
    if (inv.number?.trim()) {
      const k = idKey(inv.vendor_id, inv.number, inv.entity);
      if (!byIdentity.has(k)) byIdentity.set(k, inv.id);
    } else {
      const k = numberlessKey(inv.vendor_id, inv.entity, Number(inv.amount_usd));
      if (!byNumberless.has(k)) byNumberless.set(k, inv.id);
    }
  }

  for (const row of rows) {
    if (!row.vendor && !row.number) continue;
    let vendorId: string | null = null;
    if (row.vendor) {
      const key = vendorKey(row.vendor);
      vendorId = vendorIds.get(key) ?? null;
      if (!vendorId) {
        const { data } = await admin.from('vendors')
          .upsert({ name: row.vendor }, { onConflict: 'name' }).select('id').single();
        vendorId = data?.id ?? null;
        if (vendorId && key) vendorIds.set(key, vendorId);
      }
    }
    const values = {
      project_id: matchProject(row.project, projects),
      vendor_id: vendorId,
      document_id: docId,
      number: row.number,
      amount_usd: row.amount,
      received_date: row.received_date,
      status: row.status,
      tab: 'invoices' as const,
      entity: row.entity,
      // The sheet's link column is the invoice document. It was written to
      // transfer_confirmation_url, so every imported invoice link surfaced
      // under the "Transfer confirmation" label instead.
      invoice_url: row.link,
      approved_by: row.approved_by,
      budget_line: row.description,
      // Was `row.status === 'paid' ? row.received_date : null`, which stamped
      // the received date as the payment date on every paid invoice — a
      // fabricated figure on a financial record. Only a real payment date from
      // the sheet is written now.
      paid_date: row.paid_date,
      service_month: row.service_month,
    };
    const existingId = row.number?.trim()
      ? byIdentity.get(idKey(vendorId, row.number, row.entity))
      : byNumberless.get(numberlessKey(vendorId, row.entity, row.amount));
    if (existingId) {
      const { error } = await admin.from('invoices').update(values).eq('id', existingId);
      if (error) failed++; else upserted++;
    } else {
      const { data, error } = await admin.from('invoices').insert(values).select('id').single();
      if (error || !data) { failed++; continue; }
      upserted++;
      // Register the new row so an exact in-sheet twin updates it instead of
      // tripping the unique constraint with a second insert.
      if (row.number?.trim()) byIdentity.set(idKey(vendorId, row.number, row.entity), data.id);
      else byNumberless.set(numberlessKey(vendorId, row.entity, row.amount), data.id);
    }
  }
  return { upserted, failed };
}

export async function applyTaskRows(
  admin: SupabaseClient,
  docId: string,
  rows: TaskRow[],
  projects: Pick<Project, 'id' | 'name'>[],
  openTasks: Task[],
  today: string,
): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  for (const row of rows) {
    const projectId = matchProject(row.project, projects);
    const match = matchExistingTask({ title: row.title, project_id: projectId }, openTasks);
    if (match) {
      await admin.from('tasks').update({
        description: row.description ?? match.description,
        owner: row.owner ?? match.owner,
        // Blank tracker cell must not wipe a waiting-for set via the UI/emails.
        waiting_for: row.waiting_for ?? match.waiting_for,
        due: row.due ?? match.due,
        follow_up_date: row.follow_up ?? match.follow_up_date,
        priority: row.priority,
        status: row.status,
        last_touched: row.last_touched ?? today,
        document_id: docId,
      }).eq('id', match.id);
      updated++;
    } else {
      await admin.from('tasks').insert({
        project_id: projectId,
        document_id: docId,
        title: row.title,
        description: row.description,
        owner: row.owner,
        waiting_for: row.waiting_for,
        due: row.due,
        follow_up_date: row.follow_up,
        priority: row.priority,
        status: row.status,
        planned: true,
        source: 'tracker-upload',
        last_touched: row.last_touched ?? today,
      });
      created++;
    }
  }
  return { created, updated };
}
