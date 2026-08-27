import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from './xlsx';
import { parseEml } from './eml';
import { parseEmailsJsonl } from './emails-jsonl';

function wb(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWorkbook', () => {
  it('detects invoice tracker with title rows above header', () => {
    // Header shape mirrors the 2026-08-28 tracker revision: the original
    // columns plus Transfer Confirmation, Notes, and the derived
    // "Paid On (calc)" / "Link URL (auto)" helper columns.
    const buffer = wb([
      ['Hilla US Invoices', null, null],
      ['#', 'Service Month', 'Invoice Received Date', 'Property / Project', 'LLC / Entity', 'Supplier', 'Invoice No.', 'Invoice Link  (paste link)', 'Invoice Amount ($)', 'Status', 'Payment Date', 'Transfer Confirmation', 'Notes', 'Paid On (calc)', 'Link URL (auto)'],
      [1, 'Sep 25', '2026-08-01', 'Blair', 'Blair LLC', 'Crest', '100', 'https://example.com/inv.pdf', 500, 'For Rowan Approval', null, 'https://example.com/wire.pdf', 'retainer', null, null],
      [2, 45992, '2026-08-02', 'San Marco', 'SM LLC', 'KGS', '200', 'Open invoice', 900, 'Paid', null, null, null, '2026-08-10', 'https://example.com/auto.pdf'],
    ]);
    const result = parseWorkbook(buffer);
    expect(result.kind).toBe('invoices');
    if (result.kind === 'invoices') {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].status).toBe('for_rowan_approval');
      expect(result.rows[1].status).toBe('paid');
      expect(result.rows[0].vendor).toBe('Crest');
      // Q10: Service Month survives the import — text stays as typed, a
      // date-typed cell (Excel serial) normalises to YYYY-MM.
      expect(result.rows[0].service_month).toBe('Sep 25');
      expect(result.rows[1].service_month).toBe('2025-12');
      // The link column's placeholder text ("Open invoice") is not a URL and
      // must not become one; the derived Link URL (auto) column backfills it.
      expect(result.rows[0].link).toBe('https://example.com/inv.pdf');
      expect(result.rows[1].link).toBe('https://example.com/auto.pdf');
      // Transfer Confirmation and Notes come through (Q10-ג).
      expect(result.rows[0].transfer_url).toBe('https://example.com/wire.pdf');
      expect(result.rows[0].notes).toBe('retainer');
      expect(result.rows[1].transfer_url).toBeNull();
      // A blank Payment Date falls back to Paid On (calc).
      expect(result.rows[1].paid_date).toBe('2026-08-10');
      // I6: the sheet a reconciliation report compares against has to be
      // nameable, not just "whichever one matched first".
      expect(result.sheetName).toBe('Sheet1');
    }
  });

  it('detects task tracker', () => {
    const buffer = wb([
      ['PRIORITY', 'PROJECT', 'TASK DESCRIPTION', 'OWNER\n(Who Does It)', 'WAITING FOR\n(Follow Up)', 'DUE DATE', 'STATUS'],
      ['Critical', 'Blair', 'File the permit', 'Noa', 'Rowan', '2026-09-01', 'Open'],
    ]);
    const result = parseWorkbook(buffer);
    expect(result.kind).toBe('tasks');
    if (result.kind === 'tasks') {
      expect(result.rows[0].priority).toBe('critical');
      expect(result.rows[0].title).toBe('File the permit');
      expect(result.rows[0].waiting_for).toBe('Rowan');
    }
  });

  it('falls back to text for unknown sheets', () => {
    const buffer = wb([['random', 'columns'], ['a', 'b']]);
    const result = parseWorkbook(buffer);
    expect(result.kind).toBe('text');
  });

  it('converts excel serial dates', () => {
    const buffer = wb([
      ['Supplier', 'Invoice No.', 'Invoice Amount ($)', 'Invoice Received Date', 'Status'],
      ['Crest', '9', 100, 45976, 'Received'],
    ]);
    const result = parseWorkbook(buffer);
    if (result.kind === 'invoices') {
      expect(result.rows[0].received_date).toBe('2025-11-15');
    } else {
      throw new Error('expected invoices');
    }
  });
});

describe('parseEml', () => {
  it('parses headers and plain body', () => {
    const raw = 'From: a@b.com\r\nTo: c@d.com\r\nSubject: Test invoice\r\nMessage-ID: <m1@x>\r\nDate: Wed, 20 Aug 2026 10:00:00 +0000\r\n\r\nHello body';
    const parsed = parseEml(raw);
    expect(parsed.from).toBe('a@b.com');
    expect(parsed.subject).toBe('Test invoice');
    expect(parsed.messageId).toBe('<m1@x>');
    expect(parsed.body).toBe('Hello body');
  });
});

describe('parseEmailsJsonl', () => {
  it('parses dump lines and skips garbage', () => {
    const raw = [
      JSON.stringify({ subject: 'S1', sent: '2026-08-01T10:00:00', from: [{ addr: 'x@y.com', name: 'X' }], to: [], body: 'B1' }),
      'not json',
      JSON.stringify({ subject: 'S2', received: '2026-08-02T10:00:00', from: [], to: [], body: 'B2' }),
    ].join('\n');
    const emails = parseEmailsJsonl(raw);
    expect(emails).toHaveLength(2);
    expect(emails[0].subject).toBe('S1');
    expect(emails[0].from).toBe('X <x@y.com>');
    expect(emails[1].date).toBe('2026-08-02T10:00:00');
  });
});
