// E6 — pure Source-vs-System reconciliation diff.
//
// The invoice import never snapshotted the source rows it wrote (lib/import/
// tracker.ts's applyInvoiceRows just upserts), so there is no stored "what
// the sheet said" to compare against — reconciliation has to re-read the
// Excel every time and diff it in memory against whatever is in `invoices`
// right now. This file is that diff, and nothing else: no Supabase, no
// mutation, no I/O. The only write this feature performs anywhere (flagging
// a row needs_verification) lives in app/actions/invoices.ts, nowhere near
// this function — reconcile() cannot apply or delete anything even by
// accident.
import type { InvoiceRow } from './parse/xlsx.ts';
import type { Invoice } from './types.ts';
import { vendorKey } from './invoice-rules.ts';

export interface InvoiceRowRef {
  vendor: string;
  invoice_no: string | null;
  amount_usd: number;
  received_date: string | null;
}

export interface ReconcileReport {
  source: number;
  system: number;
  added: InvoiceRowRef[];                 // in system, not in source
  orphans: InvoiceRowRef[];                // in source, not in system
  changed: Array<{ ref: InvoiceRowRef; fields: string[] }>;
  suspectedDuplicates: InvoiceRowRef[][];  // same-key group >1, either side
}

// Working row: the public InvoiceRowRef plus the fields that matter for
// drift but aren't part of the matching key (paid_date, status, entity,
// description) — never returned as-is, only `ref` is ever exposed.
interface WorkRow {
  ref: InvoiceRowRef;
  key: string;
  paidDate: string | null;
  status: string;
  entity: string | null;
  description: string | null;
}

const norm = (s: string | null): string => (s ?? '').trim().toLowerCase();

// Comparing the rendered-to-cents decimal STRING, never the raw float, is
// what keeps two values that are equal as money from disagreeing as floats —
// the same technique lib/invoice-rules.ts's suspicionDupKey already relies
// on (`amountUsd.toFixed(2)`). A Postgres numeric(12,2) round-trip and a
// freshly Number()-parsed Excel cell can differ in trailing float bits while
// representing the identical dollar-and-cents amount, so `.toFixed(2)`
// string equality is the only comparison that can't manufacture a false
// "changed" over nothing.
const centsEqual = (a: number, b: number): boolean => a.toFixed(2) === b.toFixed(2);

/**
 * The brief's own matching key: normalized vendor (vendorKey — the same
 * normaliser duplicate-detection in lib/invoice-rules.ts and the import
 * writer in lib/import/tracker.ts already use, so a punctuation-only vendor
 * variant can't defeat this key any more than it can defeat theirs) +
 * invoice_no when the row has one, else vendor + amount + received_date.
 *
 * Deliberately NOT exactDupKey/suspicionDupKey from lib/invoice-rules.ts:
 * those are a two-step refuse-then-flag decision over the full
 * InvoiceDupCandidate shape (entity + project included), built to decide
 * whether createInvoice should block a write. Reconciliation instead needs
 * one fallback key over the brief's narrower InvoiceRowRef shape (vendor /
 * invoice_no / amount / received_date only — no entity or project field
 * exists on this type at all) purely to group "probably the same invoice"
 * rows for a report, never to block anything. Both still share the same
 * vendor identity and the same toFixed(2) amount-safety, so anything that
 * would exact-match in createInvoice's own check matches here too.
 */
export function reconcileKey(
  vendor: string,
  invoiceNo: string | null,
  amountUsd: number,
  receivedDate: string | null,
): string {
  const vk = vendorKey(vendor);
  const no = invoiceNo?.trim();
  return no ? `${vk}::no:${no.toLowerCase()}` : `${vk}::fallback:${amountUsd.toFixed(2)}::${receivedDate ?? ''}`;
}

function groupByKey(rows: WorkRow[]): Map<string, WorkRow[]> {
  const map = new Map<string, WorkRow[]>();
  for (const row of rows) {
    const list = map.get(row.key);
    if (list) list.push(row); else map.set(row.key, [row]);
  }
  return map;
}

/**
 * Source vs system diff (E6). Matching key: reconcileKey above. A key whose
 * count is >1 on ONE side alone is inherently ambiguous — which of 2 (or 3)
 * same-keyed rows on that side corresponds to which single row on the other
 * side? — so the whole group is routed to suspectedDuplicates and excluded
 * from added/orphans/changed entirely for that key; only unambiguous 1:1
 * keys get compared field-by-field. This is deliberate, not a gap: guessing
 * a 1:1 pairing inside an ambiguous group would risk reporting "changed"
 * (or "no drift") for a row that was actually a different physical
 * duplicate — silently asserting a match the data doesn't actually support.
 * A human sees the whole group instead and adjudicates it directly, same as
 * every other "can't safely auto-resolve" case in this codebase.
 *
 * A source row and a system row can only match when BOTH take the same key
 * *shape* — i.e. either both have an invoice_no, or neither does. A row
 * that has an invoice_no on one side but not the other (e.g. the number was
 * dropped or added only on one side during import) therefore surfaces as a
 * separate orphan + added pair rather than one "changed" entry naming
 * invoice_no — a known, narrow edge case of following the brief's key
 * literally; see task-E6-report.md.
 */
export function reconcile(
  source: InvoiceRow[],
  system: Invoice[],
  vendorName: (id: string | null) => string,
): ReconcileReport {
  const sourceRows: WorkRow[] = source.map((row) => {
    const vendor = row.vendor ?? '';
    const ref: InvoiceRowRef = {
      vendor, invoice_no: row.number, amount_usd: row.amount, received_date: row.received_date,
    };
    return {
      ref,
      key: reconcileKey(vendor, row.number, row.amount, row.received_date),
      paidDate: row.paid_date, status: row.status, entity: row.entity, description: row.description,
    };
  });

  const systemRows: WorkRow[] = system.map((inv) => {
    const vendor = vendorName(inv.vendor_id);
    const amount = Number(inv.amount_usd);
    const ref: InvoiceRowRef = {
      vendor, invoice_no: inv.number, amount_usd: amount, received_date: inv.received_date,
    };
    return {
      ref,
      key: reconcileKey(vendor, inv.number, amount, inv.received_date),
      paidDate: inv.paid_date, status: inv.status, entity: inv.entity, description: inv.budget_line,
    };
  });

  const sourceByKey = groupByKey(sourceRows);
  const systemByKey = groupByKey(systemRows);

  const suspectedDuplicates: InvoiceRowRef[][] = [];
  const ambiguousKeys = new Set<string>();
  for (const rows of sourceByKey.values()) {
    if (rows.length > 1) suspectedDuplicates.push(rows.map((r) => r.ref));
  }
  for (const rows of systemByKey.values()) {
    if (rows.length > 1) suspectedDuplicates.push(rows.map((r) => r.ref));
  }
  for (const [key, rows] of sourceByKey) if (rows.length > 1) ambiguousKeys.add(key);
  for (const [key, rows] of systemByKey) if (rows.length > 1) ambiguousKeys.add(key);

  const added: InvoiceRowRef[] = [];
  const orphans: InvoiceRowRef[] = [];
  const changed: Array<{ ref: InvoiceRowRef; fields: string[] }> = [];

  const allKeys = new Set<string>([...sourceByKey.keys(), ...systemByKey.keys()]);
  for (const key of allKeys) {
    if (ambiguousKeys.has(key)) continue;
    const s = sourceByKey.get(key)?.[0];
    const y = systemByKey.get(key)?.[0];
    if (s && !y) { orphans.push(s.ref); continue; }
    if (y && !s) { added.push(y.ref); continue; }
    // Every key in allKeys has at least one side, so this can only be
    // reached with both s and y defined — the two branches above already
    // exhaustively handle "only one side". This guard is for the type
    // checker, not runtime control flow: TS can't derive "s and y are both
    // defined" from the two independent conditions above on its own, so
    // without it s.ref/y.ref below would still be typed possibly-undefined.
    if (!s || !y) continue;

    const fields: string[] = [];
    // amount_usd/received_date are part of the key (and therefore already
    // guaranteed equal) whenever this pair matched via the fallback shape —
    // these checks only ever fire when the pair matched via invoice_no,
    // where neither field is constrained by the key at all.
    if (!centsEqual(s.ref.amount_usd, y.ref.amount_usd)) fields.push('amount_usd');
    if ((s.ref.received_date ?? '') !== (y.ref.received_date ?? '')) fields.push('received_date');
    if ((s.paidDate ?? '') !== (y.paidDate ?? '')) fields.push('paid_date');
    if (s.status !== y.status) fields.push('status');
    if (norm(s.entity) !== norm(y.entity)) fields.push('entity');
    if (norm(s.description) !== norm(y.description)) fields.push('description');
    if (fields.length > 0) changed.push({ ref: s.ref, fields });
  }

  return { source: source.length, system: system.length, added, orphans, changed, suspectedDuplicates };
}
