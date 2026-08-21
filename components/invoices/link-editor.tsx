'use client';

import { useState, useTransition } from 'react';
import { updateInvoiceDetails } from '@/app/actions/invoices';
import type { InvoiceStatus } from '@/lib/types';

interface Labels {
  edit: string;
  save?: string;
  invoice: string;
  receipt: string;
  cancel: string;
  error: string;
  status: string;
  paidDate: string;
  notes: string;
}

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  paidDate: string | null;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  notes: string | null;
  /** status value -> localized label */
  statusLabels: Record<string, string>;
  /** Row-identifying text (vendor / number) so screen readers can tell rows apart. */
  context?: string;
  labels: Labels;
}

// Spec §יב "Update Invoice": pencil opens one editor with Status, Payment
// Date, Invoice Link, Receipt Link, Notes and a single Save.
export function LinkEditor({ invoiceId, status, paidDate, invoiceUrl, receiptUrl, notes, statusLabels, context, labels }: Props) {
  const [editing, setEditing] = useState(false);
  const [statusDraft, setStatusDraft] = useState<InvoiceStatus>(status);
  const [paidDraft, setPaidDraft] = useState(paidDate ?? '');
  const [invoiceDraft, setInvoiceDraft] = useState(invoiceUrl ?? '');
  const [receiptDraft, setReceiptDraft] = useState(receiptUrl ?? '');
  const [notesDraft, setNotesDraft] = useState(notes ?? '');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        title={labels.edit}
        aria-label={context ? `${labels.edit} · ${context}` : labels.edit}
        onClick={() => {
          setStatusDraft(status);
          setPaidDraft(paidDate ?? '');
          setInvoiceDraft(invoiceUrl ?? '');
          setReceiptDraft(receiptUrl ?? '');
          setNotesDraft(notes ?? '');
          setFailed(false);
          setEditing(true);
        }}
        className="inline-flex min-h-11 items-center rounded-full px-2 py-0.5 text-xs text-ink3 hover:text-ink2 sm:min-h-7"
      >
        <span aria-hidden="true">✎</span>
      </button>
    );
  }

  const save = () => start(async () => {
    const res = await updateInvoiceDetails(invoiceId, {
      status: statusDraft,
      paidDate: paidDraft || null,
      invoiceUrl: invoiceDraft,
      receiptUrl: receiptDraft,
      notes: notesDraft,
    });
    if (res?.error) { setFailed(true); return; }
    setEditing(false);
  });

  const inputCls = `min-h-11 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink outline-none sm:min-h-0 ${failed ? 'border-coral' : 'border-mist'}`;

  return (
    <span className="flex w-56 flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[10px] text-ink3">
        {labels.status}
        <select
          autoFocus
          value={statusDraft}
          onChange={(e) => setStatusDraft(e.target.value as InvoiceStatus)}
          aria-label={labels.status}
          className={`${inputCls} flex-1 cursor-pointer`}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[10px] text-ink3">
        {labels.paidDate}
        <input
          type="date"
          aria-label={labels.paidDate}
          value={paidDraft}
          onChange={(e) => setPaidDraft(e.target.value)}
          className={`${inputCls} flex-1`}
        />
      </label>
      <input
        type="url"
        aria-label={labels.invoice}
        aria-invalid={failed || undefined}
        placeholder={labels.invoice}
        value={invoiceDraft}
        onChange={(e) => setInvoiceDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className={inputCls}
      />
      <input
        type="url"
        aria-label={labels.receipt}
        aria-invalid={failed || undefined}
        placeholder={labels.receipt}
        value={receiptDraft}
        onChange={(e) => setReceiptDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className={inputCls}
      />
      <textarea
        aria-label={labels.notes}
        placeholder={labels.notes}
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        rows={2}
        className="rounded-lg border border-mist bg-card px-2 py-1 text-xs text-ink outline-none"
      />
      <span className="flex items-center gap-1">
        <button type="button" disabled={pending} onClick={save}
          className="min-h-11 rounded-full bg-sage px-3 py-0.5 text-[11px] text-white disabled:opacity-50 sm:min-h-7">
          {labels.save ?? labels.edit}
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label={labels.cancel}
          className="min-h-11 rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3 sm:min-h-7">
          <span aria-hidden="true">✕</span>
        </button>
        {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.error}</span>}
      </span>
    </span>
  );
}
