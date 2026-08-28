import { describe, expect, test } from 'vitest';
import {
  buildInvoiceRow, canonVendorName, decideCreateInvoiceOutcome, diffChangedKeys, findExactInvoiceDuplicate,
  findSuspectedInvoiceDuplicate, INVOICE_PATCH_KEYS, parseAmountInput, patchKeyForColumn, validateInvoicePatch,
  type InvoiceDupCandidate, type InvoiceDupQuery,
} from './invoice-rules.ts';

test('paid requires a payment date', () => {
  expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'paid' }))
    .toEqual({ error: 'paid date required' });
  expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'paid', paid_date: '2026-03-17' }))
    .toEqual({ ok: true });
});

test('leaving paid must state what happens to the date', () => {
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved' }))
    .toEqual({ error: 'confirm paid date' });
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved', paid_date: null }))
    .toEqual({ ok: true });
  expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'approved', paid_date: '2026-03-17' }))
    .toEqual({ ok: true });
});

describe('validateInvoicePatch — beyond the two given rules', () => {
  test('staying paid while the date is blanked out is the same "paid needs a date" violation', () => {
    expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { paid_date: null }))
      .toEqual({ error: 'paid date required' });
  });

  test('re-sending status: paid without ever touching paid_date is fine when a date is already on the row', () => {
    expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { status: 'paid', notes: 'x' }))
      .toEqual({ ok: true });
  });

  test('a patch that never mentions status is never treated as "leaving paid"', () => {
    expect(validateInvoicePatch({ status: 'paid', paid_date: '2026-03-17' }, { notes: 'updated' }))
      .toEqual({ ok: true });
  });

  test('setting a paid_date ahead of marking paid is allowed while status stays non-paid', () => {
    expect(validateInvoicePatch({ status: 'approved', paid_date: null }, { paid_date: '2026-04-01' }))
      .toEqual({ ok: true });
  });

  test('rejects a status outside the known values, and accepts cancelled (0019)', () => {
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'voided' as never }))
      .toEqual({ error: 'invalid status' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { status: 'cancelled' }))
      .toEqual({ ok: true });
  });

  test('rejects a link that is not https, accepts https and clearing to null/empty', () => {
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { invoice_url: 'http://x.com' }))
      .toEqual({ error: 'links must start with https://' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { receipt_url: 'not-a-url' }))
      .toEqual({ error: 'links must start with https://' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { transfer_confirmation_url: 'https://x.com' }))
      .toEqual({ ok: true });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { invoice_url: null }))
      .toEqual({ ok: true });
  });

  test('rejects a malformed received_date, accepts YYYY-MM-DD and clearing to null', () => {
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { received_date: '03/17/2026' }))
      .toEqual({ error: 'invalid date' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { received_date: '2026-03-17' }))
      .toEqual({ ok: true });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { received_date: null }))
      .toEqual({ ok: true });
  });

  test('amount_usd must be finite and non-negative when present, absent is fine', () => {
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: -1 }))
      .toEqual({ error: 'invalid amount' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: Number.NaN }))
      .toEqual({ error: 'invalid amount' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: Number.POSITIVE_INFINITY }))
      .toEqual({ error: 'invalid amount' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: 181.3 }))
      .toEqual({ ok: true });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: 0 }))
      .toEqual({ ok: true });
  });

  test('rejects a 3rd decimal digit even as a raw number, bypassing parseAmountInput entirely', () => {
    // The client (parseAmountInput) already rejects this string before it
    // becomes a number, but a direct call to the action is the real trust
    // boundary — this is what stops numeric(12,2) from silently rounding
    // 181.305 to 181.31 (or 181.30) instead of the write being rejected.
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: 181.305 }))
      .toEqual({ error: 'invalid amount' });
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: 181.30 }))
      .toEqual({ ok: true });
    // Not a *100/round check: a value whose nearest-double representation
    // genuinely isn't a clean 2-decimal number (e.g. the classic 0.1 + 0.2
    // float artifact) is correctly rejected too, without ever multiplying.
    expect(validateInvoicePatch({ status: 'received', paid_date: null }, { amount_usd: 0.1 + 0.2 }))
      .toEqual({ error: 'invalid amount' });
  });
});

describe('parseAmountInput', () => {
  test('accepts a whole dollar amount and one or two decimal places', () => {
    expect(parseAmountInput('181')).toBe(181);
    expect(parseAmountInput('181.3')).toBe(181.3);
    expect(parseAmountInput('181.30')).toBe(181.3);
    expect(parseAmountInput('0.01')).toBe(0.01);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseAmountInput('  42.50  ')).toBe(42.5);
  });

  test('rejects a third decimal digit instead of silently rounding it away', () => {
    expect(parseAmountInput('181.305')).toBeNull();
  });

  test('rejects negative amounts, empty input, non-numeric text and scientific notation', () => {
    expect(parseAmountInput('-5')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('1e3')).toBeNull();
  });

  test('a large-but-realistic amount round-trips exactly, in cents, through the parse', () => {
    const n = parseAmountInput('1234567.89');
    expect(n).toBe(1234567.89);
    expect(Math.round((n as number) * 100)).toBe(123456789);
  });
});

describe('buildInvoiceRow', () => {
  test('maps invoice_no -> number and description -> budget_line (no invoice_no/description column exists)', () => {
    expect(buildInvoiceRow({ invoice_no: 'INV-42', description: 'Site survey' }))
      .toEqual({ number: 'INV-42', budget_line: 'Site survey' });
  });

  test('every other key maps 1:1 to its column name', () => {
    const full = {
      vendor_id: 'v1', invoice_no: 'INV-1', project_id: 'p1', entity: 'LLC A',
      received_date: '2026-03-01', description: 'desc', amount_usd: 100.5,
      status: 'approved' as const, paid_date: '2026-03-02',
      invoice_url: 'https://a.com', receipt_url: 'https://b.com',
      transfer_confirmation_url: 'https://c.com', notes: 'note',
    };
    expect(buildInvoiceRow(full)).toEqual({
      vendor_id: 'v1', number: 'INV-1', project_id: 'p1', entity: 'LLC A',
      received_date: '2026-03-01', budget_line: 'desc', amount_usd: 100.5,
      status: 'approved', paid_date: '2026-03-02',
      invoice_url: 'https://a.com', receipt_url: 'https://b.com',
      transfer_confirmation_url: 'https://c.com', notes: 'note',
    });
  });

  test('trims free text and collapses empty string to null, but never touches an absent key', () => {
    expect(buildInvoiceRow({ entity: '  LLC B  ', notes: '   ' })).toEqual({ entity: 'LLC B', notes: null });
    const result = buildInvoiceRow({ vendor_id: 'v1' });
    expect(result).toEqual({ vendor_id: 'v1' });
    expect('notes' in result).toBe(false);
  });

  test('explicit null clears a field instead of being skipped', () => {
    expect(buildInvoiceRow({ project_id: null, paid_date: null })).toEqual({ project_id: null, paid_date: null });
  });

  test('never coerces an empty status to null — status is not free text', () => {
    // amount_usd is a number, not a string, so it also skips the trim path —
    // covered here alongside status so both non-text branches are exercised.
    expect(buildInvoiceRow({ status: 'paid', amount_usd: 0 })).toEqual({ status: 'paid', amount_usd: 0 });
  });

  test('ignores any key outside INVOICE_PATCH_KEYS even if smuggled onto the patch', () => {
    const smuggled = { vendor_id: 'v1', id: 'should-not-write', created_at: 'nope' } as never;
    expect(buildInvoiceRow(smuggled)).toEqual({ vendor_id: 'v1' });
  });

  test('INVOICE_PATCH_KEYS has no duplicates and matches the InvoicePatch shape used above', () => {
    expect(new Set(INVOICE_PATCH_KEYS).size).toBe(INVOICE_PATCH_KEYS.length);
  });
});

describe('canonVendorName', () => {
  test('trims and collapses internal whitespace, preserving case', () => {
    expect(canonVendorName('  Acme   Corp  ')).toBe('Acme Corp');
  });

  // vendorKey itself (the matching key — punctuation/suffix-stripping,
  // case-insensitive) is tested thoroughly in lib/import/vendor-key.test.ts,
  // its one canonical home; not duplicated here.
});

describe('findExactInvoiceDuplicate / findSuspectedInvoiceDuplicate', () => {
  const existingInvoice = (overrides: Partial<InvoiceDupCandidate> = {}): InvoiceDupCandidate => ({
    id: 'existing-1', vendorId: 'v1', vendorName: 'Acme Corp', invoiceNo: 'INV-1', amountUsd: 100,
    receivedDate: '2026-03-01', entity: 'LLC A', projectId: 'p1',
    ...overrides,
  });
  const baseQuery = (overrides: Partial<InvoiceDupQuery> = {}): InvoiceDupQuery => ({
    vendorId: 'v1', vendorName: 'Acme Corp', invoiceNo: 'INV-1', amountUsd: 100,
    receivedDate: '2026-03-01', entity: 'LLC A', projectId: 'p1',
    ...overrides,
  });

  test('exact key matches vendor case/whitespace-insensitively plus the exact invoice number and entity', () => {
    const hit = findExactInvoiceDuplicate(
      baseQuery({ vendorId: 'v2', vendorName: '  acme   corp ', invoiceNo: 'inv-1', amountUsd: 999, receivedDate: null, entity: ' llc a ', projectId: null }),
      [existingInvoice()],
    );
    expect(hit?.id).toBe('existing-1');
  });

  // Q7 (Noa, 2026-08-27): the same number for the same vendor under a
  // DIFFERENT entity is a different invoice, never an exact duplicate —
  // SNO Solutions files invoice No.1 once per LLC. Mirrors migration 0018's
  // unique (vendor_id, number, entity).
  test('exact key: same vendor + same number under a different entity is not a match', () => {
    expect(findExactInvoiceDuplicate(
      baseQuery({ entity: 'LLC B' }),
      [existingInvoice({ entity: 'LLC A' })],
    )).toBeNull();
  });

  test('exact key: null and blank entity are the same "unset" — two entity-less rows still collide', () => {
    const hit = findExactInvoiceDuplicate(
      baseQuery({ entity: '  ' }),
      [existingInvoice({ entity: null })],
    );
    expect(hit?.id).toBe('existing-1');
  });

  // Critical review finding: both keys previously used a weaker vendor
  // normalizer (trim/lowercase only), which missed exactly the case the
  // invoice audit documents — "Thang Le & Associates" vs "Thang le&
  // Associates" are the same vendor split into two rows, and a duplicate
  // invoice filed under the second row used to insert unflagged. Both keys
  // now route through vendorKey (lib/import/tracker.ts's own, punctuation/
  // suffix-stripping) instead, so this must be caught.
  test('exact key catches a punctuation-only vendor variant, not just whitespace/case (the audit\'s own example)', () => {
    const hit = findExactInvoiceDuplicate(
      baseQuery({ vendorId: 'v2', vendorName: 'Thang le& Associates', invoiceNo: 'INV-1' }),
      [existingInvoice({ vendorId: 'v1', vendorName: 'Thang Le & Associates' })],
    );
    expect(hit?.id).toBe('existing-1');
  });

  test('suspicion key also catches a punctuation-only vendor variant', () => {
    const hit = findSuspectedInvoiceDuplicate(
      baseQuery({ vendorId: 'v2', vendorName: 'Thang le& Associates', invoiceNo: 'a-different-number' }),
      [existingInvoice({ vendorId: 'v1', vendorName: 'Thang Le & Associates' })],
    );
    expect(hit?.id).toBe('existing-1');
  });

  test('exact key: a different invoice number on the same vendor is not a match', () => {
    expect(findExactInvoiceDuplicate(baseQuery({ invoiceNo: 'INV-2' }), [existingInvoice()])).toBeNull();
  });

  test('exact key: never matches when the new invoice has no number, regardless of the candidate', () => {
    expect(findExactInvoiceDuplicate(
      baseQuery({ invoiceNo: null }),
      [existingInvoice({ invoiceNo: null })],
    )).toBeNull();
  });

  test('suspicion key matches vendor + amount + received date + entity + project, ignoring invoice number entirely', () => {
    const hit = findSuspectedInvoiceDuplicate(
      baseQuery({ invoiceNo: 'a-totally-different-number' }),
      [existingInvoice()],
    );
    expect(hit?.id).toBe('existing-1');
  });

  test('suspicion key: any one differing field breaks the match', () => {
    const base = baseQuery({ invoiceNo: null });
    const existing = [existingInvoice()];
    expect(findSuspectedInvoiceDuplicate({ ...base, amountUsd: 100.01 }, existing)).toBeNull();
    expect(findSuspectedInvoiceDuplicate({ ...base, receivedDate: '2026-03-02' }, existing)).toBeNull();
    expect(findSuspectedInvoiceDuplicate({ ...base, entity: 'LLC B' }, existing)).toBeNull();
    expect(findSuspectedInvoiceDuplicate({ ...base, projectId: 'p2' }, existing)).toBeNull();
  });

  test('suspicion key: null entity/project and a blank entity string are the same "unset"', () => {
    const hit = findSuspectedInvoiceDuplicate(
      baseQuery({ invoiceNo: null, entity: '  ', projectId: null }),
      [existingInvoice({ entity: null, projectId: null })],
    );
    expect(hit?.id).toBe('existing-1');
  });
});

describe('decideCreateInvoiceOutcome', () => {
  const existingInvoice = (overrides: Partial<InvoiceDupCandidate> = {}): InvoiceDupCandidate => ({
    id: 'existing-1', vendorId: 'v1', vendorName: 'Acme Corp', invoiceNo: 'INV-1', amountUsd: 100,
    receivedDate: '2026-03-01', entity: 'LLC A', projectId: 'p1',
    ...overrides,
  });
  const baseQuery = (overrides: Partial<InvoiceDupQuery> = {}): InvoiceDupQuery => ({
    vendorId: 'v2', vendorName: 'Acme Corp', invoiceNo: 'INV-1', amountUsd: 100,
    receivedDate: '2026-03-01', entity: 'LLC A', projectId: 'p1',
    ...overrides,
  });

  test('clean (no match on either key): insert, not flagged', () => {
    // Differs on invoice number (breaks the exact key) AND amount (breaks
    // the suspicion key too) — a genuinely unrelated invoice.
    expect(decideCreateInvoiceOutcome(baseQuery({ invoiceNo: 'INV-999', amountUsd: 250 }), [existingInvoice()], false))
      .toEqual({ kind: 'insert', needsVerification: false });
  });

  test('clean, force=true: force is a no-op with nothing to force past', () => {
    expect(decideCreateInvoiceOutcome(baseQuery({ invoiceNo: 'INV-999', amountUsd: 250 }), [existingInvoice()], true))
      .toEqual({ kind: 'insert', needsVerification: false });
  });

  test('missing invoice number: insert, flagged, regardless of force', () => {
    expect(decideCreateInvoiceOutcome(baseQuery({ invoiceNo: null }), [], false))
      .toEqual({ kind: 'insert', needsVerification: true });
    expect(decideCreateInvoiceOutcome(baseQuery({ invoiceNo: null }), [], true))
      .toEqual({ kind: 'insert', needsVerification: true });
  });

  test('suspicion match only: insert, flagged, regardless of force', () => {
    const candidates = [existingInvoice({ invoiceNo: 'a-different-number' })];
    expect(decideCreateInvoiceOutcome(baseQuery(), candidates, false)).toEqual({ kind: 'insert', needsVerification: true });
    expect(decideCreateInvoiceOutcome(baseQuery(), candidates, true)).toEqual({ kind: 'insert', needsVerification: true });
  });

  test('exact match, different vendor_id, no force: blocked with the dup row', () => {
    const dup = existingInvoice();
    expect(decideCreateInvoiceOutcome(baseQuery(), [dup], false)).toEqual({ kind: 'blocked', dup });
  });

  test('exact match, different vendor_id, force: inserts flagged (not the same DB row, no constraint collision)', () => {
    const dup = existingInvoice({ vendorId: 'v1' }); // query below is vendorId 'v2'
    expect(decideCreateInvoiceOutcome(baseQuery({ vendorId: 'v2' }), [dup], true))
      .toEqual({ kind: 'insert', needsVerification: true });
  });

  // Critical review finding: an exact match sharing the literal same
  // vendor_id is the ORDINARY case (vendors.name is itself unique), and
  // forcing it would hit the table's `unique (vendor_id, number)`
  // constraint — this must be refused with a named outcome, never left to
  // reach Postgres.
  test('exact match, SAME vendor_id, no force: still just blocked (force not relevant yet)', () => {
    const dup = existingInvoice({ vendorId: 'v-shared' });
    expect(decideCreateInvoiceOutcome(baseQuery({ vendorId: 'v-shared' }), [dup], false)).toEqual({ kind: 'blocked', dup });
  });

  test('exact match, SAME vendor_id, force: blockedSameVendor — never silently inserts, never reaches the DB constraint', () => {
    const dup = existingInvoice({ vendorId: 'v-shared' });
    expect(decideCreateInvoiceOutcome(baseQuery({ vendorId: 'v-shared' }), [dup], true)).toEqual({ kind: 'blockedSameVendor' });
  });

  // Q7: a different entity breaks the exact key entirely, so the same
  // vendor + number under another LLC is an ordinary insert — the DB's
  // unique (vendor_id, number, entity) (0018) allows it too. The suspicion
  // key can't fire either here (entity is one of its fields), so this is a
  // clean, unflagged insert.
  test('same vendor_id + same number under a DIFFERENT entity: plain insert, no block, no flag', () => {
    const dup = existingInvoice({ vendorId: 'v-shared', entity: 'LLC A' });
    expect(decideCreateInvoiceOutcome(baseQuery({ vendorId: 'v-shared', entity: 'LLC B' }), [dup], false))
      .toEqual({ kind: 'insert', needsVerification: false });
  });
});

describe('diffChangedKeys', () => {
  test('a create (before null) reports every key present in after', () => {
    expect(diffChangedKeys(null, { vendor_id: 'v1', amount_usd: 100 }).sort()).toEqual(['amount_usd', 'vendor_id']);
  });

  test('an edit reports only the keys whose value actually changed', () => {
    expect(diffChangedKeys({ status: 'received', amount_usd: 100 }, { status: 'approved', amount_usd: 100 }))
      .toEqual(['status']);
  });

  test('null and an absent key are the same "no value" for comparison purposes', () => {
    expect(diffChangedKeys({ notes: null }, {})).toEqual([]);
  });

  test('no changes at all reports an empty list', () => {
    expect(diffChangedKeys({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('patchKeyForColumn', () => {
  test('resolves a real column back to the InvoicePatch key that writes it', () => {
    expect(patchKeyForColumn('number')).toBe('invoice_no');
    expect(patchKeyForColumn('budget_line')).toBe('description');
    expect(patchKeyForColumn('vendor_id')).toBe('vendor_id');
  });

  test('a column outside INVOICE_PATCH_KEYS (create-only columns) resolves to null', () => {
    expect(patchKeyForColumn('needs_verification')).toBeNull();
    expect(patchKeyForColumn('tab')).toBeNull();
  });
});
