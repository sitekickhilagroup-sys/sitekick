import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { NotesBoard, type NotesBoardOptions } from '@/components/notes/notes-board';
import type { CommentRow } from '@/app/actions/comments';
import type { CommentIntent } from '@/lib/comment-intent';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const user = await requireUser();
  const me = user.email ?? user.id;
  const supabase = await supabaseServer();

  const [commentsQ, tasksQ, projectsQ] = await Promise.all([
    supabase.from('comments').select('*').eq('created_by', me).order('created_at', { ascending: false }).limit(50),
    supabase.from('tasks').select('id,title,project_id').eq('status', 'open').order('last_touched', { ascending: false }).limit(500),
    supabase.from('projects').select('id,name').eq('active', true).order('name'),
  ]);

  const projects = (projectsQ.data ?? []) as { id: string; name: string }[];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const tasks = (tasksQ.data ?? []) as { id: string; title: string; project_id: string | null }[];
  const taskTitle = new Map(tasks.map((tk) => [tk.id, tk.title]));

  const entityLabel = (type: string, id: string | null): string => {
    if (type === 'task' && id) return `${t('nav.work')} · ${taskTitle.get(id) ?? '—'}`;
    if (type === 'project' && id) return `${t('common.project')} · ${projectName.get(id) ?? '—'}`;
    return t('notes.link_general');
  };

  const comments: CommentRow[] = ((commentsQ.data ?? []) as {
    id: string; entity_type: 'task' | 'project' | 'general'; entity_id: string | null;
    body: string; suggested_intent: CommentIntent; intent: CommentIntent; created_by: string; created_at: string;
  }[]).map((c) => ({
    id: c.id,
    entityType: c.entity_type,
    entityId: c.entity_id,
    entityLabel: entityLabel(c.entity_type, c.entity_id),
    body: c.body,
    suggestedIntent: c.suggested_intent,
    intent: c.intent,
    createdBy: c.created_by,
    createdAt: c.created_at,
  }));

  const options: NotesBoardOptions = {
    tasks: tasks.map((tk) => ({
      id: tk.id,
      label: tk.project_id ? `${projectName.get(tk.project_id) ?? ''} · ${tk.title}` : tk.title,
    })),
    projects: projects.map((p) => ({ id: p.id, label: p.name })),
  };

  const labels: Record<string, string> = {
    composerTitle: t('notes.composer_title'), composerSub: t('notes.composer_sub'),
    placeholder: t('notes.placeholder'), linkTo: t('notes.link_to'),
    linkGeneral: t('notes.link_general'), linkTask: t('nav.work'), linkProject: t('common.project'),
    pick: t('notes.pick'),
    save: t('notes.save'), noActionsNote: t('notes.no_actions'),
    recentTitle: t('notes.recent_title'), empty: t('notes.empty'), readAs: t('notes.read_as'),
    corrected: t('notes.corrected'),
    'intent.preference': t('notes.intent_preference'),
    'intent.instruction': t('notes.intent_instruction'),
    'intent.fact': t('notes.intent_fact'),
  };

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('notes.kicker')}</p>
      <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('notes.hero')}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink2">{t('notes.hero_sub')}</p>
      <NotesBoard comments={comments} options={options} labels={labels} />
    </div>
  );
}
