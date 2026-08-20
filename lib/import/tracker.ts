import type { SupabaseClient } from '@supabase/supabase-js';
import { matchExistingTask } from '../dedup.ts';
import type { InvoiceRow, TaskRow } from '../parse/xlsx.ts';
import type { Project, Task } from '../types.ts';

// Writers for Excel tracker uploads. Idempotent: invoices upsert on
// (vendor, number); tasks reuse the extract-comms matcher so re-uploading
// the tracker updates rows instead of duplicating them (client item 1).

function matchProject(name: string | null, projects: Pick<Project, 'id' | 'name'>[]): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n === 'all' || n === '') return null;
  const hit = projects.find((p) => {
    const pn = p.name.toLowerCase();
    return pn.includes(n) || n.includes(pn) ||
      pn.replace(/[^a-z0-9]/g, '').includes(n.replace(/[^a-z0-9]/g, '')) ||
      n.replace(/[^a-z0-9]/g, '').includes(pn.replace(/[^a-z0-9]/g, ''));
  });
  return hit?.id ?? null;
}

export async function applyInvoiceRows(
  admin: SupabaseClient,
  docId: string,
  rows: InvoiceRow[],
  projects: Pick<Project, 'id' | 'name'>[],
): Promise<{ upserted: number; failed: number }> {
  let upserted = 0, failed = 0;
  const vendorIds = new Map<string, string>();
  for (const row of rows) {
    if (!row.vendor && !row.number) continue;
    let vendorId: string | null = null;
    if (row.vendor) {
      vendorId = vendorIds.get(row.vendor) ?? null;
      if (!vendorId) {
        const { data } = await admin.from('vendors')
          .upsert({ name: row.vendor }, { onConflict: 'name' }).select('id').single();
        vendorId = data?.id ?? null;
        if (vendorId) vendorIds.set(row.vendor, vendorId);
      }
    }
    const { error } = await admin.from('invoices').upsert({
      project_id: matchProject(row.project, projects),
      vendor_id: vendorId,
      document_id: docId,
      number: row.number,
      amount_usd: row.amount,
      received_date: row.received_date,
      status: row.status,
      tab: 'invoices',
      entity: row.entity,
      transfer_confirmation_url: row.link,
      approved_by: row.approved_by,
      budget_line: row.description,
      paid_date: row.status === 'paid' ? row.received_date : null,
    }, { onConflict: 'vendor_id,number' });
    if (error) failed++; else upserted++;
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
