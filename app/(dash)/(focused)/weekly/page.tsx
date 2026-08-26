import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { laToday } from '@/lib/date';
import { nextMonday } from '@/lib/weekly';
import { WeeklyHeader } from '@/components/chrome/weekly-header';
import { PrepareButton } from '@/components/weekly/prepare-button';
import { ReviewBoard } from '@/components/weekly/review-board';
import type { WeeklyReview, WeeklyReviewItem, WeeklyReviewSubtopic } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Review + items + task/project names in ONE embedded query (FKs from
// migration 0005) — the old review -> items -> titles chain cost three
// sequential database round trips.
type EmbeddedItem = WeeklyReviewItem & {
  task: { id: string; title: string; owner: string | null; due: string | null } | null;
  project: { id: string; name: string } | null;
};
type EmbeddedReview = WeeklyReview & {
  weekly_review_items: EmbeddedItem[];
  weekly_review_subtopics: WeeklyReviewSubtopic[];
};

export default async function WeeklyPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const meetingDate = nextMonday(laToday());

  const { data: reviewData } = await supabase
    .from('weekly_reviews')
    .select('*, weekly_review_items(*, task:tasks(id,title,owner,due), project:projects(id,name)), weekly_review_subtopics(*)')
    .eq('meeting_date', meetingDate)
    .order('sequence', { referencedTable: 'weekly_review_items', ascending: true })
    .maybeSingle();
  const embedded = reviewData as EmbeddedReview | null;

  return (
    <>
      <WeeklyHeader />
      <div className="sk-page mx-auto max-w-[1040px] px-4 pt-6 pb-16 sm:px-6">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('weekly.title')}</p>
      <h1 className="mt-1 text-[clamp(26px,2.6vw,30px)] font-[650] leading-[1.1] tracking-[-0.035em] text-sk-ink">
        {t('weekly.sub')}
      </h1>
      {!embedded ? (
        <div className="mt-6 rounded-(--radius-card) border border-line bg-card p-6">
          <PrepareButton label={t('weekly.prepare')} error={t('common.error_save')} />
        </div>
      ) : (
        (() => {
          const { weekly_review_items: items, weekly_review_subtopics: contexts, ...review } = embedded;
          return (
            <ReviewBoard review={review} groups={buildGroups(items, contexts, t)} labels={{
              contextPh: t('weekly.context_ph'),
              error: t('common.error_save'),
              saved: t('weekly.saved'),
              save: t('weekly.save'),
              // D4: the upload card now renders "{name} · {date} · Processed"
              // on success (not a bare "Recording attached" flag), so this
              // replaces weekly.uploaded as what review-board.tsx reads.
              processed: t('weekly.processed'),
              upload: t('weekly.upload'),
              note: t('weekly.note'),
              meeting: t('weekly.meeting'),
              completed: t('work.verb.completed'),
              notApplicable: t('work.verb.not_applicable'),
              statusOpen: t('weekly.status_open'),
              noItems: t('weekly.no_items'),
              progress: t('weekly.progress'),
              stCarried: t('weekly.st_carried'),
              stWaiting: t('weekly.st_waiting'),
              stBlocked: t('weekly.st_blocked'),
              stNoUpdate: t('weekly.st_no_update'),
              itemKicker: t('weekly.item_kicker'),
              modeDraft: t('weekly.mode_draft'),
              modePresent: t('weekly.mode_present'),
              step1t: t('weekly.step1_t'), step1d: t('weekly.step1_d'),
              step2t: t('weekly.step2_t'), step2d: t('weekly.step2_d'),
              step3t: t('weekly.step3_t'), step3d: t('weekly.step3_d'),
              saveKicker: t('weekly.save_kicker'),
              saveSub: t('weekly.save_sub'),
              uploadKicker: t('weekly.upload_kicker'),
              uploadSub: t('weekly.upload_sub'),
              noteKicker: t('weekly.note_kicker'),
              ownerLabel: t('weekly.owner'),
              archiveNote: t('weekly.archive_note'),
              statusLabel: t('weekly.status_label'),
              completedN: t('weekly.completed_n'),
              actionsN: t('weekly.actions_n'),
              actions1: t('weekly.actions_1'),
              // Was never passed, so the SUB-TOPIC eyebrow the spec requires
              // silently never rendered.
              subTopic: t('weekly.sub_topic'),
              noSubtopics: t('weekly.no_subtopics'),
              noActions: t('weekly.no_actions'),
              modeNoteDraft: t('weekly.mode_note_draft'),
              modeNoteMeeting: t('weekly.mode_note_meeting'),
              uploadKickerDraft: t('weekly.upload_kicker_draft'),
              // D1: Finalize / Reopen, distinct from Save.
              finalize: t('weekly.finalize'),
              reopen: t('weekly.reopen'),
              finalizeConfirm: t('weekly.finalize_confirm'),
              // Raw template with a literal "{date}" — substituted client-side
              // in ReviewControls, same pattern `progress` already uses (the
              // real value comes from review.finalized_at, which only the
              // client component has after ReviewBoard passes `review` down).
              finalizedBadge: t('weekly.finalized_badge'),
              // D2: Next step field + Owner/Due inline editing.
              nextStepKicker: t('weekly.next_step_kicker'),
              nextStepPh: t('weekly.next_step_ph'),
              // Reuses the same "Due" label /work already shows for this
              // column, rather than a second weekly-only translation of it.
              dueLabel: t('work.col_due'),
            }} />
          );
        })()
      )}
      </div>
    </>
  );
}

// Project (name, or "All" when the task carries no project) -> Sub-topic
// ("General" when unset) -> rows, preserving the already-sequence-sorted
// item order both across and within groups.
function buildGroups(items: EmbeddedItem[], contexts: WeeklyReviewSubtopic[], t: ReturnType<typeof getT>) {
  interface Row { item: WeeklyReviewItem; title: string; owner: string | null; due: string | null }
  interface SubtopicGroup { name: string; projectId: string | null; context: string | null; items: Row[] }
  interface ProjectGroupAcc { projectName: string; projectId: string | null; subtopics: Map<string, Row[]> }

  const ctxByKey = new Map(contexts.map((c) => [`${c.project_id ?? ''}|${c.subtopic}`, c.context]));

  const order: string[] = [];
  const byProject = new Map<string, ProjectGroupAcc>();
  for (const embeddedItem of items) {
    const { task, project, ...item } = embeddedItem;
    const projectName = project?.name ?? t('common.general');
    const subtopicName = item.subtopic ?? t('weekly.general');
    let group = byProject.get(projectName);
    if (!group) {
      group = { projectName, projectId: item.project_id ?? null, subtopics: new Map() };
      byProject.set(projectName, group);
      order.push(projectName);
    }
    let rows = group.subtopics.get(subtopicName);
    if (!rows) { rows = []; group.subtopics.set(subtopicName, rows); }
    rows.push({ item, title: task?.title ?? '', owner: task?.owner ?? null, due: task?.due ?? null });
  }

  // Spec §14: General renders last. First-encountered order could otherwise
  // drop it in the middle of the real projects.
  const general = t('common.general');
  order.sort((a, b) => (a === general ? 1 : 0) - (b === general ? 1 : 0));

  return order.map((projectName): { projectName: string; subtopics: SubtopicGroup[] } => {
    const group = byProject.get(projectName)!;
    return {
      projectName,
      subtopics: [...group.subtopics.entries()].map(([name, rows]) => ({
        name,
        projectId: group.projectId,
        context: ctxByKey.get(`${group.projectId ?? ''}|${name}`) ?? null,
        items: rows,
      })),
    };
  });
}
