import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { getOverviewData } from '@/lib/queries';
import { TopActions } from '@/components/overview/top-actions';
import { WhatsStuck } from '@/components/overview/whats-stuck';
import { ProjectRails } from '@/components/overview/project-rails';
import { TasksSection } from '@/components/overview/tasks-section';
import { DecisionsWeek } from '@/components/overview/decisions-week';
import { CompareCharts } from '@/components/overview/compare-charts';

export const dynamic = 'force-dynamic';

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

  return (
    <div className="space-y-10 pb-16">
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <TopActions
          actions={data.actions}
          title={t('overview.top_actions')}
          subtitle={t('overview.top_actions_sub')}
          empty={t('overview.no_actions')}
        />
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
      </div>

      <ProjectRails
        projects={data.projects}
        substages={data.substages}
        title={t('overview.where_projects')}
        labels={railLabels}
      />

      <TasksSection
        tasks={data.tasks}
        projects={data.projects.map((p) => ({ id: p.id, name: p.name }))}
        labels={{
          title: t('overview.tasks'),
          colTitle: t('tasks.title'),
          colDesc: t('tasks.description'),
          colOwner: t('tasks.owner'),
          colWaiting: t('tasks.waiting'),
          colDue: t('tasks.due'),
          colStage: t('tasks.stage'),
          expand: t('overview.tasks_expand'),
          collapse: t('overview.tasks_collapse'),
          addTask: t('overview.add_task'),
          formTitle: t('tasks.form_title'),
          formName: t('tasks.form_name'),
          formDesc: t('tasks.form_desc'),
          formOwner: t('tasks.form_owner'),
          formDue: t('tasks.form_due'),
          save: t('common.save'),
          cancel: t('common.cancel'),
          unplanned: t('tasks.unplanned'),
          markDone: t('tasks.mark_done'),
          project: t('common.project'),
        }}
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
      />
    </div>
  );
}
