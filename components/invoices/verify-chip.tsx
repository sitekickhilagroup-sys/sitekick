'use client';

import { useState, useTransition } from 'react';
import { resolveInvoiceVerification, undoFlagInvoiceForVerification } from '@/app/actions/invoices';
import { SavedChip } from '@/components/work/saved-chip';

interface Props {
  invoiceId: string;
  labels: { verify: string; confirm: string; recorded: string; undo: string; cancel: string };
}

/**
 * The Verify chip, now an adjudication control rather than a static badge.
 * First click arms it (the label turns into an explicit "confirm this
 * invoice" question — one accidental tap must not clear a flag), second
 * click clears the flag through the audited action; the SavedChip that
 * replaces it carries Undo. Escape/blur disarms.
 */
export function VerifyChip({ invoiceId, labels }: Props) {
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<{ undoId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const resolve = () => start(async () => {
    setFailed(false);
    const res = await resolveInvoiceVerification(invoiceId);
    if ('error' in res) { setFailed(true); setArmed(false); return; }
    setResult({ undoId: res.undoId });
  });

  const undo = (undoId: string) => start(async () => {
    const res = await undoFlagInvoiceForVerification(undoId);
    if (!('error' in res)) setResult(null);
  });

  if (result) {
    return (
      <SavedChip
        message={labels.recorded}
        undoId={result.undoId}
        pending={pending}
        onUndo={() => { if (result.undoId) undo(result.undoId); }}
        onDismiss={() => setResult(null)}
        labels={{ recorded: labels.recorded, undo: labels.undo, cancel: labels.cancel }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={armed}
      onClick={() => (armed ? resolve() : setArmed(true))}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') setArmed(false); }}
      className={`min-h-11 cursor-pointer whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 sm:min-h-0 ${
        failed
          ? 'bg-coral-soft text-coral'
          : armed
            ? 'bg-sk-green-soft text-sk-green ring-1 ring-sage-line'
            : 'bg-apricot-soft text-apricot hover:ring-1 hover:ring-apricot/40'
      }`}
    >
      {armed ? labels.confirm : labels.verify}
    </button>
  );
}
