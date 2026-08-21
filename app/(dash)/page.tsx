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
    next: t('portfolio.next'),
    blocker: t('portfolio.blocker'),
    investigate: t('portfolio.investigate'),
    none: t('common.none'),
    expand: t('common.expand'),
    collapse: t('common.collapse'),
  };

  return (
    <div className="space-y-8 pb-16 sm:space-y-10">
      <Link
        href="/work"
        className="block min-h-11 rounded-(--radius-card) border border-line bg-card p-4 shadow-card hover:opacity-90"
      >
        <p className="text-sm font-medium text-ink">{t('portfolio.open_plan')}</p>
        <p className="mt-1 text-xs text-ink2">
          {t('portfolio.open_plan_sub').replace('{n}', String(data.tasks.length))}
        </p>
      </Link>

      {data.pendingProposals > 0 && (
        <Link
          href="/inbox"
          className="block min-h-11 rounded-(--radius-card) border border-apricot/40 bg-apricot-soft p-4 text-apricot shadow-card hover:opacity-90"
        >
          <p className="text-sm font-medium">
            {t('portfolio.review_pending').replace('{n}', String(data.pendingProposals))}
          </p>
        </Link>
      )}

      <section aria-labelledby="portfolio-h">
        <h2 id="portfolio-h" className="font-serif text-xl text-ink sm:text-2xl">{t('portfolio.map')}</h2>
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

      <CompareCharts
        openMoney={data.openMoney}
        tasks={data.tasks}
        projectNames={projectNames}
        title={t('overview.compare')}
        moneyLabel={t('overview.open_money')}
        loadLabel={t('overview.task_load')}
        allLabel={t('common.all')}
      />
    </div>
  );
}
