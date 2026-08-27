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
  /** Review round 2, finding 3 — orphan/added rows that share a vendor +
   *  amount + received_date with a row on the OTHER list but couldn't be
   *  safely paired into `changed` because more than one candidate exists on
   *  at least one side (see pairInvoiceNoDrift below). Left in
   *  orphans/added rather than moved or dropped — this is only a warning
   *  that one of these Added/Orphans rows might already be on file under a
   *  different invoice_no, not a resolved match. */
  possibleInvoiceNoDrift: InvoiceRowRef[];
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

// Ignores invoice_no entirely — this is deliberately a WEAKER key than
// reconcileKey, used only to find a shape-mismatched candidate (one side has
// a number, the other doesn't) for the SAME real invoice.
function bucketKey(ref: InvoiceRowRef): string {
  return `${vendorKey(ref.vendor)}::${ref.amount_usd.toFixed(2)}::${ref.received_date ?? ''}`;
}

function groupByBucketKey(rows: InvoiceRowRef[]): Map<string, InvoiceRowRef[]> {
  const map = new Map<string, InvoiceRowRef[]>();
  for (const row of rows) {
    const k = bucketKey(row);
    const list = map.get(k);
    if (list) list.push(row); else map.set(k, [row]);
  }
  return map;
}

/**
 * Second pass (review round 2, finding 3): pairs an Orphans row against an
 * Added row that are almost certainly the same real invoice, differing only
 * in whether invoice_no is present — the one shape mismatch reconcileKey
 * itself can never match on (see reconcile()'s own doc comment above).
 * Tries both directions symmetrically: orphan-without-number vs
 * added-with-number, and orphan-with-number vs added-without-number, each
 * bucketed on vendor + amount + received_date (bucketKey — NOT
 * reconcileKey, since ignoring invoice_no is the whole point here).
 *
 * A bucket pairs into `changed: ['invoice_no']` ONLY when it holds exactly
 * one candidate on each side — anything else is left exactly where it was
 * (removed from neither orphans nor added) and every row in that bucket is
 * reported in possibleInvoiceNoDrift instead, because picking a pair out of
 * 2+ candidates on either side would be the same unsafe guess
 * suspectedDuplicates already refuses to make for an ambiguous
 * reconcileKey group.
 */
function pairInvoiceNoDrift(
  orphansIn: InvoiceRowRef[],
  addedIn: InvoiceRowRef[],
): {
  orphans: InvoiceRowRef[];
  added: InvoiceRowRef[];
  changed: Array<{ ref: InvoiceRowRef; fields: string[] }>;
  possibleInvoiceNoDrift: InvoiceRowRef[];
} {
  const changed: Array<{ ref: InvoiceRowRef; fields: string[] }> = [];
  const paired = { orphans: new Set<InvoiceRowRef>(), added: new Set<InvoiceRowRef>() };
  const suspect = { orphans: new Set<InvoiceRowRef>(), added: new Set<InvoiceRowRef>() };
  const hasNo = (r: InvoiceRowRef) => !!r.invoice_no?.trim();

  const directions: [InvoiceRowRef[], InvoiceRowRef[]][] = [
    [orphansIn.filter((r) => !hasNo(r)), addedIn.filter(hasNo)],   // orphan blank, added has a number
    [orphansIn.filter(hasNo), addedIn.filter((r) => !hasNo(r))],   // orphan has a number, added blank
  ];

  for (const [orphanSide, addedSide] of directions) {
    const orphanBuckets = groupByBucketKey(orphanSide);
    const addedBuckets = groupByBucketKey(addedSide);
    for (const [key, oGroup] of orphanBuckets) {
      const aGroup = addedBuckets.get(key);
      if (!aGroup) continue;
      if (oGroup.length === 1 && aGroup.length === 1) {
        changed.push({ ref: oGroup[0], fields: ['invoice_no'] });
        paired.orphans.add(oGroup[0]);
        paired.added.add(aGroup[0]);
      } else {
        for (const r of oGroup) suspect.orphans.add(r);
        for (const r of aGroup) suspect.added.add(r);
      }
    }
  }

  return {
    orphans: orphansIn.filter((r) => !paired.orphans.has(r)),
    added: addedIn.filter((r) => !paired.added.has(r)),
    changed,
    possibleInvoiceNoDrift: [...suspect.orphans, ...suspect.added],
  };
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
 * A source row and a system row can only match on reconcileKey when BOTH
 * take the same key *shape* — i.e. either both have an invoice_no, or
 * neither does. A row that has an invoice_no on one side but not the other
 * (e.g. blank Invoice No. on import, or the number added/cleared later)
 * would otherwise surface as a bare orphan + added pair instead of one
 * "changed" entry — which is actively misleading, not just incomplete: an
 * Orphans row reads as "add this", and the most likely reading here would
 * add a duplicate of an invoice that's already on file. pairInvoiceNoDrift
 * below runs as a second pass over exactly those leftover orphans/added to
 * catch that specific shape mismatch.
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

  const pass2 = pairInvoiceNoDrift(orphans, added);
  return {
    source: source.length, system: system.length,
    added: pass2.added, orphans: pass2.orphans,
    changed: [...changed, ...pass2.changed],
    suspectedDuplicates,
    possibleInvoiceNoDrift: pass2.possibleInvoiceNoDrift,
  };
}
