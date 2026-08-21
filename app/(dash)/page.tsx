import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { getOverviewData } from '@/lib/queries';
import { WhatsStuck } from '@/components/overview/whats-stuck';
import { ProjectRails } from '@/components/overview/project-rails';
import { DecisionsWeek } from '@/components/overview/decisions-week';
import { CompareCharts } from '@/components/overview/compare-charts';
import { ProjectAccordion } from '@/components/portfolio/project-accordion';

export const dynamic = 'force-dynamic';

// Understand-only overview (BUILD_SPEC §2) — acting lives on /work now.
// Order: plan banner -> inbox banner (when pending) -> portfolio map ->
// WhatsStuck -> legacy ProjectRails (kept until Noa signs off the
// accordions; removed at the Sprint D checkpoint) -> DecisionsWeek -> CompareCharts.
export default async function OverviewPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const data = await getOverviewData();
  const projectNames = Object.fromEntries(data.projects.map((p) => [p.id, p.name]));

  const railLabels = {
    whatWeOwe: t('rails.what_we_owe'),
    timeline: t('rails.timeline'),
    onUs: t('rails.on_us'),
    cityIssues: t('rails.city_issues'),
    statusUnknown: t('rails.status_unknown'),
    doneGroup: t('rails.done_group'),
    toFinish: t('rails.to_finish'),
    completedStage: t('rails.completed_stage'),
    ahead: t('rails.ahead'),
    alsoActive: t('rails.also_active'),
    noRecord: t('rails.no_record'),
    needsChecking: t('rails.needs_checking'),
    noEvidence: t('rails.no_evidence'),
    onHold: t('rails.on_hold'),
    onTrack: t('rails.on_track'),
    slip: t('rails.slip'),
    progress: t('rails.progress'),
    confirmed: t('rails.stage_confirmed'),
    estimated: t('rails.estimated'),
    standardUnconfirmed: t('rails.standard_unconfirmed'),
    expand: t('common.expand'),
    collapse: t('common.collapse'),
  };

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
          {data.portfolio.map((entry, i) => (
            <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={i === 0} labels={portfolioLabels} />
          ))}
        </div>
      </section>

      <WhatsStuck
        blockers={data.blockers}
        projectNames={projectNames}
        title={t('overview.whats_stuck')}
        labels={{
          stuckDays: t('overview.stuck_days'),
          blockedBy: t('overview.blocked_by'),
          suggested: t('overview.suggested'),
          empty: t('overview.no_actions'),
        }}
      />

      <ProjectRails
        projects={data.projects}
        substages={data.substages}
        title={t('overview.where_projects')}
        labels={railLabels}
      />

      <DecisionsWeek
        decisions={data.decisions}
        projectNames={projectNames}
        title={t('overview.decisions_week')}
        empty={t('decisions.empty')}
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
              <p className="text-[10px] font-semibold uppercase tracking-wide text-apricot">{t('insights.stale_wait')}</p>
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
                    c.waitingCount > 0 ? 'bg-apricot-soft text-apricot' : 'bg-card2 text-ink3'
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
        allLabel={t('common.all')}
      />
    </div>
  );
}
