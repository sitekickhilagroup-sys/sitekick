'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laDateTime, laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import {
  buildInvoiceRow, canonVendorName, decideCreateInvoiceOutcome, diffChangedKeys,
  INVOICE_ERRORS, INVOICE_ROW_COLUMNS, validateInvoicePatch, vendorKey,
  type InvoiceDupCandidate, type InvoicePatch,
} from '@/lib/invoice-rules';
import { fetchAllPages } from '@/lib/paginate';
import { parseWorkbook } from '@/lib/parse/xlsx';
import { reconcile, reconcileKey, type InvoiceRowRef, type ReconcileReport } from '@/lib/reconcile';
import type { Invoice, InvoiceStatus } from '@/lib/types';

export type { InvoicePatch };

const CHAIN: InvoiceStatus[] = ['received', 'for_rowan_approval', 'approved', 'paid'];

// I4: both reconciliation entry points below need the COMPLETE current
// `invoices` set scoped to tab='invoices' — the diff needs every system row
// to find Orphans, and "Flag Verify" needs to find its match wherever it is.
// A plain `.select()` silently truncates at Supabase's default REST max-rows
// (1000), which is exactly why createInvoice below (see exactCandidatesRes/
// suspicionCandidatesRes) already replaced its own equivalent scan with two
// targeted queries — this reintroduced the same unbounded shape one function
// over. Paged through explicitly via fetchAllPages (lib/paginate.ts) so
// completeness is proven, not assumed.
const INVOICES_PAGE_SIZE = 1000;
async function fetchAllInvoices<T>(admin: SupabaseClient, columns: string): Promise<{ data: T[] } | { error: string }> {
  return fetchAllPages<T>(INVOICES_PAGE_SIZE, async (offset, limit) => {
    // Re-review fix: Postgres gives no ordering guarantee across separate
    // LIMIT/OFFSET requests — and these ARE separate HTTP requests, in
    // separate transactions, while advanceInvoice/updateInvoice can be
    // writing concurrently. With no explicit order, page 2 could re-return
    // a row page 1 already had and miss another entirely: exactly the
    // failure I4 exists to kill (a real invoice missing from `system`,
    // reported as an Orphan whose call to action is "add this row"), just
    // non-deterministic instead of a fixed 1000-row cut. `id` is stable and
    // never changes after insert, so ordering by it is what makes each
    // page's boundary consistent across requests.
    const { data, error } = await admin
      .from('invoices')
      .select(columns)
      .eq('tab', 'invoices')
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    return { data: data as T[] | null, error };
  });
}

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
  // I3: work/page.tsx's Payment Run card and lib/queries.ts's home open-money
  // panel both read `invoices` too — every invoice-writing action here now
  // revalidates every route that reads what it wrote, not just /invoices.
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
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
  const { data: before, error: selectError } = await admin.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  // Smaller-items fix: this used to discard selectError and treat !before as
  // not-found — the same defect flagInvoiceForVerification's own SELECT had
  // (see I1 there) one function over: an RLS or network failure on THIS row
  // read as "invoice not found" for something visible on screen. select('*')
  // never 42703s for a missing column (a missing column just isn't in the
  // returned row), so unlike flagInvoiceForVerification there is no
  // migration-pending case to special-case here — any error is a real one.
  if (selectError) return { error: selectError.message };
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
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
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
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
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
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
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

// ── E6: Source-vs-System reconciliation ──────────────────────────────────

/** vendor_id -> canonical display name, collapsing punctuation/case/company-
 *  suffix variants the same way page.tsx's own vDisplay does (and
 *  createInvoice above does inline) — shared by the two functions below so
 *  a reconciliation report and the write it can trigger can't quietly
 *  resolve "the same vendor" two different ways. */
function vendorNameResolver(vendors: { id: string; name: string }[]): (id: string | null) => string {
  const canonicalByKey = new Map<string, string>();
  for (const v of vendors) {
    const k = vendorKey(v.name);
    if (!canonicalByKey.has(k)) canonicalByKey.set(k, canonVendorName(v.name));
  }
  const nameById = new Map(vendors.map((v) => [v.id, canonicalByKey.get(vendorKey(v.name)) ?? canonVendorName(v.name)]));
  return (id) => (id ? (nameById.get(id) ?? '') : '');
}

/**
 * E6 — reconciliation upload. The import never snapshotted the source rows
 * it wrote (lib/import/tracker.ts's applyInvoiceRows only ever upserts), so
 * there is nothing stored to diff against: this re-parses the Excel fresh on
 * every call and diffs it in memory via the pure reconcile() (lib/reconcile.ts).
 *
 * Deliberately NOT a call through /api/upload's own .xlsx branch: that route
 * always calls ingestDocument + applyInvoiceRows as a side effect (storing a
 * document row and writing/upserting invoices), and a reconciliation REPORT
 * must never create or change a single row by itself — running it is
 * supposed to be side-effect-free. This reads the uploaded buffer with the
 * same parseWorkbook() /api/upload uses, and otherwise only SELECTs (never
 * writes) before handing everything to reconcile().
 */
export async function parseReconciliationSource(
  formData: FormData,
): Promise<{ error: string } | { ok: true; report: ReconcileReport }> {
  await requireUser();

  const file = formData.get('file');
  if (!(file instanceof File)) return { error: INVOICE_ERRORS.reconcileFileMissing };
  if (!/\.(xlsx|xls)$/i.test(file.name)) return { error: INVOICE_ERRORS.reconcileBadFileType };

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ReturnType<typeof parseWorkbook>;
  try {
    parsed = parseWorkbook(buffer);
  } catch {
    // xlsx (SheetJS) throws on a buffer it can't read at all — a renamed
    // non-Excel file, a corrupted download, etc. Caught here so this returns
    // a message the user can act on instead of a raw unhandled-exception
    // failure for what is, from the user's chair, just the wrong file.
    return { error: INVOICE_ERRORS.reconcileParseFailed };
  }
  // findHeaderRow (lib/parse/xlsx.ts) only returns kind:'invoices' for a
  // sheet whose header row actually has supplier+invoiceno+amount columns —
  // anything else (a tasks tracker, or no recognizable sheet at all) must
  // fail loudly here rather than quietly diff an empty source against the
  // system and render what looks exactly like "no drift found".
  if (parsed.kind !== 'invoices') return { error: INVOICE_ERRORS.reconcileNotInvoiceSheet };

  const admin = supabaseAdmin();
  // Read-only. Scoped to tab:'invoices' — the same population the Excel
  // tracker imports into (applyInvoiceRows hard-codes tab: 'invoices') and
  // Add Invoice's own duplicate check scopes to; 'david' is a separately-
  // tracked sheet this flow never touches either way.
  //
  // I4: the FULL set, paged (fetchAllInvoices above) — a report that only
  // ever sees the first 1000 system rows would compare the source against a
  // truncated system set and report every real invoice past that cut as an
  // Orphan (whose own call to action is "add this row"), the opposite of
  // what a reconciliation report exists to prevent.
  const [invoicesRes, vendorsRes] = await Promise.all([
    fetchAllInvoices<Invoice>(admin, '*'),
    admin.from('vendors').select('id,name'),
  ]);
  if ('error' in invoicesRes) return { error: invoicesRes.error };
  if (vendorsRes.error) return { error: vendorsRes.error.message };

  const vendorName = vendorNameResolver((vendorsRes.data ?? []) as { id: string; name: string }[]);
  const system = invoicesRes.data;
  const report = reconcile(parsed.rows, system, vendorName, parsed.sheetName);
  return { ok: true as const, report };
}

/**
 * The write behind "Flag Verify": sets needs_verification=true on one
 * invoice, audited and undoable the same way as every other write in this
 * file (logActivity -> undoId; undo restores from before_json). Never
 * touches any other column, never deletes, never merges.
 *
 * needs_verification is deliberately NOT one of INVOICE_PATCH_KEYS
 * (lib/invoice-rules.ts) — createInvoice above is the only other writer, and
 * only at insert time (see Invoice['needs_verification']'s own doc comment
 * in lib/types.ts: "never auto-resolved, only a human clears it") — so this
 * is its own small audited write/undo pair rather than a detour through
 * updateInvoice's general whitelist, which would also turn needs_verification
 * into an editable field on every other invoice-editing surface, not just
 * this one flag action.
 */
export async function flagInvoiceForVerification(invoiceId: string): Promise<{ error: string } | { ok: true; undoId: string | null }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before, error: selectError } = await admin.from('invoices').select('needs_verification').eq('id', invoiceId).maybeSingle();
  if (selectError) {
    // Review round 2, finding 1: this used to discard selectError and treat
    // !before as not-found — which meant an UNAPPLIED migration 0017 (this
    // codebase's own established live condition: createInvoice's insert
    // below has a dedicated PGRST204 branch for exactly this column) read as
    // "invoice not found" for a row visible on screen, and any other SELECT
    // failure (RLS, network) read the same way. Named the same way
    // createInvoice already does, not a second guess at the code.
    //
    // I1: PGRST204 alone was still wrong, just differently — PostgREST only
    // returns PGRST204 for an INSERT/UPDATE *payload* column PostgREST can't
    // find in its schema cache (createInvoice's own insert below is exactly
    // that case). A missing column in a SELECT list instead surfaces
    // Postgres's own 42703 (undefined_column), forwarded through PostgREST
    // as-is — which is exactly this call, a `.select('needs_verification')`.
    // The branch written for the migration-pending case was therefore dead:
    // pre-0017 this always fell through to the raw `column invoices.
    // needs_verification does not exist` message instead. Both codes are
    // checked now so either shape of "the column doesn't exist yet" maps to
    // the same named, actionable error.
    if (selectError.code === 'PGRST204' || selectError.code === '42703') return { error: INVOICE_ERRORS.migrationPending };
    return { error: selectError.message };
  }
  if (!before) return { error: INVOICE_ERRORS.notFound };
  if (before.needs_verification) return { ok: true as const, undoId: null }; // already flagged — nothing to write or undo

  const { error } = await admin.from('invoices').update({ needs_verification: true }).eq('id', invoiceId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id,
    action: 'flag_verify', before, after: { needs_verification: true },
  });
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
  return { ok: true as const, undoId };
}

/**
 * The other half of adjudication — flagInvoiceForVerification's exact twin.
 * "Only a human clears it" was the policy since 0017, but until 2026-08-28
 * no action could actually clear the flag: rows flagged at insert (Add
 * Invoice without a number, agent-parsed PDFs, reconciliation flags) stayed
 * flagged forever. Same audited write/undo shape as the flag action; the
 * shared undoFlagInvoiceForVerification below restores either direction from
 * before_json.
 */
export async function resolveInvoiceVerification(invoiceId: string): Promise<{ error: string } | { ok: true; undoId: string | null }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data: before, error: selectError } = await admin.from('invoices').select('needs_verification').eq('id', invoiceId).maybeSingle();
  if (selectError) {
    if (selectError.code === 'PGRST204' || selectError.code === '42703') return { error: INVOICE_ERRORS.migrationPending };
    return { error: selectError.message };
  }
  if (!before) return { error: INVOICE_ERRORS.notFound };
  if (!before.needs_verification) return { ok: true as const, undoId: null }; // already clear — nothing to write or undo

  const { error } = await admin.from('invoices').update({ needs_verification: false }).eq('id', invoiceId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'invoice', entity_id: invoiceId, actor: user.email ?? user.id,
    action: 'flag_verify', before, after: { needs_verification: false },
  });
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
  return { ok: true as const, undoId };
}

/** Restores needs_verification from the snapshot flagInvoiceForVerification
 *  or resolveInvoiceVerification took — scoped to just that one column, not
 *  the general INVOICE_ROW_COLUMNS restore undoInvoiceEdit performs above,
 *  since needs_verification isn't part of that whitelist either. */
export async function undoFlagInvoiceForVerification(logId: string): Promise<{ error: string } | { ok: true }> {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as { entity_type: string; entity_id: string; action: string; before_json: Record<string, unknown> | null } | null;
  if (!entry?.before_json || entry.entity_type !== 'invoice' || entry.action !== 'flag_verify') {
    return { error: INVOICE_ERRORS.nothingToUndo };
  }
  const restored = !!entry.before_json.needs_verification;
  const { error } = await admin.from('invoices').update({ needs_verification: restored }).eq('id', entry.entity_id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'invoice', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo', after: { needs_verification: restored },
  });
  revalidatePath('/invoices'); revalidatePath('/'); revalidatePath('/work');
  return { ok: true as const };
}

/**
 * Review round 2, finding 2 + minor 2: every outcome is counted separately
 * and never silently folded into another —
 *   - `flagged`: rows this click actually wrote to (needs_verification was
 *     false, now true). One undoId per row, all returned in `undoIds`.
 *   - `alreadyFlagged`: rows that were already flagged before this click
 *     (flagInvoiceForVerification's own no-op branch) — real, but nothing
 *     THIS click can undo, so never counted in `undoIds`.
 *   - `failed`: rows where the write itself errored. Previously discarded
 *     once at least one row succeeded, which let a real partial failure
 *     read as a plain, complete success.
 * `failureReason` is the last error hit, present whenever failed > 0, so a
 * partial failure is never silent even though the call as a whole still
 * reports `ok: true` (some rows in the group DID end up flagged).
 */
export interface FlagReconciledRowResult {
  flagged: number;
  alreadyFlagged: number;
  failed: number;
  undoIds: string[];
  failureReason: string | null;
}

/**
 * E6's entry point for "Flag Verify" as it is actually clicked — from a row
 * in the reconciliation report, which is only ever an InvoiceRowRef
 * (vendor/invoice_no/amount_usd/received_date — see lib/reconcile.ts), never
 * an invoice id. That is deliberate on reconcile()'s side, not an oversight:
 * a Source-side row has no id to carry (it doesn't exist in the database),
 * so the report cannot serialize one. Re-deriving the id from a fresh,
 * read-only scoped query here — rather than threading ids through the report
 * payload — also means a click sometime after the report loaded resolves
 * against the CURRENT table, not a stale snapshot from when the file was
 * uploaded. Uses the exact same key reconcile() used to build the report
 * (reconcileKey), so "the row you're looking at" and "the row this flags"
 * can never disagree.
 *
 * A key can resolve to more than one invoice — the suspectedDuplicates case
 * — in which case every matching row is flagged, each with its own audited,
 * independently-undoable entry (flagInvoiceForVerification is called once
 * per match): the human is looking at the whole ambiguous group, and
 * flagging it "needs a closer look" applies to the group, not to one row
 * arbitrarily singled out of it. A key that matches nothing (most often an
 * Orphans row, which by definition doesn't exist in the system yet) is a
 * named error, not a silent no-op.
 */
export async function flagReconciledRowForVerification(
  ref: InvoiceRowRef,
): Promise<{ error: string } | ({ ok: true } & FlagReconciledRowResult)> {
  await requireUser();
  const admin = supabaseAdmin();

  // I4: same bounding as parseReconciliationSource above — a match can be
  // any row in the table, so this needs the FULL set too, not just the
  // first 1000. Missing a real match here means "Flag Verify" reports a
  // false reconcileNoMatch for a row that does exist.
  type MatchCandidate = { id: string; vendor_id: string | null; number: string | null; amount_usd: number; received_date: string | null };
  const [invoicesRes, vendorsRes] = await Promise.all([
    fetchAllInvoices<MatchCandidate>(admin, 'id,vendor_id,number,amount_usd,received_date'),
    admin.from('vendors').select('id,name'),
  ]);
  if ('error' in invoicesRes) return { error: invoicesRes.error };
  if (vendorsRes.error) return { error: vendorsRes.error.message };

  const vendorName = vendorNameResolver((vendorsRes.data ?? []) as { id: string; name: string }[]);
  const targetKey = reconcileKey(ref.vendor, ref.invoice_no, ref.amount_usd, ref.received_date);
  const rows = invoicesRes.data;
  const matches = rows.filter((r) => reconcileKey(vendorName(r.vendor_id), r.number, Number(r.amount_usd), r.received_date) === targetKey);
  if (matches.length === 0) return { error: INVOICE_ERRORS.reconcileNoMatch };

  let flagged = 0;
  let alreadyFlagged = 0;
  let failed = 0;
  const undoIds: string[] = [];
  let failureReason: string | null = null;
  for (const m of matches) {
    const res = await flagInvoiceForVerification(m.id);
    if ('error' in res) { failed++; failureReason = res.error; continue; }
    if (res.undoId) { flagged++; undoIds.push(res.undoId); } else { alreadyFlagged++; }
  }
  if (flagged === 0 && alreadyFlagged === 0) return { error: failureReason ?? INVOICE_ERRORS.reconcileNoMatch };
  return { ok: true as const, flagged, alreadyFlagged, failed, undoIds, failureReason };
}

/**
 * Undoes every id flagReconciledRowForVerification handed back — the
 * suspectedDuplicates case can flag more than one invoice from a single
 * click, and undoFlagInvoiceForVerification only ever reverts one logId at
 * a time. Same honesty rule as the flag loop above: a partial failure here
 * (2 of 3 undo, 1 errors) is reported as `undone`/`failed` rather than
 * quietly discarded once at least one succeeds.
 */
export interface UndoFlagReconciledRowResult { undone: number; failed: number; failureReason: string | null }

export async function undoFlagReconciledRowForVerification(
  logIds: string[],
): Promise<{ error: string } | ({ ok: true } & UndoFlagReconciledRowResult)> {
  if (logIds.length === 0) return { error: INVOICE_ERRORS.nothingToUndo };
  let undone = 0;
  let failed = 0;
  let failureReason: string | null = null;
  for (const logId of logIds) {
    const res = await undoFlagInvoiceForVerification(logId);
    if ('error' in res) { failed++; failureReason = res.error; } else undone++;
  }
  if (undone === 0) return { error: failureReason ?? INVOICE_ERRORS.nothingToUndo };
  return { ok: true as const, undone, failed, failureReason };
}
