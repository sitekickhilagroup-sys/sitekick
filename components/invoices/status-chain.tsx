'use client';

import { useTransition } from 'react';
import { advanceInvoice } from '@/app/actions/invoices';
import type { InvoiceStatus } from '@/lib/types';

const CHAIN: InvoiceStatus[] = ['received', 'for_rowan_approval', 'approved', 'paid'];

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  labels: Record<string, string>; // status value -> label
  advanceLabel: string;
}

// Spec §12 badge palette, mapped onto the five values the invoice_status enum
// actually has. The spec's list also names Processing and Rejected; neither
// exists in the enum and the same spec forbids schema changes, so they are
// reported as unmatched rather than invented.
//
// Every badge carries its text label — the spec forbids communicating status
// through colour alone.
const BADGE: Record<InvoiceStatus, string> = {
  received: 'bg-sk-amber-halo text-sk-amber',
  for_rowan_approval: 'bg-sk-cream text-sk-amber',
  approved: 'bg-sk-green-soft-strong text-sk-green',
  paid: 'bg-sk-green-soft-strong font-[650] text-sk-green',
  on_hold: 'bg-sk-salmon text-sk-salmon-text',
  // Rotem QA round 2 (0019): voided record — muted and struck, clearly dead.
  cancelled: 'bg-card2 text-ink3 line-through',
};

export function StatusChain({ invoiceId, status, labels, advanceLabel }: Props) {
  const [pending, start] = useTransition();
  const idx = CHAIN.indexOf(status);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`whitespace-nowrap rounded-[6px] px-2 py-1 text-[9px] font-[650] uppercase leading-none tracking-[0.06em] ${BADGE[status]}`}>
        {labels[status]}
      </span>
      {/* On hold / cancelled are separate tracks with no advance control:
          terminal in this UI (idx === -1 for both), and returning from them
          goes through the editor. */}
      {idx >= 0 && idx < CHAIN.length - 1 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await advanceInvoice(invoiceId); })}
          aria-label={`${advanceLabel}: ${labels[status]}`}
          className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[6px] border border-sage-line px-1.5 py-0.5 text-[10px] text-sk-green hover:bg-sk-green-soft disabled:opacity-50 sm:min-h-6 sm:min-w-6"
          title={advanceLabel}
        >
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
        </button>
      )}
    </span>
  );
}
