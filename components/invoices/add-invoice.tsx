'use client';

import { useState, useTransition } from 'react';
import { createInvoice, type InvoiceDupInfo } from '@/app/actions/invoices';
import { INVOICE_ERRORS, parseAmountInput } from '@/lib/invoice-rules';
// Imported, not received as a prop: a function prop from the server page is
// exactly what took /invoices down in Next 16 (QA item 03) — see lib/format.ts.
import { moneyExact } from '@/lib/format';
import { SavedChip } from '@/components/work/saved-chip';
import type { LinkEditorOptions } from '@/components/invoices/link-editor';

interface Props {
  /** Same vendors/projects/entities LinkEditor already builds once in
   *  page.tsx — reused as-is, not a second options object. */
  options: LinkEditorOptions;
  labels: Record<string, string>;
}

// E4: header "+ Add invoice" button + duplicate-confirm dialog. Mirrors
// components/work/add-action.tsx's shape — trigger button -> form ->
// optional reconciliation step — for the same "check before creating a
// possible twin" reason, but the check underneath has two outcomes AddAction
// never has to distinguish: an EXACT match (normalized vendor + invoice_no)
// refuses outright and lands here as `dup`; a SUSPICION match (vendor +
// amount + received_date + entity + project) never blocks at all —
// createInvoice inserts it flagged needs_verification and this dialog never
// even sees it.
export function AddInvoice({ options, labels }: Props) {
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [entity, setEntity] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dup, setDup] = useState<InvoiceDupInfo | null>(null);
  const [result, setResult] = useState<{ message: string } | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsedAmount = parseAmountInput(amount);
  // Empty stays neutral (no red border on a field nobody has touched yet) —
  // the Save button's own disabled condition below is what actually
  // enforces "amount is required", same division of labor as link-editor's
  // amountInvalid/blocked pair.
  const amountInvalid = amount !== '' && parsedAmount === null;

  const reset = () => {
    setOpen(false);
    setVendorId(''); setInvoiceNo(''); setProjectId(''); setEntity('');
    setReceivedDate(''); setDescription(''); setAmount('');
    setDup(null); setErrorCode(null);
  };

  // Same shape as link-editor.tsx's own errorMessage: every named
  // INVOICE_ERRORS code createInvoice can return gets specific text; a raw
  // Postgres message (e.g. the `unique (vendor_id, number)` constraint
  // firing on a forced insert of a literal existing vendor+number pair)
  // still reaches the user behind a translated lead-in.
  const errorMessage = (code: string): string => {
    switch (code) {
      case INVOICE_ERRORS.vendorRequired: return labels.errorVendorRequired;
      case INVOICE_ERRORS.invalidAmount: return labels.invalidAmount;
      case INVOICE_ERRORS.invalidDate: return labels.errorInvalidDate;
      // "Add anyway" was forced past an exact match that turned out to share
      // the same vendor row — createInvoice refused before ever attempting
      // the insert, so this is the clean, named message instead of the raw
      // `unique (vendor_id, number)` constraint text.
      case INVOICE_ERRORS.duplicateNumber: return labels.errorDuplicateNumber;
      // Migration 0017_invoice_verify.sql hasn't been applied yet — nothing
      // the user can do; this needs to reach whoever runs migrations.
      case INVOICE_ERRORS.migrationPending: return labels.errorMigrationPending;
      default: return labels.errorSaveReason.replace('{reason}', `⁨${code}⁩`);
    }
  };

  const submit = (force: boolean) => start(async () => {
    setErrorCode(null);
    if (!vendorId) { setErrorCode(INVOICE_ERRORS.vendorRequired); return; }
    if (parsedAmount === null) { setErrorCode(INVOICE_ERRORS.invalidAmount); return; }
    const res = await createInvoice({
      vendorId,
      invoiceNo: invoiceNo.trim() || null,
      projectId: projectId || null,
      entity: entity.trim() || null,
      receivedDate: receivedDate || null,
      description: description.trim() || null,
      amountUsd: parsedAmount,
      force,
    });
    if ('dup' in res) { setDup(res.dup); return; }
    if ('error' in res) { setErrorCode(res.error); return; }
    setOpen(false);
    setResult({ message: res.needsVerification ? labels.createdVerify : labels.created });
  });

  // "Same invoice — open it": points at the existing row via the URL hash
  // (page.tsx gives every <tr> a matching id) rather than reaching across
  // components with a ref — app/globals.css's `.sk-page tr:target` rule does
  // the actual highlighting, and the browser's native anchor-scroll does the
  // scrolling, so nothing here has to track or clean up a timer.
  const openExisting = () => {
    const id = dup?.id;
    reset();
    if (id) window.location.hash = `invoice-${id}`;
  };

  // Post-create confirmation. undoId is always null here — a create has no
  // prior row to restore, so there is nothing an Undo button could do;
  // SavedChip already degrades to "no Undo, dismiss still works" for exactly
  // that case (see its own prop doc).
  if (result) {
    return (
      <SavedChip
        message={result.message}
        undoId={null}
        pending={false}
        onUndo={() => {}}
        onDismiss={() => setResult(null)}
        labels={{ recorded: labels.recorded, undo: labels.undo, cancel: labels.cancel }}
      />
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 sm:min-h-0"
      >
        {labels.addInvoice}
      </button>
    );
  }

  return (
    <>
      {/* Modal ground — clicking outside closes; Escape via key handler. */}
      <button
        type="button"
        aria-label={labels.cancel}
        onClick={reset}
        className="fixed inset-0 z-40 cursor-default bg-ink/30 motion-safe:animate-sk-fade"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labels.addInvoice}
        onKeyDown={(e) => { if (e.key === 'Escape') reset(); }}
        className="fixed inset-x-3 top-[8dvh] z-50 mx-auto max-h-[85dvh] max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-5 text-start shadow-card motion-safe:animate-sk-pop"
      >
        {dup === null ? (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">{labels.addInvoice}</p>
            <div className="mt-3 space-y-2.5">
              <label className="block text-xs text-ink2">
                <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.vendor}</span>
                <select
                  autoFocus
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  aria-label={labels.vendor}
                  className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                >
                  <option value="">—</option>
                  {options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-ink2">
                  <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.invoiceNo}</span>
                  <input
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                  />
                </label>
                <label className="block text-xs text-ink2">
                  <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.amount}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-invalid={amountInvalid || undefined}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={`min-h-11 w-full rounded-lg border bg-card px-3 py-2 font-mono text-sm text-ink outline-none ${amountInvalid ? 'border-coral' : 'border-line'}`}
                  />
                </label>
              </div>
              {amountInvalid && <p role="alert" className="text-[10px] font-semibold text-coral">{labels.invalidAmount}</p>}

              {!invoiceNo.trim() && (
                <p className="rounded-lg bg-apricot-soft px-2.5 py-1.5 text-[10px] text-apricot">{labels.noNumberHint}</p>
              )}

              <label className="block text-xs text-ink2">
                <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.project}</span>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  aria-label={labels.project}
                  className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                >
                  <option value="">{labels.general}</option>
                  {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-ink2">
                  <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.entity}</span>
                  <input
                    value={entity}
                    onChange={(e) => setEntity(e.target.value)}
                    list="add-invoice-entity-list"
                    className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                  />
                  <datalist id="add-invoice-entity-list">
                    {options.entities.map((e) => <option key={e} value={e} />)}
                  </datalist>
                </label>
                <label className="block text-xs text-ink2">
                  <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.receivedDate}</span>
                  <input
                    type="date"
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                  />
                </label>
              </div>

              <label className="block text-xs text-ink2">
                <span className="mb-0.5 block text-[10px] font-medium text-ink3">{labels.description}</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending || !vendorId || amountInvalid || amount === ''}
                onClick={() => submit(false)}
                className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
              >
                {labels.save}
              </button>
              <button
                type="button"
                onClick={reset}
                className="min-h-11 cursor-pointer rounded-[9px] px-3 py-2 text-sm text-ink3 hover:text-ink sm:min-h-0"
              >
                {labels.cancel}
              </button>
              {errorCode && <span role="alert" className="text-xs text-coral">{errorMessage(errorCode)}</span>}
            </div>
          </>
        ) : (
          <>
            {/* Exact-key hit: createInvoice refused to insert. Mirrors
                AddAction's reconciliation step shape (kicker/title/sub, a
                candidate card, two resolving actions + Back). */}
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-apricot">{labels.dupKicker}</p>
            <h2 className="mt-1 text-[15px] font-[650] leading-[1.25] text-sk-ink">{labels.dupTitle}</h2>
            <p className="mt-1 text-xs text-ink2">{labels.dupSub.replace('{vendor}', `⁨${dup.vendor}⁩`)}</p>
            <div className="mt-3 rounded-xl border border-line bg-card2 p-3">
              <p className="text-sm font-medium text-ink">{dup.vendor}</p>
              <p className="mt-0.5 text-[11px] text-ink3">
                {[moneyExact(dup.amount_usd), dup.received_date].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openExisting}
                className="min-h-11 cursor-pointer rounded-full border border-sage-line px-3 py-1 text-xs text-sage hover:bg-sage-soft sm:min-h-0"
              >
                {labels.dupSame}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => submit(true)}
                className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
              >
                {labels.dupNew}
              </button>
              <button
                type="button"
                onClick={() => setDup(null)}
                className="min-h-11 cursor-pointer rounded-[9px] px-3 py-2 text-sm text-ink3 hover:text-ink sm:min-h-0"
              >
                {labels.back}
              </button>
              {errorCode && <span role="alert" className="text-xs text-coral">{errorMessage(errorCode)}</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
