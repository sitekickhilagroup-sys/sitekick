'use client';

import { useState, useTransition } from 'react';
import { updateInvoice, undoInvoiceEdit, type InvoicePatch } from '@/app/actions/invoices';
import { INVOICE_ERRORS, parseAmountInput } from '@/lib/invoice-rules';
import { SavedChip } from '@/components/work/saved-chip';
import type { InvoiceStatus } from '@/lib/types';

interface Labels {
  edit: string;
  save?: string;
  invoice: string;
  receipt: string;
  transfer: string;
  cancel: string;
  status: string;
  paidDate: string;
  notes: string;
  vendor: string;
  invoiceNo: string;
  project: string;
  general: string;
  entity: string;
  receivedDate: string;
  description: string;
  amount: string;
  recorded: string;
  undo: string;
  confirmPaidDate: string;
  keepDate: string;
  clearDate: string;
  paidDateRequired: string;
  invalidAmount: string;
  /** Every rejection updateInvoice/undoInvoiceEdit can return gets its own
   *  message — see errorMessage() below. errorSaveReason is the fallback for
   *  a raw Postgres error text neither of them anticipated (still shown, with
   *  a lead-in, never swallowed into one blanket "Couldn't save"). */
  errorInvalidStatus: string;
  errorInvalidLink: string;
  errorInvalidDate: string;
  errorNotFound: string;
  errorEmptyPatch: string;
  errorNothingToUndo: string;
  errorSaveReason: string;
}

export interface LinkEditorOptions {
  vendors: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  /** Distinct entity values already on the books — same list FilterBar
   *  offers, reused here as <datalist> suggestions rather than a second
   *  query for the same column. */
  entities: string[];
}

interface Props {
  invoiceId: string;
  vendorId: string | null;
  invoiceNo: string | null;
  projectId: string | null;
  entity: string | null;
  receivedDate: string | null;
  description: string | null;
  amountUsd: number;
  status: InvoiceStatus;
  paidDate: string | null;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  transferUrl: string | null;
  notes: string | null;
  /** status value -> localized label */
  statusLabels: Record<string, string>;
  options: LinkEditorOptions;
  /** Row-identifying text (vendor / number) so screen readers can tell rows apart. */
  context?: string;
  labels: Labels;
}

// Spec §יב "Update Invoice": one editor, one Save, growing (E2) from
// status/paid-date/links/notes to the full row — Vendor, Invoice no.,
// Project, Entity, Received date, Description and Amount join the same
// patch. Structured like TaskEditor (components/work/task-editor.tsx): a
// dialog/sheet rather than the old inline column, because a 12-field form no
// longer fits a w-56 strip in a table cell, and the same "Recorded · Undo"
// SavedChip outcome every other audited write in this round already shows.
//
// Positioning contract: unlike TaskEditor, this component provides its OWN
// `relative inline-block` anchor (matching verb-menu.tsx's own top-level
// wrapper) rather than relying on the caller for one — the table cell this
// renders in isn't a dedicated wrapper the way VerbMenu's trigger+menu pair
// is, so the anchor lives here instead.
export function LinkEditor({
  invoiceId, vendorId, invoiceNo, projectId, entity, receivedDate, description, amountUsd,
  status, paidDate, invoiceUrl, receiptUrl, transferUrl, notes, statusLabels, options, context, labels,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [vendorDraft, setVendorDraft] = useState(vendorId ?? '');
  const [invoiceNoDraft, setInvoiceNoDraft] = useState(invoiceNo ?? '');
  const [projectDraft, setProjectDraft] = useState(projectId ?? '');
  const [entityDraft, setEntityDraft] = useState(entity ?? '');
  const [receivedDraft, setReceivedDraft] = useState(receivedDate ?? '');
  const [descriptionDraft, setDescriptionDraft] = useState(description ?? '');
  const [amountDraft, setAmountDraft] = useState(amountUsd.toFixed(2));
  const [statusDraft, setStatusDraft] = useState<InvoiceStatus>(status);
  const [paidDraft, setPaidDraft] = useState(paidDate ?? '');
  // E3: leaving Paid must explicitly say what happens to the recorded date.
  // Tracks "the user acted on the prompt" — via Keep, Clear, or editing the
  // date directly — independent of which value that leaves paidDraft at.
  const [paidDateAcked, setPaidDateAcked] = useState(false);
  const [invoiceUrlDraft, setInvoiceUrlDraft] = useState(invoiceUrl ?? '');
  const [receiptUrlDraft, setReceiptUrlDraft] = useState(receiptUrl ?? '');
  const [transferUrlDraft, setTransferUrlDraft] = useState(transferUrl ?? '');
  const [notesDraft, setNotesDraft] = useState(notes ?? '');
  // Holds the exact code updateInvoice/undoInvoiceEdit returned (an
  // INVOICE_ERRORS value, or raw Postgres text) — not a boolean — so the
  // message shown is the real reason, not a generic "Couldn't save".
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; undoId: string | null } | null>(null);
  const [pending, start] = useTransition();

  const startEditing = () => {
    setVendorDraft(vendorId ?? '');
    setInvoiceNoDraft(invoiceNo ?? '');
    setProjectDraft(projectId ?? '');
    setEntityDraft(entity ?? '');
    setReceivedDraft(receivedDate ?? '');
    setDescriptionDraft(description ?? '');
    setAmountDraft(amountUsd.toFixed(2));
    setStatusDraft(status);
    setPaidDraft(paidDate ?? '');
    setPaidDateAcked(false);
    setInvoiceUrlDraft(invoiceUrl ?? '');
    setReceiptUrlDraft(receiptUrl ?? '');
    setTransferUrlDraft(transferUrl ?? '');
    setNotesDraft(notes ?? '');
    setErrorCode(null);
    setEditing(true);
  };

  const setStatusAndReset = (next: InvoiceStatus) => {
    setStatusDraft(next);
    setPaidDateAcked(false);
  };

  // E3 rules, mirrored client-side so a bad save is blocked before the round
  // trip, not just after a server error — validateInvoicePatch still re-checks
  // all of this server-side as the source of truth.
  const leavingPaid = status === 'paid' && statusDraft !== 'paid';
  const paidNeedsDate = statusDraft === 'paid' && !paidDraft;
  const parsedAmount = parseAmountInput(amountDraft);
  const amountInvalid = parsedAmount === null;
  // Same idea for the three link fields — validateInvoicePatch enforces this
  // https-only rule server-side regardless, but until this existed it was the
  // one field group with no client check at all: any of the three reaching
  // Save with a non-https value used to round-trip only to come back as the
  // same blanket "Couldn't save" every other rejection did.
  const okLink = (u: string) => u === '' || /^https:\/\//.test(u);
  const invoiceUrlInvalid = !okLink(invoiceUrlDraft);
  const receiptUrlInvalid = !okLink(receiptUrlDraft);
  const transferUrlInvalid = !okLink(transferUrlDraft);
  const linkInvalid = invoiceUrlInvalid || receiptUrlInvalid || transferUrlInvalid;
  const blocked = amountInvalid || paidNeedsDate || linkInvalid || (leavingPaid && !paidDateAcked);

  // Maps a server rejection to a specific, translated message. The known
  // codes (INVOICE_ERRORS, shared with lib/invoice-rules.ts so this can't
  // drift from what the action actually returns) each get their own text;
  // anything else — a raw Postgres constraint/FK message neither
  // validateInvoicePatch nor updateInvoice anticipated — still reaches the
  // user, behind a translated lead-in, instead of disappearing into one
  // generic string. FSI/PDI (⁨…⁩) bidi-isolate that raw text the same way
  // page.tsx already isolates other dynamic values inside Hebrew sentences.
  const errorMessage = (code: string): string => {
    switch (code) {
      case INVOICE_ERRORS.invalidStatus: return labels.errorInvalidStatus;
      case INVOICE_ERRORS.invalidLink: return labels.errorInvalidLink;
      case INVOICE_ERRORS.invalidDate: return labels.errorInvalidDate;
      case INVOICE_ERRORS.invalidAmount: return labels.invalidAmount;
      case INVOICE_ERRORS.paidDateRequired: return labels.paidDateRequired;
      case INVOICE_ERRORS.confirmPaidDate: return labels.confirmPaidDate;
      case INVOICE_ERRORS.notFound: return labels.errorNotFound;
      case INVOICE_ERRORS.emptyPatch: return labels.errorEmptyPatch;
      case INVOICE_ERRORS.nothingToUndo: return labels.errorNothingToUndo;
      default: return labels.errorSaveReason.replace('{reason}', `⁨${code}⁩`);
    }
  };

  const save = () => start(async () => {
    setErrorCode(null);
    // Only the fields actually touched — sending every field back would
    // silently revert a concurrent change this row hasn't re-rendered yet.
    const patch: InvoicePatch = {};
    if (vendorDraft !== (vendorId ?? '')) patch.vendor_id = vendorDraft || null;
    if (invoiceNoDraft !== (invoiceNo ?? '')) patch.invoice_no = invoiceNoDraft.trim() || null;
    if (projectDraft !== (projectId ?? '')) patch.project_id = projectDraft || null;
    if (entityDraft !== (entity ?? '')) patch.entity = entityDraft.trim() || null;
    if (receivedDraft !== (receivedDate ?? '')) patch.received_date = receivedDraft || null;
    if (descriptionDraft !== (description ?? '')) patch.description = descriptionDraft.trim() || null;
    if (parsedAmount !== null && parsedAmount !== amountUsd) patch.amount_usd = parsedAmount;
    if (statusDraft !== status) patch.status = statusDraft;
    // Leaving paid must always carry paid_date explicitly (kept or cleared),
    // even when that leaves it equal to the value it already had.
    if (leavingPaid) patch.paid_date = paidDraft || null;
    else if (paidDraft !== (paidDate ?? '')) patch.paid_date = paidDraft || null;
    if (invoiceUrlDraft !== (invoiceUrl ?? '')) patch.invoice_url = invoiceUrlDraft.trim() || null;
    if (receiptUrlDraft !== (receiptUrl ?? '')) patch.receipt_url = receiptUrlDraft.trim() || null;
    if (transferUrlDraft !== (transferUrl ?? '')) patch.transfer_confirmation_url = transferUrlDraft.trim() || null;
    if (notesDraft !== (notes ?? '')) patch.notes = notesDraft.trim() || null;

    if (Object.keys(patch).length === 0) { setEditing(false); return; }

    const res = await updateInvoice(invoiceId, patch);
    if ('error' in res) { setErrorCode(res.error); return; }
    setEditing(false);
    setResult({ message: labels.recorded, undoId: res.undoId });
  });

  const undo = () => start(async () => {
    setErrorCode(null);
    if (!result?.undoId) { setResult(null); return; }
    const res = await undoInvoiceEdit(result.undoId);
    if ('error' in res) { setErrorCode(res.error); return; }
    setResult(null);
  });

  const fieldCls = 'block text-xs text-ink2';
  const labelCls = 'mb-0.5 block text-[10px] font-medium text-ink3';
  const inputCls = (invalid?: boolean) =>
    `min-h-11 w-full rounded-lg border bg-card2 px-2 py-1.5 text-sm text-ink outline-none sm:min-h-9 ${invalid ? 'border-coral' : 'border-line'}`;
  const entityListId = `invoice-entity-list-${invoiceId}`;

  return (
    <span className="relative inline-block">
      {!editing && !result && (
        <button
          type="button"
          title={labels.edit}
          aria-label={context ? `${labels.edit} · ${context}` : labels.edit}
          onClick={startEditing}
          className="inline-flex min-h-11 items-center rounded-full px-2 py-0.5 text-xs text-ink3 hover:text-ink2 sm:min-h-7"
        >
          <span aria-hidden="true">✎</span>
        </button>
      )}

      {result && (
        <span className="inline-flex flex-col items-start gap-1">
          <SavedChip message={result.message} undoId={result.undoId} pending={pending}
            onUndo={undo} onDismiss={() => { setResult(null); setErrorCode(null); }}
            labels={{ recorded: labels.recorded, undo: labels.undo, cancel: labels.cancel }} />
          {/* A failed Undo leaves the chip up (nothing to revert to otherwise)
              but must still say why — same "no silent failure" rule as the
              editor's own save error below. */}
          {errorCode && <span role="alert" className="text-[10px] font-semibold text-coral">{errorMessage(errorCode)}</span>}
        </span>
      )}

      {editing && (
        <>
          {/* Dimmed on every size (not just mobile): the desktop dialog below
              is a centered fixed modal, not a small popover attached to the
              row, so it needs the same "this is a blocking overlay" cue. */}
          <span aria-hidden="true" onClick={() => setEditing(false)} className="fixed inset-0 z-20 bg-ink/40" />
          {/*
            Positioning: `sm:absolute … sm:top-full` (anchored under the
            trigger, TaskEditor's pattern) breaks here specifically because
            this row lives inside page.tsx's `overflow-x-auto` table wrapper.
            Setting overflow-x forces the browser to compute overflow-y as
            `auto` too (CSS Overflow spec — an explicit `overflow-y-visible`
            class cannot opt back out of this), so that ancestor clips any
            `position: absolute` descendant that extends past its box — which
            a 12-field, up-to-75dvh-tall form does for any row near the top or
            bottom of a short table. `position: fixed` is immune to an
            ancestor's `overflow` (only a transform/filter/contain ancestor
            would trap it, and none of this table's ancestors have one), so
            desktop centers the dialog in the viewport with a pure inset+auto-
            margin trick instead of anchoring to the button's measured
            position — no ancestor overflow can clip it, and it needs no
            resize/scroll listeners to stay correct.
          */}
          <span
            role="dialog"
            aria-label={context ? `${labels.edit} · ${context}` : labels.edit}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85dvh] flex-col gap-2 overflow-y-auto rounded-t-2xl border-t border-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-start shadow-card sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[75dvh] sm:w-80 sm:rounded-lg sm:border sm:p-3"
          >
            <span aria-hidden="true" className="mx-auto mb-0.5 h-1 w-9 shrink-0 rounded-full bg-line sm:hidden" />
            <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink3">
              {labels.edit}{context ? ` · ${context}` : ''}
            </p>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.vendor}</span>
              <select autoFocus value={vendorDraft} onChange={(e) => setVendorDraft(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                <option value="">—</option>
                {options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.invoiceNo}</span>
              <input value={invoiceNoDraft} onChange={(e) => setInvoiceNoDraft(e.target.value)} className={inputCls()} />
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.project}</span>
              <select value={projectDraft} onChange={(e) => setProjectDraft(e.target.value)} className={`${inputCls()} cursor-pointer`}>
                <option value="">{labels.general}</option>
                {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.entity}</span>
              <input value={entityDraft} onChange={(e) => setEntityDraft(e.target.value)} list={entityListId} className={inputCls()} />
              <datalist id={entityListId}>
                {options.entities.map((e) => <option key={e} value={e} />)}
              </datalist>
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.receivedDate}</span>
              <input type="date" value={receivedDraft} onChange={(e) => setReceivedDraft(e.target.value)} className={inputCls()} />
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.description}</span>
              <input value={descriptionDraft} onChange={(e) => setDescriptionDraft(e.target.value)} className={inputCls()} />
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.amount}</span>
              <input
                type="text"
                inputMode="decimal"
                aria-invalid={amountInvalid || undefined}
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
                className={`${inputCls(amountInvalid)} font-mono`}
              />
              {amountInvalid && <span role="alert" className="mt-0.5 block text-[10px] font-semibold text-coral">{labels.invalidAmount}</span>}
            </label>

            <span aria-hidden="true" className="my-0.5 block h-px shrink-0 bg-line" />

            <label className={fieldCls}>
              <span className={labelCls}>{labels.status}</span>
              <select
                value={statusDraft}
                onChange={(e) => setStatusAndReset(e.target.value as InvoiceStatus)}
                className={`${inputCls()} cursor-pointer`}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.paidDate}</span>
              <input
                type="date"
                aria-invalid={paidNeedsDate || undefined}
                value={paidDraft}
                onChange={(e) => { setPaidDraft(e.target.value); setPaidDateAcked(true); }}
                className={inputCls(paidNeedsDate)}
              />
              {paidNeedsDate && <span role="alert" className="mt-0.5 block text-[10px] font-semibold text-coral">{labels.paidDateRequired}</span>}
            </label>

            {leavingPaid && (
              <span role="group" aria-label={labels.confirmPaidDate} className="rounded-lg border border-apricot/40 bg-apricot-soft p-2">
                <span className="block text-[10px] font-semibold text-ink2">{labels.confirmPaidDate}</span>
                <span className="mt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={paidDateAcked && paidDraft === (paidDate ?? '')}
                    onClick={() => { setPaidDraft(paidDate ?? ''); setPaidDateAcked(true); }}
                    className={`min-h-11 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold sm:min-h-7 ${
                      paidDateAcked && paidDraft === (paidDate ?? '') ? 'border-sage-line bg-sage-soft text-sage' : 'border-line text-ink3'
                    }`}
                  >
                    {labels.keepDate}
                  </button>
                  <button
                    type="button"
                    aria-pressed={paidDateAcked && paidDraft === ''}
                    onClick={() => { setPaidDraft(''); setPaidDateAcked(true); }}
                    className={`min-h-11 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold sm:min-h-7 ${
                      paidDateAcked && paidDraft === '' ? 'border-sage-line bg-sage-soft text-sage' : 'border-line text-ink3'
                    }`}
                  >
                    {labels.clearDate}
                  </button>
                </span>
              </span>
            )}

            <label className={fieldCls}>
              <span className={labelCls}>{labels.invoice}</span>
              <input
                type="url"
                aria-invalid={invoiceUrlInvalid || undefined}
                value={invoiceUrlDraft}
                onChange={(e) => setInvoiceUrlDraft(e.target.value)}
                className={inputCls(invoiceUrlInvalid)}
              />
              {invoiceUrlInvalid && <span role="alert" className="mt-0.5 block text-[10px] font-semibold text-coral">{labels.errorInvalidLink}</span>}
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.receipt}</span>
              <input
                type="url"
                aria-invalid={receiptUrlInvalid || undefined}
                value={receiptUrlDraft}
                onChange={(e) => setReceiptUrlDraft(e.target.value)}
                className={inputCls(receiptUrlInvalid)}
              />
              {receiptUrlInvalid && <span role="alert" className="mt-0.5 block text-[10px] font-semibold text-coral">{labels.errorInvalidLink}</span>}
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.transfer}</span>
              <input
                type="url"
                aria-invalid={transferUrlInvalid || undefined}
                value={transferUrlDraft}
                onChange={(e) => setTransferUrlDraft(e.target.value)}
                className={inputCls(transferUrlInvalid)}
              />
              {transferUrlInvalid && <span role="alert" className="mt-0.5 block text-[10px] font-semibold text-coral">{labels.errorInvalidLink}</span>}
            </label>

            <label className={fieldCls}>
              <span className={labelCls}>{labels.notes}</span>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink outline-none"
              />
            </label>

            <div className="mt-1 flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" disabled={pending || blocked} onClick={save}
                className="min-h-11 rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:min-h-7">
                {labels.save ?? labels.edit}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="min-h-11 rounded-full bg-inset px-3 py-1.5 text-xs text-ink3 sm:min-h-7">
                {labels.cancel}
              </button>
              {errorCode && <span role="alert" className="text-[10px] font-semibold text-coral">{errorMessage(errorCode)}</span>}
            </div>
          </span>
        </>
      )}
    </span>
  );
}
