import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { FinancialHeader } from '@/components/chrome/financial-header';
import { PaymentSummary } from '@/components/invoices/payment-summary';
import { FilterBar } from '@/components/invoices/filter-bar';
import { StatusChain } from '@/components/invoices/status-chain';
import { LinkEditor } from '@/components/invoices/link-editor';
import type { Invoice, InvoiceStatus, InvoiceTab, Project, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Headline figures round; row amounts must not. Spec §10 requires decimals
// preserved on the individual invoice, and a rounded $181 for an invoice of
// $181.30 is a wrong number on a financial screen.
const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const moneyExact = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

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
  // A failed query used to fall through to `?? []`, rendering an empty table
  // indistinguishable from "no invoices". Spec §14: do not hide financial-data
  // failures.
  const loadFailed = !!(invoicesQ.error || projectsQ.error || vendorsQ.error);
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const vName = new Map(vendors.map((v) => [v.id, v.name]));

  // Spec §יב vendor hygiene: trim + collapse whitespace and merge case
  // variants for display/grouping only — original names stay untouched in
  // the database for audit. Deeper merges need a human-approved rule.
  const canon = (s: string) => s.trim().replace(/\s+/g, ' ');
  const vKey = (s: string) => canon(s).toLowerCase();
  const canonicalByKey = new Map<string, string>();
  for (const v of vendors) {
    const k = vKey(v.name);
    if (!canonicalByKey.has(k)) canonicalByKey.set(k, canon(v.name));
  }
  const vDisplay = (id: string | null) => {
    const raw = id ? vName.get(id) : undefined;
    return raw ? (canonicalByKey.get(vKey(raw)) ?? canon(raw)) : '';
  };

  const tab = (typeof sp.tab === 'string' ? sp.tab : 'invoices') as InvoiceTab;
  const fProject = typeof sp.project === 'string' ? sp.project : '';
  const fEntity = typeof sp.entity === 'string' ? sp.entity : '';
  const fVendor = typeof sp.vendor === 'string' ? sp.vendor : '';
  const fStatus = typeof sp.status === 'string' ? sp.status : '';
  const fFrom = typeof sp.from === 'string' ? sp.from : '';
  const fTo = typeof sp.to === 'string' ? sp.to : '';

  const rows = invoices.filter((inv) => {
    if (inv.tab !== tab) return false;
    // Spec §יב: no invoice belongs to "All" — unassigned rows read "General".
    const projLabel = inv.project_id ? (pName.get(inv.project_id) ?? '') : t('common.general');
    if (fProject && projLabel !== fProject) return false;
    if (fEntity && inv.entity !== fEntity) return false;
    if (fVendor && vKey(vDisplay(inv.vendor_id)) !== vKey(fVendor)) return false;
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
    const nm = vDisplay(inv.vendor_id);
    if (nm) vendorCounts.set(nm, (vendorCounts.get(nm) ?? 0) + 1);
  }
  // Spec §8 warns against "dozens of tiny vendor chips over several crowded
  // rows", and the target screenshot shows roughly six. Busiest vendors lead;
  // the rest stay reachable through the vendor filter rather than being lost.
  const VENDOR_PILL_CAP = 6;
  const allVendorPills = [...vendorCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const vendorPills = allVendorPills.slice(0, VENDOR_PILL_CAP);
  const hiddenVendorCount = allVendorPills.length - vendorPills.length;

  const statusLabels: Record<string, string> = {
    received: t('invoices.st_received'),
    for_rowan_approval: t('invoices.st_for_rowan'),
    approved: t('invoices.st_approved'),
    paid: t('invoices.st_paid'),
    on_hold: t('invoices.st_on_hold'),
  };

  // Spec §6: two primary views. `david` is a real workbook tab and the spec
  // forbids deleting secondary views, so it is demoted, not removed.
  const primaryTabs: { key: InvoiceTab; label: string }[] = [
    { key: 'invoices', label: t('invoices.tab_invoices') },
    { key: 'payment_summary', label: t('invoices.tab_payment_summary') },
  ];

  return (
    <>
      <FinancialHeader sourceLabel={t('invoices.open_total').replace('{n}', `⁨${invoices.length}⁩`)} />
      <div className="sk-page mx-auto max-w-[980px] space-y-4 px-4 pt-6 pb-16 sm:px-6">
        {loadFailed && (
          <p role="alert" className="rounded-[9px] border border-coral/40 bg-sk-salmon px-4 py-2.5 text-[11px] text-sk-salmon-text">
            {t('invoices.error_load')}
          </p>
        )}

        {/* Intro + the dark-green financial summary card (spec §4-§5). */}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('invoices.kicker')}</p>
            <h1 className="mt-1 text-[clamp(26px,2.6vw,30px)] font-[650] leading-[1.1] tracking-[-0.035em] text-sk-ink">
              {t('invoices.statement')}
            </h1>
            {/* Demoted from a full-width amber banner, which §7 rejects. */}
            {rowan.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-amber">
                {/* FSI/PDI marks bidi-isolate the LTR number/amount inside the Hebrew sentence */}
                {t('invoices.waiting_rowan')
                  .replace('{n}', `⁨${rowan.length}⁩`)
                  .replace('{total}', `⁨${money(rowanTotal)}⁩`)}
              </p>
            )}
          </div>
          <section className="rounded-[9px] bg-sk-green-dark px-5 py-4">
            <p className="font-mono text-[26px] font-[650] leading-none tabular-nums text-white">{money(openTotal)}</p>
            <p className="mt-1 text-[10px] text-white/70">
              {t('invoices.open_total').replace('{n}', `⁨${openInvoices.length}⁩`)}
            </p>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {primaryTabs.map(({ key, label }) => (
            <Link
              key={key}
              href={`/invoices?tab=${key}`}
              aria-current={tab === key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-[8px] px-4 py-1.5 text-[11px] font-[650] sm:min-h-0 ${
                tab === key ? 'bg-sk-green-dark text-white' : 'bg-sk-surface-soft text-sk-muted hover:text-sk-ink'
              }`}
            >
              {label}
            </Link>
          ))}
          <details className="relative ms-auto">
            <summary className="min-h-11 cursor-pointer list-none px-2 py-1.5 text-[10px] text-sk-muted hover:text-sk-ink sm:min-h-0">
              {t('invoices.more_views')}
            </summary>
            <Link
              href="/invoices?tab=david"
              aria-current={tab === 'david' ? 'page' : undefined}
              className={`absolute end-0 z-10 mt-1 block whitespace-nowrap rounded-[8px] border border-line bg-sk-surface px-3 py-2 text-[10px] shadow-card ${
                tab === 'david' ? 'font-[650] text-sk-green' : 'text-sk-muted hover:text-sk-ink'
              }`}
            >
              {t('invoices.tab_david')}
            </Link>
          </details>
        </div>

        {/* Additive: the aggregation renders above the tab-filtered rows so no
            workbook record disappears from the view. */}
        {tab === 'payment_summary' && (
          <PaymentSummary
            invoices={invoices}
            projectName={(id) => (id ? (pName.get(id) ?? '') : '')}
            vendorName={vDisplay}
            statusLabels={statusLabels}
            money={money}
            labels={{
              due: t('invoices.amount_due'),
              byEntity: t('invoices.by_entity'),
              byProject: t('invoices.by_project'),
              byStatus: t('invoices.by_status'),
              byVendor: t('common.vendor'),
              general: t('common.general'),
              count: t('invoices.open_total'),
            }}
          />
        )}

      {vendorPills.length > 1 && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          <Link
            href={`/invoices?tab=${tab}`}
            aria-current={!fVendor ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs sm:min-h-0 ${
              !fVendor ? 'bg-sk-green-soft font-[650] text-sk-green' : 'bg-sk-surface-soft text-sk-muted hover:text-sk-ink'
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
                fVendor === nm ? 'bg-sk-green-soft font-[650] text-sk-green' : 'bg-sk-surface-soft text-sk-muted hover:text-sk-ink'
              }`}
            >
              {nm} <span className={fVendor === nm ? 'opacity-70' : 'text-sk-muted'}>{count}</span>
            </Link>
          ))}
          {hiddenVendorCount > 0 && (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap px-2 text-[10px] text-sk-muted-light">
              +{hiddenVendorCount}
            </span>
          )}
        </div>
      )}

      <FilterBar
        options={{
          projects: [...projects.map((p) => p.name), t('common.general')].sort(),
          entities: [...new Set(invoices.map((i) => i.entity).filter((e): e is string => !!e))].sort(),
          vendors: [...new Set(vendors.map((v) => canonicalByKey.get(vKey(v.name)) ?? canon(v.name)))].sort(),
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
          advanced: t('invoices.filters_advanced'),
          active: t('invoices.filters_active'),
          reset: t('invoices.filters_reset'),
        }}
      />

      {/* Her invoices table: VENDOR / INVOICE (with links + Update inside) |
          PROJECT / ENTITY | DESCRIPTION | DATE | STATUS | AMOUNT. */}
      {/* Table semantics are kept (spec §20) — the spec's column proportions
          ride on a colgroup rather than a conversion to grid divs. */}
      <div className="overflow-x-auto rounded-[15px] border border-line bg-sk-surface shadow-card">
        <table className="w-full min-w-[900px] table-fixed text-[11px]">
          <colgroup>
            <col className="w-[27%]" />
            <col className="w-[22%]" />
            <col className="w-[19%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line bg-sk-surface-header text-[9px] font-bold uppercase tracking-[0.08em] text-sk-muted">
              <th scope="col" className="px-3 py-2 text-start font-bold">{t('invoices.col_vendor')}</th>
              <th scope="col" className="px-3 py-2 text-start font-bold">{t('invoices.col_project')}</th>
              <th scope="col" className="px-3 py-2 text-start font-bold">{t('tasks.description')}</th>
              <th scope="col" className="px-3 py-2 text-start font-bold">{t('invoices.date')}</th>
              <th scope="col" className="px-3 py-2 text-start font-bold">{t('common.status')}</th>
              <th scope="col" className="px-3 py-2 text-end font-bold">{t('common.amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line2">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-ink3">{t('invoices.empty')}</td></tr>
            )}
            {rows.map((inv) => (
              <tr key={inv.id}>
                <td className="px-3 py-2.5 align-top">
                  <span className="block font-[650] text-sk-ink">{vDisplay(inv.vendor_id)}</span>
                  {inv.number && <span className="block font-mono text-[10px] text-sk-muted">{t('invoices.number')} {inv.number}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    {inv.invoice_url ? (
                      <a href={inv.invoice_url} target="_blank" rel="noreferrer" className="text-[10px] font-[650] text-sk-green hover:underline">
                        {t('invoices.open_invoice')} <span aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      // Spec §8: say the link is missing rather than showing
                      // nothing, which reads as though one exists elsewhere.
                      <span className="text-[10px] text-sk-muted-light">{t('invoices.missing_link')}</span>
                    )}
                    {inv.receipt_url && (
                      <a href={inv.receipt_url} target="_blank" rel="noreferrer" className="text-[10px] text-sk-muted hover:underline">
                        {t('invoices.open_receipt')} <span aria-hidden="true">↗</span>
                      </a>
                    )}
                    {inv.transfer_confirmation_url && (
                      <a href={inv.transfer_confirmation_url} target="_blank" rel="noreferrer" className="text-[10px] text-sk-muted hover:underline">
                        {t('invoices.transfer')} <span aria-hidden="true">↗</span>
                      </a>
                    )}
                    <LinkEditor
                      invoiceId={inv.id}
                      status={inv.status as InvoiceStatus}
                      paidDate={inv.paid_date}
                      invoiceUrl={inv.invoice_url}
                      receiptUrl={inv.receipt_url}
                      notes={inv.notes ?? null}
                      statusLabels={statusLabels}
                      context={[vDisplay(inv.vendor_id) || null, inv.number].filter(Boolean).join(' ')}
                      labels={{
                        edit: t('invoices.edit_links'),
                        save: t('common.save'),
                        invoice: t('invoices.open_invoice'),
                        receipt: t('invoices.open_receipt'),
                        cancel: t('common.cancel'),
                        error: t('common.error_save'),
                        status: t('common.status'),
                        paidDate: t('invoices.paid_date'),
                        notes: t('invoices.notes'),
                      }}
                    />
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                  <span className="block text-ink2">{inv.project_id ? pName.get(inv.project_id) : t('common.general')}</span>
                  {inv.entity && <span className="block text-[11px] text-ink3">{inv.entity}</span>}
                </td>
                <td className="max-w-[220px] px-3 py-2.5 text-xs text-ink2">
                  <span className="block truncate">{inv.budget_line ?? ''}</span>
                  {inv.notes && <span className="block truncate text-[11px] text-ink3" title={inv.notes}>{inv.notes}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink2">
                  <span className="block">{inv.received_date ?? inv.invoice_date ?? ''}</span>
                  {inv.paid_date && <span className="block text-[11px] text-ink3">{t('invoices.paid_date')} · {inv.paid_date}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <StatusChain
                    invoiceId={inv.id}
                    status={inv.status as InvoiceStatus}
                    labels={statusLabels}
                    advanceLabel={t('invoices.advance')}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-end align-top font-mono text-[11px] tabular-nums text-sk-ink">
                  {moneyExact(Number(inv.amount_usd))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
