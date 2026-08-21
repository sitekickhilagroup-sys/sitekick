'use client';

import { useState, useTransition } from 'react';
import { saveInvoiceLinks } from '@/app/actions/invoices';

interface Labels {
  edit: string;
  invoice: string;
  receipt: string;
  cancel: string;
  error: string;
}

interface Props {
  invoiceId: string;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  labels: Labels;
}

// Item 7: invoice/receipt links, edited in place — same shape as WaitingEditor
// (pencil button -> editing state -> save/cancel).
export function LinkEditor({ invoiceId, invoiceUrl, receiptUrl, labels }: Props) {
  const [editing, setEditing] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState(invoiceUrl ?? '');
  const [receiptDraft, setReceiptDraft] = useState(receiptUrl ?? '');
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        title={labels.edit}
        aria-label={labels.edit}
        onClick={() => {
          setInvoiceDraft(invoiceUrl ?? '');
          setReceiptDraft(receiptUrl ?? '');
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
    const res = await saveInvoiceLinks(invoiceId, invoiceDraft, receiptDraft);
    if (res?.error) { setFailed(true); return; }
    setEditing(false);
  });

  return (
    <span className="flex flex-wrap items-center gap-1">
      <input
        autoFocus
        type="url"
        aria-label={labels.invoice}
        aria-invalid={failed || undefined}
        placeholder={labels.invoice}
        value={invoiceDraft}
        onChange={(e) => setInvoiceDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className={`min-h-11 w-36 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink outline-none sm:min-h-0 ${failed ? 'border-coral' : 'border-mist'}`}
      />
      <input
        type="url"
        aria-label={labels.receipt}
        aria-invalid={failed || undefined}
        placeholder={labels.receipt}
        value={receiptDraft}
        onChange={(e) => setReceiptDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className={`min-h-11 w-36 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink outline-none sm:min-h-0 ${failed ? 'border-coral' : 'border-mist'}`}
      />
      <button type="button" disabled={pending} onClick={save} aria-label={labels.edit}
        className="min-h-11 rounded-full bg-sage px-2.5 py-0.5 text-[11px] text-white disabled:opacity-50 sm:min-h-7">
        <span aria-hidden="true">✓</span>
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label={labels.cancel}
        className="min-h-11 rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3 sm:min-h-7">
        <span aria-hidden="true">✕</span>
      </button>
      {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.error}</span>}
    </span>
  );
}
