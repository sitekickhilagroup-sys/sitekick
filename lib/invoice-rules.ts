// Pure write-shaping + validation for the invoice editor (E2/E3). Kept out of
// app/actions/invoices.ts (a 'use server' file, which can only export async
// functions) so this logic is unit-testable without a database or an
// authenticated request — same reason lib/task-details.ts exists.

import { DATE_RE } from './task-details.ts';
import { vendorKey } from './import/tracker.ts';
import type { Invoice } from './types.ts';

// Re-exported so every call site that needs "is this the same vendor"
// (app/(dash)/(focused)/invoices/page.tsx's own display/grouping, this
// file's duplicate-detection keys below, and lib/import/tracker.ts's own
// import-time vendor-row merging) can import it from one place instead of
// three definitions quietly drifting apart. See lib/import/tracker.ts's own
// doc comment on vendorKey for why the punctuation/suffix stripping matters:
// "Thang Le & Associates" and "Thang le& Associates" are two vendor rows in
// the real data, and a weaker key (trim/lowercase only) misses that pair
// entirely — which is exactly the bug this task exists to catch.
export { vendorKey };

// The full set of columns the invoice editor (E2) is allowed to touch. Two
// entries are deliberately NOT 1:1 with the column name: `invoice_no` and
// `description` are the UI-facing names QA and the editor use (matching the
// table's own "Description" header, which already renders `budget_line` —
// see page.tsx and lib/import/tracker.ts, which maps an import row's
// "description" the same way), because `invoices` has no `invoice_no` or
// `description` column — only `number` and `budget_line`. Every other key
// matches its column name exactly.
export const INVOICE_PATCH_KEYS = [
  'vendor_id', 'invoice_no', 'project_id', 'entity', 'received_date',
  'description', 'amount_usd', 'status', 'paid_date',
  'invoice_url', 'receipt_url', 'transfer_confirmation_url', 'notes',
] as const;

// Exported so link-editor.tsx's history panel (E5) can map a diffed column
// name back to one of its own field labels via patchKeyForColumn below.
export type InvoicePatchKey = (typeof INVOICE_PATCH_KEYS)[number];

/** InvoicePatch key -> the actual `invoices` column it writes. */
const COLUMN_MAP: Record<InvoicePatchKey, string> = {
  vendor_id: 'vendor_id', invoice_no: 'number', project_id: 'project_id',
  entity: 'entity', received_date: 'received_date', description: 'budget_line',
  amount_usd: 'amount_usd', status: 'status', paid_date: 'paid_date',
  invoice_url: 'invoice_url', receipt_url: 'receipt_url',
  transfer_confirmation_url: 'transfer_confirmation_url', notes: 'notes',
};

/** Real `invoices` columns updateInvoice can write — also what
 *  undoInvoiceEdit whitelists when restoring a before_json snapshot. */
export const INVOICE_ROW_COLUMNS = Object.values(COLUMN_MAP);

/** Column name -> the InvoicePatch key that writes it (COLUMN_MAP inverted).
 *  Drives the change-history panel (E5): activity_log stores real column
 *  names in before_json/after_json, but the editor's own labels are keyed by
 *  InvoicePatchKey — this is how a diffed column name finds its label. */
const COLUMN_TO_PATCH_KEY = Object.fromEntries(
  (Object.entries(COLUMN_MAP) as [InvoicePatchKey, string][]).map(([key, column]) => [column, key]),
) as Record<string, InvoicePatchKey>;

export function patchKeyForColumn(column: string): InvoicePatchKey | null {
  return COLUMN_TO_PATCH_KEY[column] ?? null;
}

// receipt_url and transfer_confirmation_url are additions beyond the brief's
// literal InvoicePatch (which listed invoice_url and transfer_confirmation_url
// but omitted receipt_url): E2 Step 2 keeps "the existing status/paid/links/
// notes block" — plural "links" — which has always included the receipt URL
// alongside the invoice URL (see the pre-existing updateInvoiceDetails this
// replaces), and transfer_confirmation_url already renders as a link on every
// row with no way to ever set it. Folding both into the one whitelisted patch
// keeps the editor's save a single audited write instead of splitting one
// user action across two server calls with two undo ids.
export interface InvoicePatch {
  vendor_id?: string | null; invoice_no?: string | null; project_id?: string | null;
  entity?: string | null; received_date?: string | null; description?: string | null;
  amount_usd?: number; status?: Invoice['status']; paid_date?: string | null;
  invoice_url?: string | null; receipt_url?: string | null;
  transfer_confirmation_url?: string | null; notes?: string | null;
}

const STATUSES: Invoice['status'][] = ['received', 'for_rowan_approval', 'approved', 'paid', 'on_hold'];

// Every error validateInvoicePatch/updateInvoice/undoInvoiceEdit can return,
// named once so the UI's error-message mapping (link-editor.tsx) can switch
// on INVOICE_ERRORS.foo instead of a hand-typed string literal that could
// silently drift out of sync with what the action actually sends back — the
// exact "generic string swallows the real reason" failure mode this exists
// to prevent, just one layer up (a typo here would make a KNOWN error look
// unrecognized, not turn it into a blank message).
export const INVOICE_ERRORS = {
  invalidStatus: 'invalid status',
  invalidLink: 'links must start with https://',
  invalidDate: 'invalid date',
  invalidAmount: 'invalid amount',
  paidDateRequired: 'paid date required',
  confirmPaidDate: 'confirm paid date',
  notFound: 'invoice not found',
  emptyPatch: 'empty patch',
  nothingToUndo: 'nothing to undo',
  // E4 — createInvoice's own trust boundary: a vendor is how the duplicate
  // check identifies "the same invoice" at all, so unlike an edit (where
  // every field is optional) a create cannot go in without one.
  vendorRequired: 'vendor required',
  // "Add anyway" forced past an exact-key match that shares the literal same
  // vendor_id — inserting would collide with the table's own
  // `unique (vendor_id, number)` constraint (0001_init.sql). Refused before
  // the insert is even attempted, so the caller never sees the raw
  // constraint-violation text.
  duplicateNumber: 'this vendor already has an invoice with this number',
  // The insert asked for needs_verification and PostgREST returned PGRST204
  // (column not found in schema cache) — migration 0017_invoice_verify.sql
  // has not been applied yet. Named separately from a generic DB error so
  // the message can say what to actually do about it.
  migrationPending: 'the verification column is not live in the database yet',
} as const;

// Inspects the number's own decimal-string form rather than `n * 100` —
// binary floating point makes `181.3 * 100` land a hair off 18130 for some
// inputs, which would reject a perfectly valid amount. `Number.toString()`
// always yields the shortest decimal that round-trips to the same double, so
// counting digits after its '.' reports the amount's *actual* precision with
// no multiply/divide anywhere.
function hasAtMostTwoDecimals(n: number): boolean {
  const s = n.toString();
  if (s.includes('e') || s.includes('E')) return false; // e.g. very large/small values
  const dot = s.indexOf('.');
  return dot === -1 || s.length - dot - 1 <= 2;
}

/**
 * Shape + cross-field rules for a proposed invoice patch. Pure — takes only
 * the previous status/paid_date (everything the paid-date rule needs) plus
 * the patch, and returns ok or a single error. Does not touch the database;
 * FK existence for vendor_id/project_id is left to the DB's own foreign keys
 * (surfaced as a real update error), the same way an invalid id has always
 * behaved on this table.
 */
export function validateInvoicePatch(
  prev: Pick<Invoice, 'status' | 'paid_date'>,
  patch: InvoicePatch,
): { ok: true } | { error: string } {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) return { error: INVOICE_ERRORS.invalidStatus };

  const okUrl = (u: string | null | undefined) => u == null || u === '' || /^https:\/\//.test(u);
  if (!okUrl(patch.invoice_url) || !okUrl(patch.receipt_url) || !okUrl(patch.transfer_confirmation_url)) {
    return { error: INVOICE_ERRORS.invalidLink };
  }

  const okDate = (d: string | null | undefined) => d == null || d === '' || DATE_RE.test(d);
  if (!okDate(patch.received_date) || !okDate(patch.paid_date)) return { error: INVOICE_ERRORS.invalidDate };

  // The client (parseAmountInput) already rejects a 3rd decimal digit in the
  // typed string before it ever becomes a number — this re-checks the same
  // rule against the number itself, because the client is a UX nicety, not
  // the trust boundary: a direct call to this action can hand amount_usd
  // 181.305 straight past parseAmountInput, and numeric(12,2) would silently
  // round it rather than reject it.
  if (patch.amount_usd !== undefined && !(Number.isFinite(patch.amount_usd) && patch.amount_usd >= 0 && hasAtMostTwoDecimals(patch.amount_usd))) {
    return { error: INVOICE_ERRORS.invalidAmount };
  }

  // Effective status/paid_date this patch would leave the row in — a patch
  // that never mentions a key leaves that key at its previous value.
  const effectiveStatus = patch.status ?? prev.status;
  const touchesPaidDate = 'paid_date' in patch;
  const effectivePaidDate = touchesPaidDate ? patch.paid_date : prev.paid_date;

  // Paid always requires a date — whether this patch is the one moving the
  // row to paid, or the row was already paid and this patch (re-sending the
  // same status, or none at all) tries to blank the date out from under it.
  if (effectiveStatus === 'paid' && !effectivePaidDate) {
    return { error: INVOICE_ERRORS.paidDateRequired };
  }

  // Leaving paid must say what happens to the recorded date: the patch has
  // to carry `paid_date` explicitly (kept as the old value, or nulled) —
  // silently dropping it here would leave a stale paid_date sitting under a
  // non-paid status.
  if (prev.status === 'paid' && patch.status !== undefined && patch.status !== 'paid' && !touchesPaidDate) {
    return { error: INVOICE_ERRORS.confirmPaidDate };
  }

  return { ok: true };
}

/**
 * Parses the editor's amount text field into a number of dollars with at
 * most 2 decimal places — the shape amount_usd (`numeric(12,2)`) requires.
 * Rejects anything else (a third decimal digit, scientific notation, stray
 * text) outright rather than silently rounding a mistyped cent away, and
 * never multiplies/divides by 100 to get there — a single string -> number
 * parse of an already-validated ≤2-decimal literal is exact for every
 * realistic invoice amount (doubles represent every integer, and so every
 * whole cent, up to 2^53), so no cent can drift through a float round trip.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whitelists a submitted patch down to INVOICE_PATCH_KEYS, maps each key to
 * its real column (see COLUMN_MAP), null-coalesces every present key, and
 * trims free-text fields (clearing a text field sends null, never drops the
 * column). Doesn't validate — call validateInvoicePatch first; this only
 * shapes an already-accepted patch into the row updateInvoice writes.
 */
export function buildInvoiceRow(patch: InvoicePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of INVOICE_PATCH_KEYS) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    const column = COLUMN_MAP[key];
    // status is the one string column that is never free text and must never
    // collapse to null — every other string field is user-typed and treats
    // "" the same as "not set".
    row[column] = typeof value === 'string' && key !== 'status' ? (value.trim() || null) : (value ?? null);
  }
  return row;
}

// ── E4: Add Invoice duplicate detection ─────────────────────────────────
//
// Display-safe canonical form of a vendor name — trim + collapse whitespace,
// case preserved. Used wherever a *readable* name is needed (page.tsx's
// vDisplay, the duplicate-confirm dialog's `dup.vendor`), as opposed to
// vendorKey above, which is a matching key, not a name.
export function canonVendorName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** One existing invoice, reduced to exactly what the duplicate check
 *  compares — vendorName already resolved to its canonical display name (the
 *  same one vDisplay() in page.tsx would show), and vendorId kept alongside
 *  it (raw, unresolved) only for decideCreateInvoiceOutcome's same-vendor_id
 *  guard below — the key functions themselves never touch it. */
export interface InvoiceDupCandidate {
  id: string;
  vendorId: string | null;
  vendorName: string;
  invoiceNo: string | null;
  amountUsd: number;
  receivedDate: string | null;
  entity: string | null;
  projectId: string | null;
}

export type InvoiceDupQuery = Omit<InvoiceDupCandidate, 'id'>;

/** Exact-duplicate key: normalized vendor + invoice number. Only defined
 *  when an invoice number is present — a numberless invoice can never match
 *  on this key (only ever the softer suspicion key below), which is exactly
 *  how "missing invoice_no" ends up requiring needs_verification instead of
 *  being refused outright. */
function exactDupKey(vendorName: string, invoiceNo: string | null): string | null {
  const no = invoiceNo?.trim();
  return no ? `${vendorKey(vendorName)}::${no.toLowerCase()}` : null;
}

/** Suspicion key: vendor + amount + received date + entity + project — the
 *  project's own audit's second, softer identity for "probably the same
 *  invoice" when there is no invoice number to key on exactly (or the number
 *  alone didn't match). Every field folds into one string key so the caller
 *  never needs its own field-by-field comparison. Vendor identity here uses
 *  the same vendorKey as the exact key above (not a weaker one) — a
 *  punctuation-only vendor variant must not defeat *either* key, only one of
 *  which requires an invoice number to exist at all. */
function suspicionDupKey(q: Pick<InvoiceDupCandidate, 'vendorName' | 'amountUsd' | 'receivedDate' | 'entity' | 'projectId'>): string {
  return [
    vendorKey(q.vendorName),
    q.amountUsd.toFixed(2),
    q.receivedDate ?? '',
    q.entity ? q.entity.trim().toLowerCase() : '',
    q.projectId ?? '',
  ].join('::');
}

/** The exact-key path: a hit here means createInvoice must refuse to insert
 *  by default and point the caller at the row it found (spec: never a silent
 *  second row for something that's actually the same invoice). */
export function findExactInvoiceDuplicate(query: InvoiceDupQuery, candidates: InvoiceDupCandidate[]): InvoiceDupCandidate | null {
  const key = exactDupKey(query.vendorName, query.invoiceNo);
  if (!key) return null;
  return candidates.find((c) => exactDupKey(c.vendorName, c.invoiceNo) === key) ?? null;
}

/** The suspicion-key path: a hit here never blocks the insert — the caller
 *  still creates the row, just flagged needs_verification so a human
 *  adjudicates instead of the system silently assuming either "same" or
 *  "different". */
export function findSuspectedInvoiceDuplicate(query: InvoiceDupQuery, candidates: InvoiceDupCandidate[]): InvoiceDupCandidate | null {
  const key = suspicionDupKey(query);
  return candidates.find((c) => suspicionDupKey(c) === key) ?? null;
}

export type CreateInvoiceOutcome =
  | { kind: 'blocked'; dup: InvoiceDupCandidate }
  | { kind: 'blockedSameVendor' }
  | { kind: 'insert'; needsVerification: boolean };

/**
 * createInvoice's own orchestration, pulled out as a pure function over an
 * already-fetched candidate set so the full force/needsVerification truth
 * table — and the same-vendor_id collision with the table's own
 * `unique (vendor_id, number)` constraint — is directly testable without
 * mocking Supabase. createInvoice itself only fetches candidates, calls
 * this, and turns the result into a DB write (or not).
 */
export function decideCreateInvoiceOutcome(
  query: InvoiceDupQuery,
  candidates: InvoiceDupCandidate[],
  force: boolean,
): CreateInvoiceOutcome {
  const exactDup = findExactInvoiceDuplicate(query, candidates);
  if (exactDup) {
    if (!force) return { kind: 'blocked', dup: exactDup };
    // Forced past an exact-key match. If it shares the literal same
    // vendor_id (not just the same canonical vendor identity via vendorKey
    // — see above), inserting collides with the table's own
    // `unique (vendor_id, number)` constraint (0001_init.sql). This is the
    // ORDINARY case for an exact match, not a rare one: vendors.name is
    // itself unique, so two vendor rows sharing a canonical identity via a
    // punctuation/case difference is the unusual variant — sharing a
    // vendor_id outright is the common one. Refuse cleanly here rather than
    // let the insert reach Postgres and bounce back a raw constraint error:
    // the real fix is a different invoice number, not a second identical
    // (vendor_id, number) row.
    if (exactDup.vendorId === query.vendorId) return { kind: 'blockedSameVendor' };
  }
  const missingInvoiceNo = !query.invoiceNo;
  const suspected = !exactDup && findSuspectedInvoiceDuplicate(query, candidates);
  return { kind: 'insert', needsVerification: missingInvoiceNo || !!suspected || !!exactDup };
}

// ── E5: per-invoice change history ───────────────────────────────────────

/**
 * Which keys differ between an activity_log row's before_json/after_json —
 * drives the change-history panel's "Changed: vendor, amount" line. Pure and
 * generic over two optional JSON objects (a create's before_json is always
 * null, which this treats as "every key in after is a change" — an accurate
 * read of "this is what the row started as").
 */
export function diffChangedKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  const b = before ?? {};
  const a = after ?? {};
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)) changed.push(key);
  }
  return changed;
}
