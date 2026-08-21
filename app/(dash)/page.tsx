import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { getOverviewData } from '@/lib/queries';
import { WhatsStuck } from '@/components/overview/whats-stuck';
import { CompareCharts } from '@/components/overview/compare-charts';
import { ProjectAccordion } from '@/components/portfolio/project-accordion';

export const dynamic = 'force-dynamic';

// Understand-only overview (BUILD_SPEC §2) — acting lives on /work now.
// Alignment spec §ו: ONE process map (the accordions) — legacy ProjectRails
// and DecisionsWeek are gone from this page; What's stuck caps at 5;
// inactive projects (Flicker) collapse at the bottom.
export default async function OverviewPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const data = await getOverviewData();
  const projectNames = Object.fromEntries(data.projects.map((p) => [p.id, p.name]));

  // active !== false (not `=== true`) keeps the page correct even before
  // migration 0007 lands the column.
  const activePortfolio = data.portfolio.filter((e) => e.project.active !== false);
  const inactivePortfolio = data.portfolio.filter((e) => e.project.active === false);

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
    <div className="space-y-8 pb-16 sm:space-y-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('overview.kicker')}</p>
        <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('overview.statement')}</h1>
      </div>

      <Link
        href="/work"
        className="flex min-h-11 items-center gap-4 rounded-(--radius-card) border border-line bg-card p-4 shadow-card hover:opacity-90"
      >
        <span className="font-serif text-3xl text-sage sm:text-4xl">{data.tasks.length}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t('portfolio.open_plan')}</span>
          <span className="mt-0.5 block text-xs text-ink2">
            {t('portfolio.open_plan_sub').replace('{n}', String(data.tasks.length))}{' '}
            <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
          </span>
        </span>
      </Link>

      {data.pendingProposals > 0 && (
        <Link
          href="/inbox"
          className="flex min-h-11 items-center gap-4 rounded-(--radius-card) border border-apricot/40 bg-apricot-soft p-4 shadow-card hover:opacity-90"
        >
          <span className="font-serif text-3xl text-apricot">{data.pendingProposals}</span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-apricot">{t('inbox.title')}</span>
            <span className="mt-0.5 block text-sm text-ink">
              {t('portfolio.review_pending').replace('{n}', String(data.pendingProposals))}{' '}
              <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
            </span>
          </span>
        </Link>
      )}

      <section aria-labelledby="portfolio-h">
        <h2 id="portfolio-h" className="font-serif text-xl text-ink sm:text-2xl">{t('portfolio.map')}</h2>
        <p className="mt-0.5 text-sm text-ink3">{t('portfolio.map_sub')}</p>
        <div className="mt-4 space-y-3">
          {activePortfolio.map((entry, i) => (
            <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={i === 0} labels={portfolioLabels} />
          ))}
        </div>
        {inactivePortfolio.length > 0 && (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-1 text-sm text-ink3 hover:text-ink sm:min-h-0">
              {t('portfolio.inactive')} · {inactivePortfolio.length}
            </summary>
            <div className="mt-2 space-y-3 opacity-80">
              {inactivePortfolio.map((entry) => (
                <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={false} labels={portfolioLabels} />
              ))}
            </div>
          </details>
        )}
      </section>

      <WhatsStuck
        blockers={data.blockers.slice(0, 5)}
        projectNames={projectNames}
        title={t('overview.whats_stuck')}
        labels={{
          stuckDays: t('overview.stuck_days'),
          blockedBy: t('overview.blocked_by'),
          suggested: t('overview.suggested'),
          empty: t('overview.no_actions'),
        }}
      />

      {(data.insights.timeLost || data.insights.staleWait) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.insights.timeLost && (
            <article className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-coral">{t('insights.time_lost')}</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {data.insights.timeLost.project} · {data.insights.timeLost.text}
              </p>
              <p className="mt-1 text-xs text-ink3">
                {t('overview.stuck_days').replace('{n}', `⁨${data.insights.timeLost.days}⁩`)}
              </p>
            </article>
          )}
          {data.insights.staleWait && (
            <article className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">{t('insights.stale_wait')}</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {data.insights.staleWait.project ? `${data.insights.staleWait.project} · ` : ''}{data.insights.staleWait.title}
              </p>
              <p className="mt-1 text-xs text-ink3">
                {t('tasks.waiting')}: {data.insights.staleWait.who} · {t('insights.days').replace('{n}', `⁨${data.insights.staleWait.days}⁩`)}
              </p>
            </article>
          )}
        </div>
      )}

      {data.consultants.length > 0 && (
        <article className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">{t('insights.consultants')}</p>
          <p className="mt-0.5 text-xs text-ink3">{t('insights.consultants_sub')}</p>
          <ul className="mt-3 space-y-2">
            {data.consultants.map((c) => {
              const maxUsd = Math.max(1, ...data.consultants.map((x) => x.openUsd));
              return (
                <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_auto_1fr_90px]">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{c.name}</span>
                    {c.discipline && <span className="block truncate text-[11px] text-ink3">{c.discipline}</span>}
                  </span>
                  <span className={`justify-self-end whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] sm:justify-self-auto ${
                    c.waitingCount > 0 ? 'bg-mist-soft text-mist' : 'bg-card2 text-ink3'
                  }`}>
                    {t('insights.waiting_short').replace('{n}', `⁨${c.waitingCount}⁩`)}
                  </span>
                  <span className="col-span-2 h-3 overflow-hidden rounded bg-inset sm:col-span-1">
                    <i className="block h-full rounded bg-chart1" style={{ width: `${Math.round((c.openUsd / maxUsd) * 100)}%` }} />
                  </span>
                  <span className="col-span-2 text-end font-mono text-xs text-ink sm:col-span-1">
                    {c.openUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                  </span>
                </li>
              );
            })}
          </ul>
        </article>
      )}

      <CompareCharts
        openMoney={data.openMoney}
        tasks={data.tasks}
        projectNames={projectNames}
        title={t('overview.compare')}
        subtitle={t('overview.compare_sub')}
        moneyLabel={t('overview.open_money')}
        loadLabel={t('overview.task_load')}
        allLabel={t('common.general')}
      />
    </div>
  );
}
