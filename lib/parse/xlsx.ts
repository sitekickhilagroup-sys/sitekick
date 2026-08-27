import 'server-only';
import * as XLSX from 'xlsx';

// Excel tracker importers, built against Hilla's real files.
// Detection is header-based so renamed copies still work.

export interface InvoiceRow {
  received_date: string | null;
  project: string | null;
  entity: string | null;
  vendor: string | null;
  number: string | null;
  link: string | null;
  description: string | null;
  amount: number;
  status: 'received' | 'for_rowan_approval' | 'approved' | 'paid' | 'on_hold';
  /** The real payment date from the sheet. Never the received date. */
  paid_date: string | null;
  approved_by: string | null;
  /** Q10: the tracker's Service Month column ("Sep 25"); a date-typed cell
   *  arrives as an Excel serial and is normalised to "YYYY-MM". */
  service_month: string | null;
  /** 2026-08-28 tracker revision: Noa added a Transfer Confirmation link
   *  column (Q10-ג — the payment-proof link, distinct from the invoice). */
  transfer_url: string | null;
  /** Same revision: a free-text Notes column. */
  notes: string | null;
}

export interface TaskRow {
  priority: 'critical' | 'high' | 'normal';
  project: string | null;
  title: string;
  description: string | null;
  owner: string | null;
  waiting_for: string | null;
  due: string | null;
  follow_up: string | null;
  last_touched: string | null;
  status: 'open' | 'done';
}

export type XlsxImport =
  // I6: which sheet these rows came from — findHeaderRow/the loop below picks
  // the FIRST sheet in the workbook whose header matches, which was fine when
  // this only fed an ingest agent (any matching sheet is equally good) but is
  // now load-bearing for a financial report (E6 reconciliation): an archive
  // sheet ordered ahead of the live one would make the report claim every
  // live invoice is missing from source, with no way for the reader to tell
  // WHICH sheet was actually compared. Not a change to the selection logic
  // itself — just surfacing what it already picked.
  | { kind: 'invoices'; rows: InvoiceRow[]; sheetName: string }
  | { kind: 'tasks'; rows: TaskRow[] }
  | { kind: 'text'; text: string };

function excelDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // not a plausible Excel date serial
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
}

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

// Sheets often have title rows above the real header — find it.
function findHeaderRow(rows: unknown[][], mustInclude: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (mustInclude.every((m) => cells.some((c) => c.includes(m)))) return i;
  }
  return -1;
}

function objects(rows: unknown[][], headerIdx: number): Record<string, unknown>[] {
  const header = (rows[headerIdx] ?? []).map((h) => norm(h));
  const out: Record<string, unknown>[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row || row.every((c) => c == null || c === '')) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, i) => { if (h) obj[h] = row[i]; });
    out.push(obj);
  }
  return out;
}

function pick(obj: Record<string, unknown>, ...needles: string[]): unknown {
  for (const key of Object.keys(obj)) {
    if (needles.some((n) => key.includes(n))) return obj[key];
  }
  return undefined;
}

const str = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

// The tracker's link column holds plain text on some rows ("Open invoice");
// only a real URL may become one, or the table renders a dead link.
const url = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

// Service Month is usually text ("Sep 25") but a date-typed cell arrives as
// an Excel serial — normalise that case to "YYYY-MM" instead of storing the
// raw serial digits.
function serviceMonth(v: unknown): string | null {
  if (typeof v === 'number') return excelDate(v)?.slice(0, 7) ?? null;
  return str(v);
}

function mapInvoiceStatus(v: unknown): InvoiceRow['status'] {
  const s = norm(v);
  if (s.includes('paid')) return 'paid';
  if (s.includes('rowan')) return 'for_rowan_approval';
  if (s.includes('approv')) return 'approved';
  // "On Hold" normalises to "onhold" and matched none of the above, so every
  // held invoice imported as Received — and was then counted as open money.
  if (s.includes('hold')) return 'on_hold';
  return 'received';
}

export function parseWorkbook(buffer: Buffer): XlsxImport {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  // 1. Invoices tracker: a sheet whose header has supplier+invoice+amount.
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][];
    const h = findHeaderRow(rows, ['supplier', 'invoiceno', 'amount']);
    if (h === -1) continue;
    const objs = objects(rows, h);
    const out: InvoiceRow[] = objs
      .filter((o) => pick(o, 'supplier') || pick(o, 'invoiceno'))
      .map((o) => ({
        received_date: excelDate(pick(o, 'receiveddate', 'received')),
        project: str(pick(o, 'project', 'property')),
        entity: str(pick(o, 'llc', 'entity')),
        vendor: str(pick(o, 'supplier')),
        number: str(pick(o, 'invoiceno')),
        // The paste-link column first; her 2026-08 revision added a derived
        // "Link URL (auto)" column that backfills rows where the paste cell
        // is empty or holds placeholder text.
        // NOTE: the fallback needle must be 'linkurl' alone — a bare 'link'
        // matches the paste column again (earlier in column order) and the
        // auto column would never be reached.
        link: url(pick(o, 'invoicelink', 'link')) ?? url(pick(o, 'linkurl')),
        description: str(pick(o, 'description')),
        amount: Number(pick(o, 'invoiceamount', 'amount')) || 0,
        status: mapInvoiceStatus(pick(o, 'status')),
        // Payment Date is the hand-entered truth; "Paid On (calc)" (derived
        // from her transfer records) fills the gap when it's blank.
        paid_date: excelDate(pick(o, 'paymentdate', 'paiddate', 'datepaid')) ?? excelDate(pick(o, 'paidon')),
        approved_by: str(pick(o, 'approvedby')),
        service_month: serviceMonth(pick(o, 'servicemonth')),
        transfer_url: url(pick(o, 'transferconfirmation')),
        notes: str(pick(o, 'notes')),
      }));
    if (out.length > 0) return { kind: 'invoices', rows: out, sheetName: name };
  }

  // 2. Operations / task tracker: header has task description + owner.
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as unknown[][];
    const h = findHeaderRow(rows, ['taskdescription', 'owner']);
    if (h === -1) continue;
    const objs = objects(rows, h);
    const out: TaskRow[] = objs
      .filter((o) => str(pick(o, 'taskdescription')))
      .map((o) => {
        const pr = norm(pick(o, 'priority'));
        const status = norm(pick(o, 'status'));
        return {
          priority: pr.includes('crit') || pr.includes('urgent') ? 'critical' : pr.includes('high') ? 'high' : 'normal',
          project: str(pick(o, 'project')),
          title: String(pick(o, 'taskdescription')).trim(),
          description: str(pick(o, 'openaction', 'notes')),
          owner: str(pick(o, 'owner')),
          waiting_for: str(pick(o, 'waitingfor', 'consultant')),
          due: excelDate(pick(o, 'duedate', 'due')),
          follow_up: excelDate(pick(o, 'followupdate', 'checkbackon')),
          last_touched: excelDate(pick(o, 'lasttouch')),
          status: status.includes('done') || status.includes('complete') ? 'done' : 'open',
        };
      });
    if (out.length > 0) return { kind: 'tasks', rows: out };
  }

  // 3. Fallback: dump visible sheets as CSV text for the comms agent.
  let text = '';
  for (const name of wb.SheetNames.slice(0, 6)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).trim();
    if (csv) text += `--- Sheet: ${name} ---\n${csv}\n\n`;
    if (text.length > 15000) break;
  }
  return { kind: 'text', text: text.slice(0, 15000) };
}
