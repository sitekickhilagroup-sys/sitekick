import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { getOverviewData } from '@/lib/queries';
import { supabaseServer } from '@/lib/supabase/server';
import { IntelligenceTabs } from '@/components/overview/intelligence-tabs';
import { ProjectAccordion } from '@/components/portfolio/project-accordion';
import type { TaskRank } from '@/lib/types';

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

  // Dor 8/29: the map orders by urgency — the project whose top task ranks
  // highest in the latest AI run comes first, the same rule My Work's
  // sections follow. No run yet = the existing order stands.
  const supabase = await supabaseServer();
  const { data: latestRun } = await supabase.from('priority_runs')
    .select('id').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (latestRun) {
    const { data: prioRows } = await supabase.from('task_priorities')
      .select('project_id,global_rank').eq('run_id', latestRun.id);
    const minRank = new Map<string, number>();
    for (const r of (prioRows ?? []) as Pick<TaskRank, 'project_id' | 'global_rank'>[]) {
      if (!r.project_id) continue;
      minRank.set(r.project_id, Math.min(minRank.get(r.project_id) ?? Infinity, r.global_rank));
    }
    if (minRank.size > 0) {
      activePortfolio.sort((a, b) =>
        (minRank.get(a.project.id) ?? Infinity) - (minRank.get(b.project.id) ?? Infinity));
    }
  }

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
    blockerWorkstream: t('portfolio.blocker_workstream'),
    blockerExternal: t('portfolio.blocker_external'),
    blockerTechnical: t('portfolio.blocker_technical'),
    waitingN: t('portfolio.waiting_n'),
    verifyN: t('portfolio.verify_n'),
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
    <div className="sk-page space-y-6 pb-16 lg:px-2 xl:px-6">
      {/* .portfolio-hero + .morning-cta. */}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('overview.kicker')}</p>
          <h1 className="mt-1 text-[clamp(30px,3vw,38px)] font-[650] leading-[1.08] tracking-[-0.035em] text-sk-ink">
            {t('overview.statement')}
          </h1>
          <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-muted">{t('overview.sub_line')}</p>
        </div>
        {/* .morning-cta: white card, sage rule, the live open-plan count. */}
        <Link
          href="/work"
          className="flex items-center gap-2.5 rounded-[15px] border border-sage-line bg-sk-surface px-4 py-3 hover:border-sage"
        >
          <span className="text-[26px] font-[650] leading-none text-sage">{data.tasks.length}</span>
          <span className="min-w-0">
            <span className="block text-[13px] font-bold text-ink">{t('portfolio.open_plan')}</span>
            <span className="block text-[10px] text-ink3">
              {t('overview.cta_sub')} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
            </span>
          </span>
        </Link>
      </div>

      {/* .portfolio-layout — spec §4: the map takes ~80% of the row, the
          Agent Review Inbox ~20%. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,1fr)]">
        <section aria-labelledby="portfolio-h" className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('portfolio.map_kicker')}</p>
              <h2 id="portfolio-h" className="mt-1 text-[22px] font-[650] leading-[1.2] tracking-[-0.025em] text-sk-ink">
                {t('portfolio.map')}
              </h2>
            </div>
            <p className="text-[11px] leading-[1.5] text-sk-muted">{t('portfolio.map_sub')}</p>
          </div>
          <div className="mt-4 space-y-2">
            {activePortfolio.map((entry, i) => (
              <ProjectAccordion key={entry.project.id} entry={entry} defaultOpen={i === 0} labels={portfolioLabels} />
            ))}
          </div>
          {inactivePortfolio.length > 0 && (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-1 text-[11px] text-sk-muted hover:text-sk-ink sm:min-h-0">
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

        {/* .review-inbox — spec §4: warm cream ground, thin warm border,
            compact height. Count and review action stay live. */}
        <aside className="lg:sticky lg:top-[4.75rem] lg:self-start">
          <section className="rounded-[15px] border border-sk-cream-border bg-sk-cream p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-amber">{t('portfolio.inbox_kicker')}</p>
              <b className="text-[26px] font-[650] leading-none text-sk-amber">{data.pendingProposals}</b>
            </div>
            <p className="mt-1 text-[11px] leading-[1.5] text-sk-text">{t('portfolio.inbox_sub')}</p>
            <Link
              href="/inbox"
              className="mt-3 inline-flex min-h-11 items-center rounded-[8px] bg-sage px-4 py-2 text-[10px] font-[650] leading-none text-white hover:opacity-90 sm:min-h-0"
            >
              {t('portfolio.inbox_cta')} <span aria-hidden="true" className="ms-1.5 inline-block rtl:-scale-x-100">→</span>
            </Link>
          </section>
        </aside>
      </div>

      {/* Spec §4 takes Ranked Attention out of the persistent right column but
          explicitly forbids deleting it, so it moves below the map into a
          collapsible panel — component, data and links all preserved. */}
      <details className="rounded-[15px] border border-line bg-sk-surface px-5 py-4 shadow-card">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-2 sm:min-h-0">
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('portfolio.ranked_kicker')}</span>
          <span className="text-[13px] font-[650] text-sk-ink">{t('portfolio.ranked_title')}</span>
        </summary>
        <ul className="mt-2 divide-y divide-line2">
          {ranked.map((a, i) => (
            <li key={`${a.kind}-${a.id}`}>
              <Link href="/work" className="grid grid-cols-[25px_minmax(0,1fr)] gap-2 py-3 hover:opacity-80">
                <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-sage-soft text-[11px] font-bold text-sage">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-[650] leading-[1.25] text-sk-ink">{a.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-[1.5] text-sk-muted">
                    {[a.project, a.why.blocked_by ?? a.waiting_for].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-[1.5] text-sage">
                    {a.why.unlocks
                      ? t('portfolio.unlocks_n').replace('{n}', `⁨${a.why.unlocks}⁩`)
                      : t('rel.type.needs_verification')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 rounded-[8px] border border-sk-cream-border bg-sk-cream px-3 py-2 text-[11px] leading-[1.5] text-sk-text">
          {t('portfolio.rank_rule')}
        </p>
      </details>

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
