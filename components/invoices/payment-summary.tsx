import type { Invoice } from '@/lib/types';

/**
 * Payment Summary as an actual summary (spec §13).
 *
 * `?tab=payment_summary` used to re-render the same flat table filtered on the
 * stored `tab` column — and because the importer hard-codes `tab: 'invoices'`,
 * that column matches nothing, which is why the tab showed "No invoices match
 * this filter" while the header counted open invoices. This aggregates the same
 * rows rather than filtering them away, and is additive: the tab-filtered table
 * still renders below, so no workbook row disappears.
 *
 * Paid invoices are excluded from the amount due, as the spec requires.
 */

interface Props {
  invoices: Invoice[];
  projectName: (id: string | null) => string;
  vendorName: (id: string | null) => string;
  statusLabels: Record<string, string>;
  money: (n: number) => string;
  labels: {
    due: string; byEntity: string; byProject: string; byStatus: string;
    byVendor: string; general: string; count: string;
  };
}

type Agg = [string, { count: number; total: number }];

function group(rows: Invoice[], key: (i: Invoice) => string): Agg[] {
  const out = new Map<string, { count: number; total: number }>();
  for (const inv of rows) {
    const k = key(inv);
    const cur = out.get(k) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(inv.amount_usd);
    out.set(k, cur);
  }
  return [...out.entries()].sort((a, b) => b[1].total - a[1].total);
}

function Block({ title, rows, money, columns }: {
  title: string; rows: Agg[]; money: (n: number) => string; columns?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{title}</p>
      <ul className={`mt-2 ${columns ? 'grid gap-x-6 sm:grid-cols-2' : ''}`}>
        {rows.map(([name, agg]) => (
          <li key={name} className="flex items-baseline justify-between gap-3 border-b border-line2 py-2 last:border-b-0">
            <span className="min-w-0 truncate text-[11px] text-sk-ink">{name}</span>
            <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-sk-text">
              <span className="me-2 text-sk-muted">{agg.count}</span>
              {money(agg.total)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PaymentSummary({ invoices, projectName, vendorName, statusLabels, money, labels }: Props) {
  const due = invoices.filter((i) => i.status !== 'paid');
  const dueTotal = due.reduce((s, i) => s + Number(i.amount_usd), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-[15px] border border-line bg-sk-green-dark p-5">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/70">{labels.due}</p>
        <p className="mt-1 font-mono text-[26px] font-[650] leading-none tabular-nums text-white">{money(dueTotal)}</p>
        <p className="mt-1 text-[10px] text-white/70">{labels.count.replace('{n}', `⁨${due.length}⁩`)}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Block title={labels.byEntity} money={money} rows={group(due, (i) => i.entity || labels.general)} />
        <Block title={labels.byProject} money={money} rows={group(due, (i) => projectName(i.project_id) || labels.general)} />
        <Block title={labels.byStatus} money={money} rows={group(due, (i) => statusLabels[i.status] ?? i.status)} />
      </div>

      <Block
        title={labels.byVendor}
        money={money}
        columns
        rows={group(due, (i) => vendorName(i.vendor_id) || labels.general)}
      />
    </div>
  );
}
