import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { ProposalCard } from '@/components/inbox/proposal-card';
import type { AgentProposal, Project, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [proposalsQ, projectsQ] = await Promise.all([
    supabase.from('agent_proposals').select('*').eq('state', 'pending').order('created_at', { ascending: false }),
    supabase.from('projects').select('id,name'),
  ]);
  const proposals = (proposalsQ.data ?? []) as AgentProposal[];
  const names = new Map(((projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[]).map((p) => [p.id, p.name]));
  const taskIds = proposals.map((p) => p.target_task_id).filter((x): x is string => !!x);
  const { data: tasksData } = taskIds.length
    ? await supabase.from('tasks').select('id,title').in('id', taskIds)
    : { data: [] };
  const taskTitles = new Map(((tasksData ?? []) as Pick<Task, 'id' | 'title'>[]).map((row) => [row.id, row.title]));

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink sm:text-3xl">{t('inbox.title')}</h1>
      <p className="mt-1 text-sm text-ink3">{t('inbox.sub')}</p>
      {proposals.length === 0 ? (
        <p className="mt-6 rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{t('inbox.empty')}</p>
      ) : (
        <ul className="mt-5 space-y-2">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              projectName={p.project_id ? names.get(p.project_id) ?? null : null}
              taskTitle={p.target_task_id ? taskTitles.get(p.target_task_id) ?? null : null}
              summaryOverride={
                p.type === 'phase_set' && typeof p.payload.phase_key === 'string'
                  ? t('phase.' + p.payload.phase_key)
                  : null
              }
              labels={{
                accept: t('inbox.accept'), reject: t('inbox.reject'),
                confidence: t('inbox.confidence'),
                typeLabel: t(`inbox.type.${p.type}`),
                error: t('common.error_save'),
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
