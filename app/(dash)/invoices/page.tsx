import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { FilterBar } from '@/components/invoices/filter-bar';
import { StatusChain } from '@/components/invoices/status-chain';
import { LinkEditor } from '@/components/invoices/link-editor';
import type { Invoice, InvoiceStatus, InvoiceTab, Project, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Item 3a: tabs mirror the Excel — Invoices / Payment Summary / David.
export default async function InvoicesPage({ searchParams }: PageProps<'/invoices'>) {
  const sp = await searchParams;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  const supabase = await supabaseServer();
  const [invoicesQ, projectsQ, vendorsQ] = await Promise.all([
    supabase.from('invoices').select('*').order('created_at', { ascending: false }),
    supabase.from('projects').select('id,name'),
    supabase.from('vendors').select('id,name'),
  ]);
  const invoices = (invoicesQ.data ?? []) as Invoice[];
  const projects = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[];
  const vendors = (vendorsQ.data ?? []) as Pick<Vendor, 'id' | 'name'>[];
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const vName = new Map(vendors.map((v) => [v.id, v.name]));

  const tab = (typeof sp.tab === 'string' ? sp.tab : 'invoices') as InvoiceTab;
  const fProject = typeof sp.project === 'string' ? sp.project : '';
  const fEntity = typeof sp.entity === 'string' ? sp.entity : '';
  const fVendor = typeof sp.vendor === 'string' ? sp.vendor : '';
  const fStatus = typeof sp.status === 'string' ? sp.status : '';
  const fFrom = typeof sp.from === 'string' ? sp.from : '';
  const fTo = typeof sp.to === 'string' ? sp.to : '';

  const rows = invoices.filter((inv) => {
    if (inv.tab !== tab) return false;
    const projLabel = inv.project_id ? (pName.get(inv.project_id) ?? '') : t('common.all');
    if (fProject && projLabel !== fProject) return false;
    if (fEntity && inv.entity !== fEntity) return false;
    if (fVendor && (inv.vendor_id ? vName.get(inv.vendor_id) : '') !== fVendor) return false;
    if (fStatus && inv.status !== fStatus) return false;
    const d = inv.received_date ?? inv.invoice_date ?? inv.due;
    if (fFrom && (!d || d < fFrom)) return false;
    if (fTo && (!d || d > fTo)) return false;
    return true;
  });

  const rowan = invoices.filter((i) => i.status === 'for_rowan_approval');
  const rowanTotal = rowan.reduce((s, i) => s + Number(i.amount_usd), 0);

  // Open-money header (client demo): everything not yet paid or on hold.
  const openInvoices = invoices.filter((i) => ['received', 'for_rowan_approval', 'approved'].includes(i.status));
  const openTotal = openInvoices.reduce((s, i) => s + Number(i.amount_usd), 0);

  // Vendor quick-filter pills with counts, scoped to the active tab.
  const tabRows = invoices.filter((i) => i.tab === tab);
  const vendorCounts = new Map<string, number>();
  for (const inv of tabRows) {
    const nm = inv.vendor_id ? (vName.get(inv.vendor_id) ?? '') : '';
    if (nm) vendorCounts.set(nm, (vendorCounts.get(nm) ?? 0) + 1);
  }
  const vendorPills = [...vendorCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const statusLabels: Record<string, string> = {
    received: t('invoices.st_received'),
    for_rowan_approval: t('invoices.st_for_rowan'),
    approved: t('invoices.st_approved'),
    paid: t('invoices.st_paid'),
    on_hold: t('invoices.st_on_hold'),
  };

  const tabs: { key: InvoiceTab; label: string }[] = [
    { key: 'invoices', label: t('invoices.tab_invoices') },
    { key: 'payment_summary', label: t('invoices.tab_payment_summary') },
    { key: 'david', label: t('invoices.tab_david') },
  ];

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('invoices.kicker')}</p>
          <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('invoices.statement')}</h1>
        </div>
        <p className="text-sm text-ink2">
          <span className="font-mono font-medium text-ink">{money(openTotal)}</span>
          {' · '}{t('invoices.open_total').replace('{n}', `⁨${openInvoices.length}⁩`)}
        </p>
      </div>

      {rowan.length > 0 && (
        <p className="rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-sm text-ink">
          {/* FSI/PDI marks bidi-isolate the LTR number/amount inside the Hebrew sentence */}
          {t('invoices.waiting_rowan')
            .replace('{n}', `⁨${rowan.length}⁩`)
            .replace('{total}', `⁨${money(rowanTotal)}⁩`)}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {tabs.map(({ key, label }) => (
          <Link
            key={key}
            href={`/invoices?tab=${key}`}
            className={`inline-flex min-h-11 items-center rounded-full px-4 py-1.5 text-sm sm:min-h-0 ${
              tab === key ? 'bg-ink text-bg' : 'bg-card2 text-ink3 hover:text-ink'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {vendorPills.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          <Link
            href={`/invoices?tab=${tab}`}
            aria-current={!fVendor ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs sm:min-h-0 ${
              !fVendor ? 'bg-ink text-bg' : 'bg-card2 text-ink2 hover:text-ink'
            }`}
          >
            {t('common.all')} <span className={!fVendor ? 'opacity-70' : 'text-ink3'}>{tabRows.length}</span>
          </Link>
          {vendorPills.map(([nm, count]) => (
            <Link
              key={nm}
              href={`/invoices?tab=${tab}&vendor=${encodeURIComponent(nm)}`}
              aria-current={fVendor === nm ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs sm:min-h-0 ${
                fVendor === nm ? 'bg-ink text-bg' : 'bg-card2 text-ink2 hover:text-ink'
              }`}
            >
              {nm} <span className={fVendor === nm ? 'opacity-70' : 'text-ink3'}>{count}</span>
            </Link>
          ))}
        </div>
      )}

      <FilterBar
        options={{
          projects: [...projects.map((p) => p.name), t('common.all')].sort(),
          entities: [...new Set(invoices.map((i) => i.entity).filter((e): e is string => !!e))].sort(),
          vendors: vendors.map((v) => v.name).sort(),
          statuses: Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
        }}
        labels={{
          all: t('common.all'),
          project: t('common.project'),
          entity: t('invoices.entity'),
          vendor: t('common.vendor'),
          status: t('common.status'),
          from: t('invoices.from_date'),
          to: t('invoices.to_date'),
        }}
      />

      <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-card shadow-card">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink3">
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('common.vendor')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('common.project')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.entity')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.number')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('tasks.description')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('common.amount')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.received')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('common.status')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.paid_date')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.transfer')}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{t('invoices.edit_links')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line2">
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-ink3">{t('invoices.empty')}</td></tr>
            )}
            {rows.map((inv) => (
              <tr key={inv.id}>
                <td className="px-3 py-2 text-ink">{inv.vendor_id ? vName.get(inv.vendor_id) : ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{inv.project_id ? pName.get(inv.project_id) : t('common.all')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink2">{inv.entity ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink2">{inv.number ?? ''}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-xs text-ink2">{inv.budget_line ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end font-mono text-ink">{money(Number(inv.amount_usd))}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink2">{inv.received_date ?? inv.invoice_date ?? ''}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <StatusChain
                    invoiceId={inv.id}
                    status={inv.status as InvoiceStatus}
                    labels={statusLabels}
                    advanceLabel={t('invoices.advance')}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink2">{inv.paid_date ?? ''}</td>
                <td className="px-3 py-2 text-xs">
                  {inv.transfer_confirmation_url ? (
                    <a href={inv.transfer_confirmation_url} target="_blank" rel="noreferrer" className="text-chart1 underline">
                      {t('invoices.transfer')}
                    </a>
                  ) : ''}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    {inv.invoice_url && (
                      <a href={inv.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-mist underline">
                        {t('invoices.open_invoice')}
                      </a>
                    )}
                    {inv.receipt_url && (
                      <a href={inv.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-mist underline">
                        {t('invoices.open_receipt')}
                      </a>
                    )}
                    <LinkEditor
                      invoiceId={inv.id}
                      invoiceUrl={inv.invoice_url}
                      receiptUrl={inv.receipt_url}
                      context={[inv.vendor_id ? vName.get(inv.vendor_id) : null, inv.number].filter(Boolean).join(' ')}
                      labels={{
                        edit: t('invoices.edit_links'),
                        save: t('common.save'),
                        invoice: t('invoices.open_invoice'),
                        receipt: t('invoices.open_receipt'),
                        cancel: t('common.cancel'),
                        error: t('common.error_save'),
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
