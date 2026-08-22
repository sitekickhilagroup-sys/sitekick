import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { getOverviewData } from '@/lib/queries';
import { IntelligenceTabs } from '@/components/overview/intelligence-tabs';
import { ProjectAccordion } from '@/components/portfolio/project-accordion';

export const dynamic = 'force-dynamic';

// Her PortfolioV2 exactly: hero + morning CTA, then a 1.6/0.7 layout —
// project-map accordions on the main side, RANKED ATTENTION + AGENT REVIEW
// INBOX on the side — then the PORTFOLIO INTELLIGENCE tab panel.
export default async function OverviewPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const data = await getOverviewData();

  // active !== false (not `=== true`) keeps the page correct even before
  // migration 0007 lands the column.
  const activePortfolio = data.portfolio.filter((e) => e.project.active !== false);
  const inactivePortfolio = data.portfolio.filter((e) => e.project.active === false);

  // Her RANKED ATTENTION panel: the top ranked actions with what they unlock.
  const ranked = data.actions.slice(0, 4);

  const portfolioLabels = {
    onHold: t('rails.on_hold'),
    onTrack: t('rails.on_track'),
    atRisk: t('portfolio.state.at_risk'),
    waiting: t('portfolio.state.waiting'),
    position: t('portfolio.position'),
    blockingN: t('portfolio.blocking_n'),
    evidence: t('portfolio.evidence'),
    next: t('portfolio.next'),
    then: t('portfolio.then'),
    blocker: t('portfolio.blocker'),
    investigate: t('portfolio.investigate'),
    none: t('common.none'),
    expand: t('common.expand'),
    collapse: t('common.collapse'),
    primaryPhase: t('portfolio.primary_phase'),
    parallelWs: t('portfolio.parallel_ws'),
    phases: (['planning', 'plan_check', 'bidding', 'financing', 'construction'] as const)
      .map((key) => ({ key: key as string, label: t(`phase.${key}`) })),
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Her .portfolio-hero + .morning-cta. */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('overview.kicker')}</p>
          <h1 className="mt-1 font-serif text-2xl text-ink sm:text-4xl">{t('overview.statement')}</h1>
          <p className="mt-1 text-sm text-ink3">{t('overview.sub_line')}</p>
        </div>
        {/* Her .morning-cta: white card, sage rule, the count in Georgia green. */}
        <Link
          href="/work"
          className="flex items-center gap-2.5 rounded-[14px] border border-sage-line bg-card px-4 py-3 hover:border-sage"
        >
          <span className="font-serif text-3xl text-sage">{data.tasks.length}</span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold text-ink">{t('portfolio.open_plan')}</span>
            <span className="block text-[10px] text-ink3">
              {t('overview.cta_sub')} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
            </span>
          </span>
        </Link>
      </div>

      {/* Her .portfolio-layout: main map + side panels. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.7fr)]">
        <section aria-labelledby="portfolio-h" className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('portfolio.map_kicker')}</p>
              <h2 id="portfolio-h" className="mt-1 font-serif text-xl text-ink sm:text-2xl">{t('portfolio.map')}</h2>
            </div>
            <p className="text-[11px] text-ink3">{t('portfolio.map_sub')}</p>
          </div>
          <div className="mt-4 space-y-2">
            {activePortfolio.map((entry, i) => (
              <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={i === 0} labels={portfolioLabels} />
            ))}
          </div>
          {inactivePortfolio.length > 0 && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-1 text-sm text-ink3 hover:text-ink sm:min-h-0">
                {t('portfolio.inactive')} · {inactivePortfolio.length}
              </summary>
              <div className="mt-2 space-y-2 opacity-80">
                {inactivePortfolio.map((entry) => (
                  <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={false} labels={portfolioLabels} />
                ))}
              </div>
            </details>
          )}
        </section>

        <aside className="space-y-4">
          {/* Her .ranked-attention panel. */}
          <section className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('portfolio.ranked_kicker')}</p>
            <h2 className="mt-1 font-serif text-lg text-ink">{t('portfolio.ranked_title')}</h2>
            <ul className="mt-2 divide-y divide-line2">
              {ranked.map((a, i) => (
                <li key={`${a.kind}-${a.id}`}>
                  <Link href="/work" className="grid grid-cols-[25px_minmax(0,1fr)] gap-2 py-3 hover:opacity-80">
                    <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-sage-soft text-[11px] font-bold text-sage">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-snug text-ink">{a.title}</span>
                      <span className="mt-0.5 block text-[11px] text-ink3">
                        {[a.project, a.why.blocked_by ?? a.waiting_for].filter(Boolean).join(' · ')}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-sage">
                        {a.why.unlocks
                          ? t('portfolio.unlocks_n').replace('{n}', `⁨${a.why.unlocks}⁩`)
                          : t('rel.type.needs_verification')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 rounded-[10px] border border-apricot/30 bg-apricot-soft px-3 py-2 text-[11px] leading-relaxed text-ink2">
              {t('portfolio.rank_rule')}
            </p>
          </section>

          {/* Her .review-inbox card. */}
          <section className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('portfolio.inbox_kicker')}</p>
              <b className="font-serif text-2xl text-apricot">{data.pendingProposals}</b>
            </div>
            <p className="mt-1 text-xs text-ink2">{t('portfolio.inbox_sub')}</p>
            <Link
              href="/inbox"
              className="mt-3 inline-flex min-h-11 items-center rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:min-h-0"
            >
              {t('portfolio.inbox_cta')} <span aria-hidden="true" className="ms-1.5 inline-block rtl:-scale-x-100">→</span>
            </Link>
          </section>
        </aside>
      </div>

      <IntelligenceTabs
        timeLost={data.insights.timeLost}
        staleWait={data.insights.staleWait}
        consultants={data.consultants}
        budget={data.budget}
        forecast={data.portfolio
          .filter((e) => e.project.active !== false)
          .map((e) => ({ project: e.project.name, next: e.nextAction?.title ?? null }))}
        labels={{
          kicker: t('insights.kicker'),
          title: t('overview.compare'),
          tabTime: t('insights.tab_time'),
          tabBudget: t('insights.tab_budget'),
          tabConsultants: t('insights.consultants'),
          tabForecast: t('insights.tab_forecast'),
          timeLost: t('insights.time_lost'),
          staleWait: t('insights.stale_wait'),
          stuckDays: t('overview.stuck_days'),
          waitingOn: t('tasks.waiting'),
          days: t('insights.days'),
          waitingShort: t('insights.waiting_short'),
          budgetWarnT: t('insights.budget_warn_t'),
          budgetWarn: t('insights.budget_warn'),
          costToDate: t('insights.cost_to_date'),
          recordedTotal: t('insights.recorded_total'),
          coverage: t('insights.coverage'),
          forecastConf: t('insights.forecast_conf'),
          none: t('common.none'),
          empty: t('overview.no_actions'),
        }}
      />
    </div>
  );
}
