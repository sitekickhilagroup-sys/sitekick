import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { mergeNoteSources, rankTargetCandidates, ensureSourceTaskCandidate, isAmbiguous, buildClarifyingQuestion } from '@/lib/notes-center';
import { NotesCenterBoard, type NotesCenterRow } from '@/components/notes/notes-center-board';
import type { CommentIntent } from '@/lib/comment-intent';

export const dynamic = 'force-dynamic';

/**
 * Notes Center (Noa's report §2 — "a screen, not a Markdown file"): merges
 * every real note (`comments`) with historical "(... via Claude)" attributed
 * notes still living on `tasks.latest_note`, ranks candidate targets for each,
 * and lets Noa confirm/correct the interpretation and association — without
 * touching any business record. Reachable from My Work's nav and the notes
 * assistant widget (not only this direct URL).
 */
export default async function NotesCenterPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();

  const [commentsQ, tasksQ, projectsQ, blockersQ] = await Promise.all([
    // Every note, not just the viewer's own — this screen reviews ALL
    // recorded feedback, unlike the widget's personal recent-notes list.
    supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('tasks').select('id,title,project_id,status,latest_note,last_touched').eq('status', 'open'),
    supabase.from('projects').select('id,name').eq('active', true).order('name'),
    supabase.from('blockers').select('id,what,project_id').eq('status', 'active'),
  ]);

  const projects = (projectsQ.data ?? []) as { id: string; name: string }[];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const tasks = (tasksQ.data ?? []) as { id: string; title: string; project_id: string | null; status: string; latest_note: string | null; last_touched: string | null }[];
  const taskTitle = new Map(tasks.map((tk) => [tk.id, tk.title]));
  const blockers = (blockersQ.data ?? []) as { id: string; what: string | null; project_id: string | null }[];
  const blockerLabel = new Map(blockers.map((b) => [b.id, b.what ?? b.id]));

  const entityLabel = (type: string, id: string | null): string => {
    if (type === 'task' && id) return `${t('nav.work')} · ${taskTitle.get(id) ?? '—'}`;
    if (type === 'project' && id) return `${t('common.project')} · ${projectName.get(id) ?? '—'}`;
    if (type === 'blocker' && id) return `${t('notes.link_blocker')} · ${blockerLabel.get(id) ?? '—'}`;
    return t('notes.link_general');
  };

  const commentsForMerge = ((commentsQ.data ?? []) as {
    id: string; entity_type: 'task' | 'project' | 'invoice' | 'blocker' | 'general'; entity_id: string | null;
    body: string; suggested_intent: CommentIntent; intent: CommentIntent; created_by: string; created_at: string;
  }[]).map((c) => ({
    id: c.id, entityType: c.entity_type, entityId: c.entity_id, body: c.body,
    suggestedIntent: c.suggested_intent, intent: c.intent, createdBy: c.created_by, createdAt: c.created_at,
  }));
  const historicalTasks = tasks
    .filter((tk) => !!tk.latest_note)
    .map((tk) => ({ taskId: tk.id, latestNote: tk.latest_note as string, lastTouched: tk.last_touched }));

  const merged = mergeNoteSources(commentsForMerge, historicalTasks);

  const candidatePool = {
    tasks: tasks.map((tk) => ({ id: tk.id, title: tk.title })),
    projects,
    blockers: blockers.map((b) => ({ id: b.id, what: b.what ?? '' })),
  };

  const rows: NotesCenterRow[] = merged.map((n) => {
    const ranked = rankTargetCandidates(n.body, candidatePool);
    // A historical note's own originating task is always a visible option —
    // keyword overlap between a long note and short titles is noisy enough
    // that a generic short title can outscore the note's real, demonstrable
    // home (live-observed: "Noa's agreement" outranked the correct task).
    const candidates = ensureSourceTaskCandidate(ranked, n.sourceTaskId, n.sourceTaskId ? taskTitle.get(n.sourceTaskId) ?? null : null);
    const question = buildClarifyingQuestion(candidates);
    // A note already associated to a real entity shows that entity's label as
    // its current home; a virtual historical item shows the task it came from.
    const currentLabel = n.entityType && n.entityType !== 'general'
      ? entityLabel(n.entityType, n.entityId)
      : n.sourceTaskId
        ? `${t('nav.work')} · ${taskTitle.get(n.sourceTaskId) ?? '—'}`
        : null;
    return {
      id: n.id,
      source: n.source,
      body: n.body,
      createdAt: n.createdAt,
      sourceTaskId: n.sourceTaskId,
      currentLabel,
      suggestedIntent: n.suggestedIntent,
      intent: n.intent,
      state: n.state,
      candidates: candidates.map((c) => ({ kind: c.kind, id: c.id, label: c.label, score: Math.round(c.score * 100), why: c.why })),
      ambiguous: isAmbiguous(candidates),
      clarifyingQuestion: question,
    };
  });

  const counts = {
    needs_review: rows.filter((r) => r.state === 'needs_review').length,
    associated: rows.filter((r) => r.state === 'associated').length,
    general: rows.filter((r) => r.state === 'general').length,
    all: rows.length,
  };

  const taskOptions = tasks.map((tk) => ({ id: tk.id, label: tk.project_id ? `${projectName.get(tk.project_id) ?? ''} · ${tk.title}` : tk.title }));
  const projectOptions = projects.map((p) => ({ id: p.id, label: p.name }));
  const blockerOptions = blockers.map((b) => ({ id: b.id, label: b.what ?? b.id }));

  const labels: Record<string, string> = {
    kicker: t('notes_center.kicker'),
    title: t('notes_center.title'),
    sub: t('notes_center.sub'),
    filterNeedsReview: t('notes_center.f_needs_review'),
    filterAssociated: t('notes_center.f_associated'),
    filterGeneral: t('notes_center.f_general'),
    filterAll: t('notes_center.f_all'),
    empty: t('notes_center.empty'),
    sourceAssistant: t('notes_center.src_assistant'),
    sourceHistorical: t('notes_center.src_historical'),
    historicalWarning: t('notes_center.historical_warning'),
    openTask: t('notes_center.open_task'),
    weRead: t('notes_center.we_read'),
    'intent.preference': t('notes.intent_preference'),
    'intent.instruction': t('notes.intent_instruction'),
    'intent.fact': t('notes.intent_fact'),
    whereBelongs: t('notes_center.where_belongs'),
    searchPlaceholder: t('notes_center.search_placeholder'),
    linkTask: t('nav.work'),
    linkProject: t('common.project'),
    linkBlocker: t('notes.link_blocker'),
    linkGeneral: t('notes.link_general'),
    ambiguousIntro: t('notes_center.ambiguous_intro'),
    whatHappens: t('notes_center.what_happens'),
    whatHappensBody: t('notes_center.what_happens_body'),
    save: t('notes_center.save'),
    markGeneral: t('notes_center.mark_general'),
    skip: t('notes_center.skip'),
    close: t('common.close'),
    saved: t('notes_center.saved'),
    error: t('notes_center.error'),
    current: t('notes_center.current'),
    noCandidates: t('notes_center.no_candidates'),
  };

  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-ink3 uppercase">{labels.kicker}</p>
      <h1 className="mt-1 font-serif text-2xl text-ink">{labels.title}</h1>
      <p className="mt-1 text-sm text-ink2">{labels.sub}</p>
      <NotesCenterBoard
        rows={rows}
        counts={counts}
        taskOptions={taskOptions}
        projectOptions={projectOptions}
        blockerOptions={blockerOptions}
        labels={labels}
      />
    </main>
  );
}
