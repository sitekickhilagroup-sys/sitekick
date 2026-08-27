import { describe, expect, test } from 'vitest';
import { reconcile, reconcileKey } from './reconcile.ts';
import type { InvoiceRow } from './parse/xlsx.ts';
import type { Invoice } from './types.ts';

// Minimal source/system row builders — only the fields reconcile() actually
// reads need real values; everything else is filled with a harmless default
// so each test can override just what it's exercising.
function sourceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    received_date: '2026-05-01', project: null, entity: null, vendor: 'Acme Corp',
    number: '1', link: null, description: null, amount: 100, status: 'received',
    paid_date: null, approved_by: null, service_month: null,
    ...overrides,
  };
}

let nextId = 1;
function systemRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: `inv-${nextId++}`, project_id: null, vendor_id: 'v-acme', document_id: null,
    number: '1', amount_usd: 100, invoice_date: null, received_date: '2026-05-01', due: null,
    status: 'received', tab: 'invoices', entity: null, paid_date: null,
    transfer_confirmation_url: null, approved_by: null, budget_line: null, created_at: '2026-05-01',
    invoice_url: null, receipt_url: null, notes: null, needs_verification: false, service_month: null,
    ...overrides,
  };
}

// vendor_id -> display name resolver, the same shape page.tsx's vDisplay
// builds. Tests register whichever ids they use.
function vendorNameFrom(byId: Record<string, string>): (id: string | null) => string {
  return (id) => (id ? (byId[id] ?? '') : '');
}

describe('reconcile — empty input', () => {
  test('no crash, everything zero', () => {
    expect(reconcile([], [], () => '', 'Sheet1')).toEqual({
      sourceSheetName: 'Sheet1',
      source: 0, system: 0, added: [], orphans: [], changed: [], suspectedDuplicates: [], possibleInvoiceNoDrift: [],
    });
  });
});

describe('reconcile — clean match', () => {
  test('an identical row on both sides reports no drift at all', () => {
    const report = reconcile(
      [sourceRow({ vendor: 'Acme Corp', number: '1', amount: 100, received_date: '2026-05-01' })],
      [systemRow({ vendor_id: 'v-acme', number: '1', amount_usd: 100, received_date: '2026-05-01' })],
      vendorNameFrom({ 'v-acme': 'Acme Corp' }),
      'Sheet1',
    );
    expect(report.source).toBe(1);
    expect(report.system).toBe(1);
    expect(report.added).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.suspectedDuplicates).toEqual([]);
  });

  test('a punctuation-only vendor variant on the system side still matches cleanly (same vendorKey)', () => {
    // Mirrors the audit's own "Thang Le & Associates" vs "Thang le&
    // Associates" example (lib/import/tracker.ts's vendorKey doc comment) —
    // the two spellings must resolve to the same reconciliation key, or this
    // report would disagree with Add Invoice's own duplicate check about
    // what counts as the same vendor.
    const report = reconcile(
      [sourceRow({ vendor: 'Thang Le & Associates', number: '7', amount: 250, received_date: '2026-06-01' })],
      [systemRow({ vendor_id: 'v1', number: '7', amount_usd: 250, received_date: '2026-06-01' })],
      vendorNameFrom({ v1: 'Thang le& Associates' }),
      'Sheet1',
    );
    expect(report.added).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.changed).toEqual([]);
  });
});

describe('reconcile — suspected duplicates (the SNO shape)', () => {
  test('2 rows at No.1/$500/2026-05-27 and 3 rows at No.10/$181.30/2026-07-04 land in suspectedDuplicates', () => {
    // Modeled on the real bug this round fixed: a vendor split by
    // punctuation into two DB rows let the import upsert (keyed on
    // vendor_id+number) duplicate the same invoice instead of merging it —
    // exactly the shape lib/import/tracker.ts's vendorKey doc describes.
    const system: Invoice[] = [
      systemRow({ vendor_id: 'v-sno-a', number: '1', amount_usd: 500, received_date: '2026-05-27' }),
      systemRow({ vendor_id: 'v-sno-b', number: '1', amount_usd: 500, received_date: '2026-05-27' }),
      systemRow({ vendor_id: 'v-acme', number: '10', amount_usd: 181.3, received_date: '2026-07-04' }),
      systemRow({ vendor_id: 'v-acme', number: '10', amount_usd: 181.3, received_date: '2026-07-04' }),
      systemRow({ vendor_id: 'v-acme', number: '10', amount_usd: 181.3, received_date: '2026-07-04' }),
    ];
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Unrelated Vendor', number: '999', amount: 42, received_date: '2026-01-01' })];
    const report = reconcile(source, system, vendorNameFrom({
      'v-sno-a': 'SNO Electric', 'v-sno-b': 'SNO, Electric', 'v-acme': 'Acme Roofing',
    }), 'Sheet1');

    expect(report.system).toBe(5);
    expect(report.suspectedDuplicates).toHaveLength(2);
    const group1 = report.suspectedDuplicates.find((g) => g[0].invoice_no === '1');
    const group10 = report.suspectedDuplicates.find((g) => g[0].invoice_no === '10');
    expect(group1).toHaveLength(2);
    expect(group1?.every((r) => r.amount_usd === 500 && r.received_date === '2026-05-27')).toBe(true);
    expect(group10).toHaveLength(3);
    expect(group10?.every((r) => r.amount_usd === 181.3 && r.received_date === '2026-07-04')).toBe(true);

    // The duplicate groups must not ALSO leak into added/orphans/changed —
    // an ambiguous 1-vs-many key is reported once, not three times.
    expect(report.added.some((r) => r.invoice_no === '1' || r.invoice_no === '10')).toBe(false);
    expect(report.orphans.some((r) => r.invoice_no === '1' || r.invoice_no === '10')).toBe(false);
  });

  test('duplicates on the SOURCE side (not just system) are also caught', () => {
    const source: InvoiceRow[] = [
      sourceRow({ vendor: 'Beta LLC', number: '4', amount: 75, received_date: '2026-02-02' }),
      sourceRow({ vendor: 'Beta LLC', number: '4', amount: 75, received_date: '2026-02-02' }),
    ];
    const report = reconcile(source, [], () => '', 'Sheet1');
    expect(report.suspectedDuplicates).toHaveLength(1);
    expect(report.suspectedDuplicates[0]).toHaveLength(2);
  });
});

describe('reconcile — added (extra system row)', () => {
  test('a system row with no source counterpart lands in added', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Regular Vendor', number: '1', amount: 100, received_date: '2026-05-01' })];
    const system: Invoice[] = [
      systemRow({ vendor_id: 'v-regular', number: '1', amount_usd: 100, received_date: '2026-05-01' }),
      // Thang-Le-style extra row — never appeared in the source tracker.
      systemRow({ vendor_id: 'v-thangle', number: 'EXTRA-1', amount_usd: 5250, received_date: '2026-04-15' }),
    ];
    const report = reconcile(source, system, vendorNameFrom({ 'v-regular': 'Regular Vendor', 'v-thangle': 'Thang Le & Associates' }), 'Sheet1');
    expect(report.added).toHaveLength(1);
    expect(report.added[0]).toEqual({ vendor: 'Thang Le & Associates', invoice_no: 'EXTRA-1', amount_usd: 5250, received_date: '2026-04-15' });
    expect(report.changed).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.possibleInvoiceNoDrift).toEqual([]);
  });
});

describe('reconcile — orphans (source row missing from system)', () => {
  test('a source row with no system counterpart lands in orphans', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Never Imported Co', number: 'X-1', amount: 300, received_date: '2026-03-03' })];
    const report = reconcile(source, [], () => '', 'Sheet1');
    expect(report.orphans).toEqual([{ vendor: 'Never Imported Co', invoice_no: 'X-1', amount_usd: 300, received_date: '2026-03-03' }]);
    expect(report.added).toEqual([]);
    expect(report.possibleInvoiceNoDrift).toEqual([]);
  });
});

describe('reconcile — changed (paid_date drift)', () => {
  test('a paid_date drift lands in changed, naming exactly that field', () => {
    const source: InvoiceRow[] = [sourceRow({
      vendor: 'Acme HVAC', number: '55', amount: 1200, received_date: '2026-06-01', paid_date: '2026-06-10',
    })];
    const system: Invoice[] = [systemRow({
      vendor_id: 'v-hvac', number: '55', amount_usd: 1200, received_date: '2026-06-01', paid_date: '2026-06-15',
    })];
    const report = reconcile(source, system, vendorNameFrom({ 'v-hvac': 'Acme HVAC' }), 'Sheet1');
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields).toEqual(['paid_date']);
    expect(report.changed[0].ref).toEqual({ vendor: 'Acme HVAC', invoice_no: '55', amount_usd: 1200, received_date: '2026-06-01' });
    expect(report.added).toEqual([]);
    expect(report.orphans).toEqual([]);
  });

  test('null vs null paid_date on both sides is not a change', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'X', number: '1', paid_date: null })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v1', number: '1', paid_date: null })];
    const report = reconcile(source, system, vendorNameFrom({ v1: 'X' }), 'Sheet1');
    expect(report.changed).toEqual([]);
  });
});

describe('reconcile — amount float-safety', () => {
  test('a float artifact that is the same money is NOT reported as changed', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Float Co', number: '9', amount: 181.3, received_date: '2026-07-04' })];
    // Simulates what a numeric(12,2) round-trip through Number() can produce
    // for the same $181.30 — this must not read as a "changed" amount.
    const system: Invoice[] = [systemRow({ vendor_id: 'v9', number: '9', amount_usd: 0.1 + 181.2, received_date: '2026-07-04' })];
    expect(0.1 + 181.2).not.toBe(181.3); // sanity: this really is a distinct float bit pattern
    const report = reconcile(source, system, vendorNameFrom({ v9: 'Float Co' }), 'Sheet1');
    expect(report.changed).toEqual([]);
  });

  test('a genuine one-cent difference IS reported as changed, naming amount_usd', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Float Co', number: '9', amount: 181.3, received_date: '2026-07-04' })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v9', number: '9', amount_usd: 181.31, received_date: '2026-07-04' })];
    const report = reconcile(source, system, vendorNameFrom({ v9: 'Float Co' }), 'Sheet1');
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields).toEqual(['amount_usd']);
  });
});

describe('reconcile — other changed fields', () => {
  test('received_date, status, entity and description drift are each named (matched via invoice_no, so amount/date are not part of the key)', () => {
    const source: InvoiceRow[] = [sourceRow({
      vendor: 'Multi Co', number: '3', amount: 50, received_date: '2026-08-01',
      status: 'approved', entity: 'LLC A', description: 'Site survey',
    })];
    const system: Invoice[] = [systemRow({
      vendor_id: 'v3', number: '3', amount_usd: 50, received_date: '2026-08-02',
      status: 'paid', entity: 'LLC B', budget_line: 'Something else',
    })];
    const report = reconcile(source, system, vendorNameFrom({ v3: 'Multi Co' }), 'Sheet1');
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields.sort()).toEqual(['description', 'entity', 'received_date', 'status'].sort());
  });

  test('entity/description differing only by case or surrounding whitespace is not a change', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Case Co', number: '11', entity: '  LLC A  ', description: 'Roof repair' })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v11', number: '11', entity: 'llc a', budget_line: 'ROOF REPAIR' })];
    const report = reconcile(source, system, vendorNameFrom({ v11: 'Case Co' }), 'Sheet1');
    expect(report.changed).toEqual([]);
  });

  test('several drifting fields on one row all land in the same entry', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Combo Co', number: '20', paid_date: '2026-09-01', status: 'paid' })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v20', number: '20', paid_date: null, status: 'approved' })];
    const report = reconcile(source, system, vendorNameFrom({ v20: 'Combo Co' }), 'Sheet1');
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields.sort()).toEqual(['paid_date', 'status']);
  });
});

describe('reconcile — vendor missing on the source row', () => {
  test('a null vendor does not crash and still keys on invoice_no', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: null, number: 'NOV-1', amount: 10, received_date: null })];
    const system: Invoice[] = [systemRow({ vendor_id: null, number: 'NOV-1', amount_usd: 10, received_date: null })];
    const report = reconcile(source, system, () => '', 'Sheet1');
    expect(report.changed).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.orphans).toEqual([]);
  });
});

describe('reconcile — invoice_no drift (present on only one side)', () => {
  // reconcileKey alone can never match these — a row with a number and a
  // row without one take different key SHAPES, so they'd otherwise surface
  // as a bare orphan + added pair. pairInvoiceNoDrift (lib/reconcile.ts) is
  // the second pass that catches this specific shape mismatch. Review round
  // 2, finding 3: an unpaired Orphans row reads as "add this", and doing so
  // here would create a duplicate of an invoice already on file — the exact
  // bug class this whole feature exists to catch.

  test('unambiguous: source blank, system has a number — pairs into changed, not orphan+added', () => {
    // The review's own scenario.
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Acme', number: null, amount: 5250, received_date: '2026-04-15' })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v-acme', number: 'INV-88', amount_usd: 5250, received_date: '2026-04-15' })];
    const report = reconcile(source, system, vendorNameFrom({ 'v-acme': 'Acme' }), 'Sheet1');
    expect(report.orphans).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields).toEqual(['invoice_no']);
    expect(report.changed[0].ref).toEqual({ vendor: 'Acme', invoice_no: null, amount_usd: 5250, received_date: '2026-04-15' });
    expect(report.possibleInvoiceNoDrift).toEqual([]);
  });

  test('unambiguous, reverse direction: source has a number, system blank — still pairs', () => {
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Beta Co', number: 'INV-50', amount: 900, received_date: '2026-03-15' })];
    const system: Invoice[] = [systemRow({ vendor_id: 'v-beta', number: null, amount_usd: 900, received_date: '2026-03-15' })];
    const report = reconcile(source, system, vendorNameFrom({ 'v-beta': 'Beta Co' }), 'Sheet1');
    expect(report.orphans).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].fields).toEqual(['invoice_no']);
    expect(report.changed[0].ref.invoice_no).toBe('INV-50');
    expect(report.possibleInvoiceNoDrift).toEqual([]);
  });

  test('ambiguous: two same-vendor/amount/date candidates on the numbered side — left in place, both flagged as possible matches', () => {
    // Two DIFFERENT invoice numbers, same vendor+amount+date, so pass 1
    // treats them as two clean singleton `added` entries (not a
    // suspectedDuplicates group — their reconcileKeys differ). Which one
    // (if either) the blank source row actually corresponds to can't be
    // inferred, so neither gets paired.
    const source: InvoiceRow[] = [sourceRow({ vendor: 'Acme', number: null, amount: 5250, received_date: '2026-04-15' })];
    const system: Invoice[] = [
      systemRow({ vendor_id: 'v-acme', number: 'INV-88', amount_usd: 5250, received_date: '2026-04-15' }),
      systemRow({ vendor_id: 'v-acme', number: 'INV-89', amount_usd: 5250, received_date: '2026-04-15' }),
    ];
    const report = reconcile(source, system, vendorNameFrom({ 'v-acme': 'Acme' }), 'Sheet1');
    // Nobody is silently paired, dropped, or merged — a human has to pick.
    expect(report.orphans).toHaveLength(1);
    expect(report.added).toHaveLength(2);
    expect(report.changed).toEqual([]);
    // But the ambiguity is surfaced, not silent: the orphan (which reads as
    // "add this") and both candidates it might actually already be are all
    // flagged.
    expect(report.possibleInvoiceNoDrift).toHaveLength(3);
    expect(report.possibleInvoiceNoDrift.some((r) => r.invoice_no === null)).toBe(true);
    expect(report.possibleInvoiceNoDrift.some((r) => r.invoice_no === 'INV-88')).toBe(true);
    expect(report.possibleInvoiceNoDrift.some((r) => r.invoice_no === 'INV-89')).toBe(true);
  });
});

describe('reconcile — counts include every row, duplicates included', () => {
  test('source/system counts are raw row counts, not post-dedup counts', () => {
    const source: InvoiceRow[] = [sourceRow(), sourceRow(), sourceRow()];
    const system: Invoice[] = [systemRow(), systemRow()];
    const report = reconcile(source, system, () => 'Acme Corp', 'Sheet1');
    expect(report.source).toBe(3);
    expect(report.system).toBe(2);
  });
});

describe('reconcileKey', () => {
  test('normalizes vendor punctuation/case the same way vendorKey does, keys on invoice_no when present', () => {
    expect(reconcileKey('Thang Le & Associates', 'INV-1', 100, '2026-01-01'))
      .toBe(reconcileKey('thang le& associates', 'inv-1', 999, '2099-12-31'));
  });

  test('falls back to vendor + amount + received_date when invoice_no is absent', () => {
    expect(reconcileKey('Acme Corp', null, 181.3, '2026-07-04'))
      .toBe(reconcileKey('Acme Corp', '  ', 181.3, '2026-07-04')); // blank string treated as absent
    expect(reconcileKey('Acme Corp', null, 181.3, '2026-07-04'))
      .not.toBe(reconcileKey('Acme Corp', null, 181.31, '2026-07-04'));
  });

  test('invoice_no vs fallback shapes never collide', () => {
    expect(reconcileKey('Acme Corp', '5', 100, '2026-01-01'))
      .not.toBe(reconcileKey('Acme Corp', null, 100, '2026-01-01'));
  });
});
