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
      <h1 className="font-serif text-3xl text-ink">{t('settings.title')}</h1>

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
