import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { laToday } from '@/lib/date';
import { nextMonday } from '@/lib/weekly';
import { PrepareButton } from '@/components/weekly/prepare-button';
import { ReviewBoard } from '@/components/weekly/review-board';
import type { Project, Task, WeeklyReview, WeeklyReviewItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WeeklyPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const meetingDate = nextMonday(laToday());

  const { data: reviewData } = await supabase
    .from('weekly_reviews')
    .select('*')
    .eq('meeting_date', meetingDate)
    .maybeSingle();
  const review = reviewData as WeeklyReview | null;

  return (
    <div>
      <h1 className="font-serif text-3xl text-ink">{t('weekly.title')}</h1>
      <p className="mt-1 text-sm text-ink3">{t('weekly.sub')}</p>
      {!review ? (
        <div className="mt-6 rounded-(--radius-card) border border-line bg-card p-6">
          <PrepareButton label={t('weekly.prepare')} error={t('common.error_save')} />
        </div>
      ) : (
        <ReviewBoard review={review} groups={await loadGroups(supabase, review, t)} labels={{
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
        }} />
      )}
    </div>
  );
}

async function loadGroups(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  review: WeeklyReview,
  t: ReturnType<typeof getT>,
) {
  const { data: itemsData } = await supabase
    .from('weekly_review_items')
    .select('*')
    .eq('weekly_review_id', review.id)
    .order('sequence', { ascending: true });
  const items = (itemsData ?? []) as WeeklyReviewItem[];

  const taskIds = items.map((i) => i.task_id);
  const projectIds = items.map((i) => i.project_id).filter((x): x is string => !!x);

  const [tasksQ, projectsQ] = await Promise.all([
    taskIds.length ? supabase.from('tasks').select('id,title').in('id', taskIds) : Promise.resolve({ data: [] as unknown[] }),
    projectIds.length ? supabase.from('projects').select('id,name').in('id', projectIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const taskTitles = new Map(((tasksQ.data ?? []) as Pick<Task, 'id' | 'title'>[]).map((r) => [r.id, r.title]));
  const projectNames = new Map(((projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[]).map((r) => [r.id, r.name]));

  // Project (name, or "All" when the task carries no project) -> Sub-topic
  // ("General" when unset) -> rows, preserving the already-sequence-sorted
  // item order both across and within groups.
  interface Row { item: WeeklyReviewItem; title: string }
  interface SubtopicGroup { name: string; items: Row[] }
  interface ProjectGroupAcc { projectName: string; subtopics: Map<string, Row[]> }

  const order: string[] = [];
  const byProject = new Map<string, ProjectGroupAcc>();
  for (const item of items) {
    const projectName = item.project_id ? projectNames.get(item.project_id) ?? t('common.all') : t('common.all');
    const subtopicName = item.subtopic ?? t('weekly.general');
    let group = byProject.get(projectName);
    if (!group) {
      group = { projectName, subtopics: new Map() };
      byProject.set(projectName, group);
      order.push(projectName);
    }
    let rows = group.subtopics.get(subtopicName);
    if (!rows) { rows = []; group.subtopics.set(subtopicName, rows); }
    rows.push({ item, title: taskTitles.get(item.task_id) ?? '' });
  }

  return order.map((projectName): { projectName: string; subtopics: SubtopicGroup[] } => {
    const group = byProject.get(projectName)!;
    return {
      projectName,
      subtopics: [...group.subtopics.entries()].map(([name, rows]) => ({ name, items: rows })),
    };
  });
}
