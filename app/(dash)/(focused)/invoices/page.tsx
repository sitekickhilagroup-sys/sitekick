import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { FinancialHeader } from '@/components/chrome/financial-header';
import { PaymentSummary } from '@/components/invoices/payment-summary';
import { FilterBar } from '@/components/invoices/filter-bar';
import { StatusChain } from '@/components/invoices/status-chain';
import { LinkEditor, type LinkEditorOptions } from '@/components/invoices/link-editor';
import { AddInvoice } from '@/components/invoices/add-invoice';
import { ReconcileReport } from '@/components/invoices/reconcile-report';
import { canonVendorName, vendorKey } from '@/lib/invoice-rules';
import { money, moneyExact } from '@/lib/format';
import type { Invoice, InvoiceStatus, InvoiceTab, Project, Vendor } from '@/lib/types';

// E6: the reconciliation report is a demoted view like `david`, but unlike
// `david` it is not a real value of the `invoices.tab` column — there is no
// stored population to filter rows against (the report re-reads an uploaded
// Excel and diffs it in memory; see lib/reconcile.ts). PageTab widens the
// query-param type just enough to hold that one extra value; InvoiceTab
// itself (and every filter below keyed off it) stays exactly as narrow as
// the database column it mirrors.
type PageTab = InvoiceTab | 'reconciliation';

export const dynamic = 'force-dynamic';

// money/moneyExact come from lib/format.ts — client components (AddInvoice,
// ReconcileReport) import them directly instead of receiving them as props,
// which Next 16 refuses to serialize (the /invoices 500, QA item 03).

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

  // Spec §יב vendor hygiene: merge punctuation/case/corporate-suffix variants
  // for display/grouping only — original names stay untouched in the
  // database for audit. canonVendorName/vendorKey (lib/invoice-rules.ts) are
  // the same functions Add Invoice's duplicate check uses, so this table and
  // that check can never disagree about what "the same vendor" means.
  const canonicalByKey = new Map<string, string>();
  for (const v of vendors) {
    const k = vendorKey(v.name);
    if (!canonicalByKey.has(k)) canonicalByKey.set(k, canonVendorName(v.name));
  }
  const vDisplay = (id: string | null) => {
    const raw = id ? vName.get(id) : undefined;
    return raw ? (canonicalByKey.get(vendorKey(raw)) ?? canonVendorName(raw)) : '';
  };

  const tab = (typeof sp.tab === 'string' ? sp.tab : 'invoices') as PageTab;
  const fProject = typeof sp.project === 'string' ? sp.project : '';
  const fEntity = typeof sp.entity === 'string' ? sp.entity : '';
  const fVendor = typeof sp.vendor === 'string' ? sp.vendor : '';
  const fStatus = typeof sp.status === 'string' ? sp.status : '';
  const fFrom = typeof sp.from === 'string' ? sp.from : '';
  const fTo = typeof sp.to === 'string' ? sp.to : '';

  // Payment Summary is a different grouping of the SAME invoices the
  // Invoices tab shows, not a separate stored population: every imported row
  // is hard-coded to tab:'invoices' (lib/import/tracker.ts), so gating rows
  // or the vendor-pill counts on inv.tab === 'payment_summary' always
  // matched zero. `david` is untouched — a real, separately-tracked workbook
  // tab the spec forbids deleting — so rows genuinely tagged tab='david'
  // still land only there. Reconciliation falls back to 'invoices' the same
  // way payment_summary does — it never reads rowsTab/rows/tabRows at all
  // (the section below is skipped entirely for this tab), so the fallback
  // only has to be a value InvoiceTab accepts, not a meaningful one.
  const rowsTab: InvoiceTab = tab === 'payment_summary' ? 'invoices' : tab === 'reconciliation' ? 'invoices' : tab;

  const rows = invoices.filter((inv) => {
    if (inv.tab !== rowsTab) return false;
    // Spec §יב: no invoice belongs to "All" — unassigned rows read "General".
    const projLabel = inv.project_id ? (pName.get(inv.project_id) ?? '') : t('common.general');
    if (fProject && projLabel !== fProject) return false;
    if (fEntity && inv.entity !== fEntity) return false;
    if (fVendor && vendorKey(vDisplay(inv.vendor_id)) !== vendorKey(fVendor)) return false;
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

  // Vendor quick-filter pills with counts, scoped to the active tab (via
  // rowsTab — see above). Also PaymentSummary's own aggregation source below:
  // the same "every invoice this view covers" set, before fProject/fEntity/
  // fVendor/fStatus/fFrom/fTo narrow it down to `rows`.
  const tabRows = invoices.filter((i) => i.tab === rowsTab);
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

  // E2: the full invoice editor's Vendor/Project/Entity choices — built once
  // from the same vendors/projects/invoices this page already loaded above,
  // never a second round trip. Entities are reused as-is by FilterBar below.
  const entityOptions = [...new Set(invoices.map((i) => i.entity).filter((e): e is string => !!e))].sort();
  const editorOptions: LinkEditorOptions = {
    vendors: vendors
      .map((v) => ({ id: v.id, name: canonicalByKey.get(vendorKey(v.name)) ?? canonVendorName(v.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects: [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    entities: entityOptions,
  };
  const editorLabels = {
    edit: t('invoices.edit_links'),
    save: t('common.save'),
    invoice: t('invoices.open_invoice'),
    receipt: t('invoices.open_receipt'),
    transfer: t('invoices.transfer'),
    cancel: t('common.cancel'),
    status: t('common.status'),
    paidDate: t('invoices.paid_date'),
    notes: t('invoices.notes'),
    vendor: t('common.vendor'),
    invoiceNo: t('invoices.invoice_no'),
    project: t('common.project'),
    general: t('common.general'),
    entity: t('invoices.entity'),
    receivedDate: t('invoices.received'),
    description: t('tasks.description'),
    amount: t('common.amount'),
    recorded: t('work.recorded'),
    undo: t('work.undo'),
    confirmPaidDate: t('invoices.confirm_paid_date'),
    keepDate: t('invoices.keep_date'),
    clearDate: t('invoices.clear_date'),
    paidDateRequired: t('invoices.paid_date_required'),
    invalidAmount: t('invoices.invalid_amount'),
    errorInvalidStatus: t('invoices.error_invalid_status'),
    errorInvalidLink: t('invoices.error_invalid_link'),
    errorInvalidDate: t('invoices.error_invalid_date'),
    errorNotFound: t('invoices.error_not_found'),
    errorEmptyPatch: t('invoices.error_empty_patch'),
    errorNothingToUndo: t('invoices.error_nothing_to_undo'),
    errorSaveReason: t('invoices.error_save_reason'),
    // E5 — per-invoice change history, collapsed in the editor footer.
    history: t('invoices.history'),
    historyEmpty: t('invoices.history_empty'),
    historyLoading: t('common.loading'),
    historyChanged: t('invoices.history_changed'),
    historyActionCreate: t('invoices.history_action_create'),
    historyActionEdit: t('invoices.history_action_edit'),
    historyActionUndo: t('invoices.history_action_undo'),
    historyActionAdvance: t('invoices.history_action_advance'),
    errorHistoryLoad: t('invoices.error_history_load'),
    verify: t('invoices.verify'),
  };

  // E4 — Add Invoice header button + duplicate-confirm dialog. Reuses the
  // same vendor/project/entity options and money formatter already built
  // above for LinkEditor/the table, not a second copy.
  const addInvoiceLabels: Record<string, string> = {
    addInvoice: t('invoices.add_invoice'),
    vendor: t('common.vendor'),
    invoiceNo: t('invoices.invoice_no'),
    project: t('common.project'),
    general: t('common.general'),
    entity: t('invoices.entity'),
    receivedDate: t('invoices.received'),
    description: t('tasks.description'),
    amount: t('common.amount'),
    save: t('common.save'),
    cancel: t('common.cancel'),
    invalidAmount: t('invoices.invalid_amount'),
    noNumberHint: t('invoices.no_number_hint'),
    dupKicker: t('invoices.dup_kicker'),
    dupTitle: t('invoices.dup_title'),
    dupSub: t('invoices.dup_sub'),
    dupSame: t('invoices.dup_same'),
    dupNew: t('invoices.dup_new'),
    back: t('common.cancel'),
    recorded: t('invoices.recorded'),
    created: t('invoices.created'),
    createdVerify: t('invoices.created_verify'),
    undo: t('work.undo'),
    errorVendorRequired: t('invoices.error_vendor_required'),
    errorInvalidDate: t('invoices.error_invalid_date'),
    errorSaveReason: t('invoices.error_save_reason'),
    errorDuplicateNumber: t('invoices.error_duplicate_number'),
    errorMigrationPending: t('invoices.error_migration_pending'),
  };

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
          {/* Smaller-items fix: was <span> — AddInvoice renders a
              <div role="dialog"> once open, and the sibling <details> below
              is never valid nested inside a <span> either; both are
              flow-content elements a <span>'s phrasing-only content model
              can't legally hold. This row already sits inside a <div> (the
              tabs row above), so <div> here changes nothing about the
              layout — flex is set explicitly either way. */}
          <div className="ms-auto flex items-center gap-1.5">
            {/* E4: header button, same row as the tabs rather than a third
                grid column in the intro block above — that grid is a fixed
                two-column [title | summary card] pair the spec anchors, and
                this end-of-tabs-row slot is the low-risk place to add a new
                primary action without touching it. */}
            <AddInvoice options={editorOptions} labels={addInvoiceLabels} />
            <details className="relative">
              <summary className="min-h-11 cursor-pointer list-none px-2 py-1.5 text-[10px] text-sk-muted hover:text-sk-ink sm:min-h-0">
                {t('invoices.more_views')}
              </summary>
              {/* Two demoted views share this menu — `david` (a real,
                  separately-tracked workbook tab) and E6's reconciliation
                  report (not a workbook tab at all, see PageTab above) get
                  the same treatment: reachable, but out of the primary
                  tab row the spec anchors. */}
              <span className="absolute end-0 z-10 mt-1 flex flex-col gap-0.5 whitespace-nowrap rounded-[8px] border border-line bg-sk-surface p-1 shadow-card">
                <Link
                  href="/invoices?tab=david"
                  aria-current={tab === 'david' ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-[6px] px-3 py-1.5 text-[10px] sm:min-h-0 ${
                    tab === 'david' ? 'font-[650] text-sk-green' : 'text-sk-muted hover:text-sk-ink'
                  }`}
                >
                  {t('invoices.tab_david')}
                </Link>
                <Link
                  href="/invoices?tab=reconciliation"
                  aria-current={tab === 'reconciliation' ? 'page' : undefined}
                  className={`flex min-h-11 items-center rounded-[6px] px-3 py-1.5 text-[10px] sm:min-h-0 ${
                    tab === 'reconciliation' ? 'font-[650] text-sk-green' : 'text-sk-muted hover:text-sk-ink'
                  }`}
                >
                  {t('invoices.tab_reconciliation')}
                </Link>
              </span>
            </details>
          </div>
        </div>

        {/* Additive: the aggregation renders above the tab-filtered rows so no
            workbook record disappears from the view. Aggregates tabRows —
            every tab:'invoices' row, i.e. the same population the Invoices
            tab itself shows before project/entity/vendor/status/date narrow
            it further — not the full unfiltered `invoices` (which could also
            pull in a separately-tracked tab='david' row). */}
        {tab === 'payment_summary' && (
          <PaymentSummary
            invoices={tabRows}
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

      {/* E6: the reconciliation report replaces the filter bar + invoices
          table for this tab rather than sitting alongside them (unlike
          Payment Summary's additive aggregation above) — there is no
          `invoices.tab==='reconciliation'` population for the vendor pills,
          FilterBar or table below to filter, so rendering them here would
          just show the (irrelevant) 'invoices' tab rows underneath a report
          about something else entirely. */}
      {tab === 'reconciliation' && (
        <ReconcileReport
          labels={{
            kicker: t('invoices.recon_kicker'),
            intro: t('invoices.recon_intro'),
            chooseFile: t('invoices.recon_choose_file'),
            uploadHint: t('invoices.recon_upload_hint'),
            reading: t('invoices.recon_reading'),
            done: t('invoices.recon_done'),
            tileSource: t('invoices.recon_tile_source'),
            tileSystem: t('invoices.recon_tile_system'),
            tileAdded: t('invoices.recon_tile_added'),
            tileChanged: t('invoices.recon_tile_changed'),
            tileSuspected: t('invoices.recon_tile_suspected'),
            tileOrphans: t('invoices.recon_tile_orphans'),
            none: t('invoices.recon_none'),
            groupCount: t('invoices.recon_group_count'),
            number: t('invoices.number'),
            changedPrefix: t('invoices.history_changed'),
            fieldAmount: t('common.amount'),
            fieldReceived: t('invoices.received'),
            fieldPaidDate: t('invoices.paid_date'),
            fieldStatus: t('common.status'),
            fieldEntity: t('invoices.entity'),
            fieldDescription: t('tasks.description'),
            flagVerify: t('invoices.recon_flag_verify'),
            flagged: t('invoices.recon_flagged'),
            flaggedCount: t('invoices.recon_flagged_count'),
            alreadyFlaggedCount: t('invoices.recon_already_flagged_count'),
            flagFailedCount: t('invoices.recon_flag_failed_count'),
            numberDriftWarning: t('invoices.recon_number_drift_warning'),
            recorded: t('invoices.recorded'),
            undo: t('work.undo'),
            cancel: t('common.cancel'),
            errorFileMissing: t('invoices.error_reconcile_file_missing'),
            errorBadFileType: t('invoices.error_reconcile_bad_file_type'),
            errorParseFailed: t('invoices.error_reconcile_parse_failed'),
            errorNotInvoiceSheet: t('invoices.error_reconcile_not_invoice_sheet'),
            errorNoMatch: t('invoices.error_reconcile_no_match'),
            errorNotFound: t('invoices.error_not_found'),
            errorNothingToUndo: t('invoices.error_nothing_to_undo'),
            errorMigrationPending: t('invoices.error_migration_pending'),
            errorSaveReason: t('invoices.error_save_reason'),
            errorTooLarge: t('invoices.error_reconcile_too_large'),
            sourceSheet: t('invoices.recon_source_sheet'),
          }}
        />
      )}

      {tab !== 'reconciliation' && vendorPills.length > 1 && (
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

      {tab !== 'reconciliation' && (
      <>
      <FilterBar
        options={{
          projects: [...projects.map((p) => p.name), t('common.general')].sort(),
          entities: entityOptions,
          vendors: [...new Set(vendors.map((v) => canonicalByKey.get(vendorKey(v.name)) ?? canonVendorName(v.name)))].sort(),
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
              // id backs AddInvoice's "Same invoice — open it": the URL hash
              // points here, and .sk-page tr:target (globals.css) does the
              // highlight — no ref/state plumbing across components needed.
              <tr key={inv.id} id={`invoice-${inv.id}`}>
                <td className="px-3 py-2.5 align-top">
                  <span className="block font-[650] text-sk-ink">{vDisplay(inv.vendor_id)}</span>
                  {inv.number && <span className="block font-mono text-[10px] text-sk-muted">{t('invoices.number')} {inv.number}</span>}
                  {/* Smaller-items fix: was <span> — LinkEditor's own root
                      (now also a <div>, see link-editor.tsx) can render a
                      <details> element once its dialog is open, which is
                      never valid nested inside a <span>. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
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
                      vendorId={inv.vendor_id}
                      invoiceNo={inv.number}
                      projectId={inv.project_id}
                      entity={inv.entity}
                      receivedDate={inv.received_date}
                      description={inv.budget_line}
                      amountUsd={Number(inv.amount_usd)}
                      status={inv.status as InvoiceStatus}
                      paidDate={inv.paid_date}
                      invoiceUrl={inv.invoice_url}
                      receiptUrl={inv.receipt_url}
                      transferUrl={inv.transfer_confirmation_url}
                      notes={inv.notes ?? null}
                      statusLabels={statusLabels}
                      options={editorOptions}
                      context={[vDisplay(inv.vendor_id) || null, inv.number].filter(Boolean).join(' ')}
                      labels={editorLabels}
                    />
                  </div>
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
                  {/* Q10: her tracker's Service Month column, imported since 0018. */}
                  {inv.service_month && <span className="block text-[11px] text-ink3">{t('invoices.service_month')} · {inv.service_month}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusChain
                      invoiceId={inv.id}
                      status={inv.status as InvoiceStatus}
                      labels={statusLabels}
                      advanceLabel={t('invoices.advance')}
                    />
                    {/* E4 Step 3: a suspected/unconfirmed duplicate (or an
                        invoice added with no number) — flagged, never
                        auto-resolved; Noa adjudicates. Reads as undefined
                        (falsy) until migration 0017 actually runs, so this
                        degrades to "no chip" rather than crashing. */}
                    {inv.needs_verification && (
                      <span className="whitespace-nowrap rounded-full bg-apricot-soft px-2 py-0.5 text-[11px] font-semibold text-apricot">
                        {t('invoices.verify')}
                      </span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-end align-top font-mono text-[11px] tabular-nums text-sk-ink">
                  {moneyExact(Number(inv.amount_usd))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </>
      )}
      </div>
    </>
  );
}
