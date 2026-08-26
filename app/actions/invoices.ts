'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laDateTime, laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import {
  buildInvoiceRow, canonVendorName, decideCreateInvoiceOutcome, diffChangedKeys,
  INVOICE_ERRORS, INVOICE_ROW_COLUMNS, validateInvoicePatch, vendorKey,
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

/** Shape of an `invoices` row as returned by the narrowed candidate queries
 *  below — just what the duplicate-detection keys need. */
interface RawInvoiceCandidate {
  id: string;
  vendor_id: string | null;
  number: string | null;
  amount_usd: number;
  received_date: string | null;
  entity: string | null;
  project_id: string | null;
}

/** Escapes ILIKE's own wildcard characters (%, _) so a literal invoice
 *  number or entity value that happens to contain one can't accidentally
 *  act as a pattern when used below for a case-insensitive exact match. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
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
 *     anyway (still flagged, never silently treated as "the same"). If that
 *     match shares the literal same vendor_id, force is refused too — with
 *     a named error, not a raw Postgres constraint failure — because
 *     inserting would violate `unique (vendor_id, number)` (0001_init.sql);
 *     the real fix there is a different invoice number.
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

  // Candidate fetch, narrowed to what the two detection keys can actually
  // match — vendor identity is resolved and compared in JS below (vendorKey
  // isn't a column Postgres can filter on), but every other field IS a real
  // column, so two small, targeted queries replace one unscoped `select *`
  // scan of every invoice. Supabase's default API max_rows is 1000; an
  // unscoped fetch here would silently truncate past that and let a genuine
  // duplicate insert unflagged with no error — the exact failure mode this
  // avoids. Scoped to tab:'invoices' — the same population the Invoices tab
  // itself (and Add Invoice) shows; 'david' is a separately-tracked sheet
  // this flow never writes to or checks against.
  const trimmedNo = patch.invoice_no as string | null;
  const receivedDate = patch.received_date as string | null;
  const entity = patch.entity as string | null;
  const projectId = patch.project_id as string | null;
  const candidateColumns = 'id,vendor_id,number,amount_usd,received_date,entity,project_id';
  let suspicionQuery = admin.from('invoices').select(candidateColumns)
    .eq('tab', 'invoices').eq('amount_usd', input.amountUsd);
  suspicionQuery = receivedDate ? suspicionQuery.eq('received_date', receivedDate) : suspicionQuery.is('received_date', null);
  suspicionQuery = entity ? suspicionQuery.ilike('entity', escapeLike(entity)) : suspicionQuery.is('entity', null);
  suspicionQuery = projectId ? suspicionQuery.eq('project_id', projectId) : suspicionQuery.is('project_id', null);

  const [vendorsRes, exactCandidatesRes, suspicionCandidatesRes] = await Promise.all([
    admin.from('vendors').select('id,name'),
    trimmedNo
      ? admin.from('invoices').select(candidateColumns).eq('tab', 'invoices').ilike('number', escapeLike(trimmedNo))
      : Promise.resolve({ data: [] as RawInvoiceCandidate[], error: null }),
    suspicionQuery,
  ]);
  // A failed lookup here must not masquerade as "vendor required" below —
  // that would name the wrong reason for what is really a query failure.
  if (vendorsRes.error) return { error: vendorsRes.error.message };
  if (exactCandidatesRes.error) return { error: exactCandidatesRes.error.message };
  if (suspicionCandidatesRes.error) return { error: suspicionCandidatesRes.error.message };

  const vendors = (vendorsRes.data ?? []) as { id: string; name: string }[];
  const canonicalByKey = new Map<string, string>();
  for (const v of vendors) {
    const k = vendorKey(v.name);
    if (!canonicalByKey.has(k)) canonicalByKey.set(k, canonVendorName(v.name));
  }
  const vendorNameById = new Map(vendors.map((v) => [v.id, canonicalByKey.get(vendorKey(v.name)) ?? canonVendorName(v.name)]));
  const newVendorName = vendorNameById.get(input.vendorId);
  if (!newVendorName) return { error: INVOICE_ERRORS.vendorRequired };

  const rawCandidates = new Map<string, RawInvoiceCandidate>();
  for (const r of [...(exactCandidatesRes.data ?? []), ...(suspicionCandidatesRes.data ?? [])] as RawInvoiceCandidate[]) {
    rawCandidates.set(r.id, r);
  }
  const candidates: InvoiceDupCandidate[] = [...rawCandidates.values()].map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    vendorName: r.vendor_id ? (vendorNameById.get(r.vendor_id) ?? '') : '',
    invoiceNo: r.number,
    amountUsd: Number(r.amount_usd),
    receivedDate: r.received_date,
    entity: r.entity,
    projectId: r.project_id,
  }));

  const query = {
    vendorId: input.vendorId, vendorName: newVendorName, invoiceNo: trimmedNo,
    amountUsd: input.amountUsd, receivedDate, entity, projectId,
  };

  const outcome = decideCreateInvoiceOutcome(query, candidates, !!input.force);
  if (outcome.kind === 'blocked') {
    const { dup } = outcome;
    return { dup: { id: dup.id, vendor: dup.vendorName, amount_usd: dup.amountUsd, received_date: dup.receivedDate } };
  }
  if (outcome.kind === 'blockedSameVendor') return { error: INVOICE_ERRORS.duplicateNumber };

  const row = buildInvoiceRow(patch);
  row.tab = 'invoices';
  row.needs_verification = outcome.needsVerification;
  const { data, error } = await admin.from('invoices').insert(row).select('id').single();
  if (error) {
    // PGRST204: PostgREST can't find needs_verification in its schema
    // cache — migration 0017_invoice_verify.sql hasn't been applied yet.
    // Named separately so the message tells the owner what to actually do,
    // instead of a raw "column ... does not exist" internal.
    if (error.code === 'PGRST204') return { error: INVOICE_ERRORS.migrationPending };
    return { error: error.message };
  }

  // No `before` — nothing existed to snapshot, same as every other pure
  // creation event already in this codebase (createTask/createTaskChecked in
  // app/actions/tasks.ts, blocker_create/decision_create in
  // lib/state-writer.ts). `after` carries the full inserted row instead, so
  // the E5 history panel's before/after diff still shows every field the
  // invoice started with rather than an empty diff against a missing
  // before — except `tab`, which every Add-Invoice row shares unconditionally
  // and has no InvoicePatch key/label of its own, so it would only ever show
  // up in history as a meaningless "Changed: … tab".
  const loggedRow: Record<string, unknown> = { ...row };
  delete loggedRow.tab;
  await logActivity(admin, {
    entity_type: 'invoice', entity_id: data.id, actor: user.email ?? user.id,
    action: 'create', after: loggedRow,
  });
  revalidatePath('/invoices');
  return { ok: true as const, id: data.id, needsVerification: outcome.needsVerification };
}

export interface InvoiceHistoryEntry {
  id: string;
  actor: string;
  action: string;
  /** Pre-formatted LA-local "YYYY-MM-DD HH:mm" (lib/date.ts's laDateTime) —
   *  the history panel renders this as-is, no client-side formatting. */
  createdAt: string;
  /** Real column names (activity_log's own before_json/after_json keys) —
   *  the caller maps these to field labels via patchKeyForColumn. */
  changedKeys: string[];
}

/**
 * E5: the change-history panel's data source. Reads back what every action
 * above already writes via logActivity — this adds nothing to the audit
 * trail, it only reads a slice of it back, capped at the last 10 rows for
 * one invoice.
 *
 * Deliberately a separate on-demand call rather than a prop from the page:
 * page.tsx's own invoices/projects/vendors Promise.all loads once for every
 * row on screen, but only one LinkEditor is ever open (and its History
 * <details> expanded) at a time — fetching 10 activity_log rows per invoice
 * up front would be a real N+1 query for data almost nobody expands. This is
 * called directly by link-editor.tsx instead, the same way it already calls
 * updateInvoice/undoInvoiceEdit.
 */
export async function getInvoiceHistory(invoiceId: string): Promise<{ entries: InvoiceHistoryEntry[] } | { error: string }> {
  await requireUser();
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('activity_log')
    .select('id, actor, action, before_json, after_json, created_at')
    .eq('entity_type', 'invoice')
    .eq('entity_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return { error: error.message };
  const entries: InvoiceHistoryEntry[] = ((data ?? []) as Array<{
    id: string; actor: string; action: string;
    before_json: Record<string, unknown> | null; after_json: Record<string, unknown> | null;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    createdAt: laDateTime(row.created_at),
    changedKeys: diffChangedKeys(row.before_json, row.after_json),
  }));
  return { entries };
}
