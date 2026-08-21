import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { laToday } from '@/lib/date';
import { nextMonday } from '@/lib/weekly';
import { PrepareButton } from '@/components/weekly/prepare-button';
import { ReviewBoard } from '@/components/weekly/review-board';
import type { WeeklyReview, WeeklyReviewItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Review + items + task/project names in ONE embedded query (FKs from
// migration 0005) — the old review -> items -> titles chain cost three
// sequential database round trips.
type EmbeddedItem = WeeklyReviewItem & {
  task: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
};
type EmbeddedReview = WeeklyReview & { weekly_review_items: EmbeddedItem[] };

export default async function WeeklyPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const meetingDate = nextMonday(laToday());

  const { data: reviewData } = await supabase
    .from('weekly_reviews')
    .select('*, weekly_review_items(*, task:tasks(id,title), project:projects(id,name))')
    .eq('meeting_date', meetingDate)
    .order('sequence', { referencedTable: 'weekly_review_items', ascending: true })
    .maybeSingle();
  const embedded = reviewData as EmbeddedReview | null;

  return (
    <div>
      <h1 className="font-serif text-2xl text-ink sm:text-3xl">{t('weekly.title')}</h1>
      <p className="mt-1 text-sm text-ink3">{t('weekly.sub')}</p>
      {!embedded ? (
        <div className="mt-6 rounded-(--radius-card) border border-line bg-card p-6">
          <PrepareButton label={t('weekly.prepare')} error={t('common.error_save')} />
        </div>
      ) : (
        (() => {
          const { weekly_review_items: items, ...review } = embedded;
          return (
            <ReviewBoard review={review} groups={buildGroups(items, t)} labels={{
              error: t('common.error_save'),
              saved: t('weekly.saved'),
              save: t('weekly.save'),
              uploaded: t('weekly.uploaded'),
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
            }} />
          );
        })()
      )}
    </div>
  );
}

// Project (name, or "All" when the task carries no project) -> Sub-topic
// ("General" when unset) -> rows, preserving the already-sequence-sorted
// item order both across and within groups.
function buildGroups(items: EmbeddedItem[], t: ReturnType<typeof getT>) {
  interface Row { item: WeeklyReviewItem; title: string }
  interface SubtopicGroup { name: string; items: Row[] }
  interface ProjectGroupAcc { projectName: string; subtopics: Map<string, Row[]> }

  const order: string[] = [];
  const byProject = new Map<string, ProjectGroupAcc>();
  for (const embeddedItem of items) {
    const { task, project, ...item } = embeddedItem;
    const projectName = project?.name ?? t('common.all');
    const subtopicName = item.subtopic ?? t('weekly.general');
    let group = byProject.get(projectName);
    if (!group) {
      group = { projectName, subtopics: new Map() };
      byProject.set(projectName, group);
      order.push(projectName);
    }
    let rows = group.subtopics.get(subtopicName);
    if (!rows) { rows = []; group.subtopics.set(subtopicName, rows); }
    rows.push({ item, title: task?.title ?? '' });
  }

  return order.map((projectName): { projectName: string; subtopics: SubtopicGroup[] } => {
    const group = byProject.get(projectName)!;
    return {
      projectName,
      subtopics: [...group.subtopics.entries()].map(([name, rows]) => ({ name, items: rows })),
    };
  });
}
