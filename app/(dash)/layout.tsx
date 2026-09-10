import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { NotesAssistant, type NotesAssistantOptions } from '@/components/notes/notes-assistant';
import type { CommentRow } from '@/app/actions/comments';
import type { CommentIntent } from '@/lib/comment-intent';

// Common shell for the (standard) and (focused) route groups. proxy.ts is the
// primary auth gate, but its matcher excludes image extensions — so a dynamic
// segment like /projects/<id>.png slips past it with no session check. This
// requireUser() at the single shared ancestor of every dash route is the
// structural backstop: it doesn't depend on AppHeader (whose requireUser()
// exists to fetch an avatar, not as a gate) or on any page remembering to check.
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  let me: string;
  try {
    const user = await requireUser();
    me = user.email ?? user.id;
  } catch {
    redirect('/login');
  }
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  // Global notes assistant data (kept light — runs on every dash page). A
  // missing `comments` table (migration not yet applied) degrades to an empty
  // thread, never a crash.
  const supabase = await supabaseServer();
  const [commentsQ, tasksQ, projectsQ, invoicesQ, blockersQ] = await Promise.all([
    supabase.from('comments').select('*').eq('created_by', me).order('created_at', { ascending: false }).limit(30),
    supabase.from('tasks').select('id,title,project_id').eq('status', 'open').order('last_touched', { ascending: false }).limit(500),
    supabase.from('projects').select('id,name').eq('active', true).order('name'),
    supabase.from('invoices').select('id,number,amount_usd,entity,project_id').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(300),
    supabase.from('blockers').select('id,what,project_id').eq('status', 'active').order('days_stuck', { ascending: false }).limit(200),
  ]);
  const projects = (projectsQ.data ?? []) as { id: string; name: string }[];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const tasks = (tasksQ.data ?? []) as { id: string; title: string; project_id: string | null }[];
  const taskTitle = new Map(tasks.map((tk) => [tk.id, tk.title]));
  const invoices = (invoicesQ.data ?? []) as { id: string; number: string | null; amount_usd: number | null; entity: string | null; project_id: string | null }[];
  const invoiceLabelById = new Map(invoices.map((iv) => [iv.id, [
    iv.number && `#${iv.number}`,
    iv.entity || (iv.project_id ? projectName.get(iv.project_id) : null),
    iv.amount_usd != null && `$${iv.amount_usd}`,
  ].filter(Boolean).join(' · ') || iv.id]));
  const blockers = (blockersQ.data ?? []) as { id: string; what: string | null; project_id: string | null }[];
  const blockerLabelById = new Map(blockers.map((b) => [b.id, b.what ?? b.id]));

  const entityLabel = (type: string, id: string | null): string => {
    if (type === 'task' && id) return `${t('nav.work')} · ${taskTitle.get(id) ?? '—'}`;
    if (type === 'project' && id) return `${t('common.project')} · ${projectName.get(id) ?? '—'}`;
    if (type === 'invoice' && id) return `${t('nav.invoices')} · ${invoiceLabelById.get(id) ?? '—'}`;
    if (type === 'blocker' && id) return `${t('notes.link_blocker')} · ${blockerLabelById.get(id) ?? '—'}`;
    return t('notes.link_general');
  };
  const comments: CommentRow[] = ((commentsQ.data ?? []) as {
    id: string; entity_type: 'task' | 'project' | 'general'; entity_id: string | null;
    body: string; suggested_intent: CommentIntent; intent: CommentIntent; created_by: string; created_at: string;
  }[]).map((c) => ({
    id: c.id, entityType: c.entity_type, entityId: c.entity_id,
    entityLabel: entityLabel(c.entity_type, c.entity_id),
    body: c.body, suggestedIntent: c.suggested_intent, intent: c.intent,
    createdBy: c.created_by, createdAt: c.created_at,
  }));
  const options: NotesAssistantOptions = {
    tasks: tasks.map((tk) => ({ id: tk.id, label: tk.project_id ? `${projectName.get(tk.project_id) ?? ''} · ${tk.title}` : tk.title })),
    projects: projects.map((p) => ({ id: p.id, label: p.name })),
    invoices: invoices.map((iv) => ({ id: iv.id, label: invoiceLabelById.get(iv.id) ?? iv.id })),
    blockers: blockers.map((b) => ({ id: b.id, label: b.what ?? b.id })),
  };
  const notesLabels: Record<string, string> = {
    open: t('notes.assistant_open'), title: t('notes.assistant_title'), subtitle: t('notes.assistant_sub'),
    close: t('common.close'), empty: t('notes.empty'), ack: t('notes.ack'), readAs: t('notes.read_as'),
    placeholder: t('notes.placeholder'), send: t('notes.send'), noActions: t('notes.no_actions'),
    linkGeneral: t('notes.link_general'), linkTask: t('nav.work'), linkProject: t('common.project'),
    linkInvoice: t('nav.invoices'), linkBlocker: t('notes.link_blocker'), pick: t('notes.pick'),
    centerLink: t('notes.center_link'),
    'intent.preference': t('notes.intent_preference'),
    'intent.instruction': t('notes.intent_instruction'),
    'intent.fact': t('notes.intent_fact'),
  };

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:shadow-card"
      >
        {t('nav.skip')}
      </a>
      {children}
      <NotesAssistant comments={comments} options={options} labels={notesLabels} />
    </div>
  );
}
