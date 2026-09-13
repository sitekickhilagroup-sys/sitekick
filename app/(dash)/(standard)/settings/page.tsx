import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { ImportForm } from './import-form';
import { OverrideForm, type OverrideProject } from './override-form';
import { SheetsForm } from './sheets-form';
import { ZimasButton } from './zimas-button';
import { UsersCard } from './users-card';
import { listUsers } from '@/app/actions/users';
import { getLlmUsageSummary } from '@/app/actions/llm-usage';
import type { Project, ProjectStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-(--radius-card) border border-line bg-card p-5 shadow-card">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const me = await requireUser();
  // Non-admins (ADMIN_EMAILS set, not listed) just don't see the users card.
  const users = await listUsers().catch(() => null);
  // Same admin gate — non-admins just don't see the AI cost card either.
  const llmUsage = await getLlmUsageSummary().catch(() => null);
  const [projectsQ, stagesQ, sheetQ] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    supabase.from('project_stages').select('*').order('position'),
    supabase.from('settings').select('value').eq('key', 'sheet_ids').maybeSingle(),
  ]);
  const projects = (projectsQ.data ?? []) as Project[];
  const stages = (stagesQ.data ?? []) as ProjectStage[];
  const sheets = (sheetQ.data?.value ?? {}) as { gantt?: { id: string; range: string }; budget?: { id: string; range: string } };

  const overrideProjects: OverrideProject[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    stages: stages
      .filter((s) => s.project_id === p.id)
      .map((s) => ({ stage_key: s.stage_key, label: s.label, status: s.status, substage: s.substage })),
  }));

  const configured = (v: boolean) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${v ? 'bg-sage-soft text-sage' : 'bg-inset text-ink3'}`}>
      {v ? t('settings.configured') : t('settings.not_configured')}
    </span>
  );

  return (
    <div className="space-y-5 pb-16">
      <h1 className="font-serif text-2xl text-ink sm:text-3xl">{t('settings.title')}</h1>

      <Card title={t('settings.import_requirements')}>
        <ImportForm
          projects={projects.map((p) => p.name)}
          labels={{
            project: t('settings.import_project'),
            run: t('settings.import_run'),
            ok: t('settings.import_ok'),
            help: t('settings.import_help'),
          }}
        />
      </Card>

      <Card title={t('settings.stage_overrides')}>
        <p className="mb-3 text-xs text-ink3">{t('settings.stage_overrides_help')}</p>
        <div className="space-y-3">
          {overrideProjects.map((p) => (
            <OverrideForm
              key={p.id}
              project={p}
              labels={{
                currentStage: t('settings.current_stage'),
                substage: t('settings.substage'),
                save: t('common.save'),
              }}
            />
          ))}
        </div>
      </Card>

      <Card title={t('settings.sheets')}>
        <p className="mb-3 text-xs text-ink3">{t('settings.sheets_help')}</p>
        <SheetsForm value={sheets} saveLabel={t('common.save')} />
      </Card>

      <Card title={t('settings.integrations')}>
        <ul className="space-y-2 text-sm text-ink2">
          <li className="flex items-center justify-between">Anthropic API {configured(!!process.env.ANTHROPIC_API_KEY)}</li>
          <li className="flex items-center justify-between">Forward intake {configured(!!process.env.INGEST_SECRET)}</li>
          <li className="flex items-center justify-between">Gmail poll {configured(!!process.env.GMAIL_REFRESH_TOKEN)}</li>
          <li className="flex items-center justify-between">Outlook poll {configured(!!process.env.MSGRAPH_CLIENT_SECRET)}</li>
          <li className="flex items-center justify-between">Google Sheets {configured(!!process.env.GOOGLE_SA_KEY)}</li>
        </ul>
      </Card>

      {llmUsage && <Card title={t('settings.ai_cost')}>
        <p className="mb-3 text-xs text-ink3">{t('settings.ai_cost_help')}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-(--radius-card) bg-inset p-3">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_today')}</div>
            <div className="text-lg font-semibold text-ink">${llmUsage.cost_today_usd.toFixed(4)}</div>
          </div>
          <div className="rounded-(--radius-card) bg-inset p-3">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_week')}</div>
            <div className="text-lg font-semibold text-ink">${llmUsage.cost_week_usd.toFixed(4)}</div>
          </div>
          <div className="rounded-(--radius-card) bg-inset p-3">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_month')}</div>
            <div className="text-lg font-semibold text-ink">${llmUsage.cost_month_usd.toFixed(4)}</div>
          </div>
          <div className="rounded-(--radius-card) bg-inset p-3">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_calls_month')}</div>
            <div className="text-lg font-semibold text-ink">
              {llmUsage.calls_month} <span className="text-xs font-normal text-ink3">({llmUsage.successes_month}✓ / {llmUsage.failures_month}✗)</span>
            </div>
          </div>
          <div className="col-span-2 rounded-(--radius-card) bg-inset p-3 sm:col-span-2">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_tokens_month')}</div>
            <div className="text-sm text-ink">{llmUsage.input_tokens_month.toLocaleString()} in / {llmUsage.output_tokens_month.toLocaleString()} out</div>
          </div>
          <div className="col-span-2 rounded-(--radius-card) bg-inset p-3 sm:col-span-2">
            <div className="text-[11px] text-ink3">{t('settings.ai_cost_last_run')}</div>
            <div className="text-sm text-ink">{llmUsage.last_run_at ? new Date(llmUsage.last_run_at).toLocaleString() : t('settings.ai_cost_never')}</div>
          </div>
        </div>

        {llmUsage.by_job_model.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <div className="mb-1 text-xs font-medium text-ink2">{t('settings.ai_cost_by_job_model')}</div>
            <table className="w-full min-w-[420px] text-xs">
              <thead>
                <tr className="text-start text-ink3">
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_job')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_model')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_calls')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_tokens')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_cost')}</th>
                </tr>
              </thead>
              <tbody>
                {llmUsage.by_job_model.map((r) => (
                  <tr key={`${r.job}::${r.model}`} className="border-t border-line">
                    <td className="pe-2 py-1 text-ink2">{r.job}</td>
                    <td className="pe-2 py-1 text-ink2">{r.model}</td>
                    <td className="pe-2 py-1 text-ink2">{r.calls}</td>
                    <td className="pe-2 py-1 text-ink2">{r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}</td>
                    <td className="pe-2 py-1 text-ink2">${r.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {llmUsage.recent.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <div className="mb-1 text-xs font-medium text-ink2">{t('settings.ai_cost_recent')}</div>
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="text-start text-ink3">
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_when')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_job')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_action')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_model')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_tokens')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_cost')}</th>
                  <th className="pe-2 py-1 text-start font-normal">{t('settings.ai_cost_col_result')}</th>
                </tr>
              </thead>
              <tbody>
                {llmUsage.recent.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="pe-2 py-1 whitespace-nowrap text-ink2">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="pe-2 py-1 text-ink2">{r.job}</td>
                    <td className="pe-2 py-1 text-ink2">{r.action_type}</td>
                    <td className="pe-2 py-1 text-ink2">{r.model}</td>
                    <td className="pe-2 py-1 text-ink2">{r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}</td>
                    <td className="pe-2 py-1 text-ink2">${(r.estimated_cost_usd ?? 0).toFixed(4)}</td>
                    <td className="pe-2 py-1">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.success ? 'bg-sage-soft text-sage' : 'bg-coral-soft text-coral'}`}>
                        {r.success ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink3">{t('settings.ai_cost_sql_alt')}</summary>
          <pre className="mt-2 overflow-x-auto rounded-(--radius-card) bg-inset p-3 text-[11px] text-ink2">
{`-- Cost by day, last 30 days
select date_trunc('day', created_at) as day,
       sum(estimated_cost_usd) as cost_usd,
       sum(input_tokens) as input_tokens,
       sum(output_tokens) as output_tokens,
       count(*) as calls
from llm_usage_log
where created_at >= now() - interval '30 days'
group by 1 order by 1 desc;

-- Breakdown by job/model, last 30 days
select job, model, count(*) as calls,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(estimated_cost_usd) as cost_usd,
       count(*) filter (where success) as successes,
       count(*) filter (where not success) as failures
from llm_usage_log
where created_at >= now() - interval '30 days'
group by 1, 2 order by cost_usd desc;

-- Last 20 actions
select created_at, job, action_type, model, attempt, success,
       input_tokens, output_tokens, estimated_cost_usd
from llm_usage_log
order by created_at desc limit 20;`}
          </pre>
        </details>
      </Card>}

      {users && <Card title={t('settings.users')}>
        <p className="mb-3 text-xs text-ink3">{t('settings.users_help')}</p>
        <UsersCard
          users={users}
          meId={me.id}
          labels={{
            email: t('users.email'),
            add: t('users.add'),
            remove: t('users.remove'),
            confirmRemove: t('users.confirm_remove'),
            lastSeen: t('users.last_seen'),
            never: t('users.never'),
            tempPass: t('users.temp_pass'),
            copy: t('users.copy'),
          }}
        />
      </Card>}

      <Card title={t('settings.zimas')}>
        <ZimasButton label={t('settings.zimas_run')} />
      </Card>
    </div>
  );
}
