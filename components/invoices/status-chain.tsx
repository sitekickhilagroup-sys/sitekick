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

// Item 3d: 4-state chain, "For Rowan approval" visually loud — that's where
// things get stuck.
export function StatusChain({ invoiceId, status, labels, advanceLabel }: Props) {
  const [pending, start] = useTransition();
  const idx = CHAIN.indexOf(status);

  if (status === 'on_hold') {
    return <span className="rounded-full bg-inset px-2 py-0.5 text-[11px] text-ink3">{labels.on_hold}</span>;
  }

  return (
    <span className="flex items-center gap-1">
      {CHAIN.map((s, i) => {
        const active = i === idx;
        const past = i < idx;
        const rowan = s === 'for_rowan_approval';
        return (
          <span
            key={s}
            title={labels[s]}
            className={`h-2 w-2 rounded-full ${
              active
                ? rowan ? 'h-2.5 w-2.5 bg-apricot ring-2 ring-apricot/30' : 'bg-sage'
                : past ? 'bg-sage-line' : 'bg-line'
            }`}
          />
        );
      })}
      <span className={`ms-1 text-[11px] ${
        status === 'for_rowan_approval' ? 'rounded-full bg-apricot-soft px-2 py-0.5 font-medium text-apricot' : 'text-ink2'
      }`}>
        {labels[status]}
      </span>
      {idx < CHAIN.length - 1 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await advanceInvoice(invoiceId); })}
          className="ms-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink3 hover:text-ink disabled:opacity-50"
          title={advanceLabel}
        >
          →
        </button>
      )}
    </span>
  );
}
