import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { ReviewBoard, type ReviewRow } from '@/components/inbox/review-board';
import type { AgentProposal, ChangeType, Phase, Project, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

const prettyStage = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default async function InboxPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();

  // History matters here: Noa needs to see what she already decided, not only
  // what is waiting, so the queue loads every state and filters client-side.
  const [proposalsQ, projectsQ, phasesQ, stageMapQ] = await Promise.all([
    supabase.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('projects').select('id,name'),
    supabase.from('phases').select('*'),
    supabase.from('stage_phase_map').select('*'),
  ]);

  const proposals = (proposalsQ.data ?? []) as AgentProposal[];
  const names = new Map(((projectsQ.data ?? []) as Pick<Project, 'id' | 'name'>[]).map((p) => [p.id, p.name]));
  const phaseLabelByKey = new Map(((phasesQ.data ?? []) as Phase[]).map((ph) => [ph.key as string, ph.label]));
  const phaseKeyByStage = new Map(((stageMapQ.data ?? []) as { stage_key: string; phase_key: string }[])
    .map((m) => [m.stage_key, m.phase_key]));

  const taskIds = proposals.map((p) => p.target_task_id).filter((x): x is string => !!x);
  const { data: tasksData } = taskIds.length
    ? await supabase.from('tasks').select('*').in('id', taskIds)
    : { data: [] };
  const taskById = new Map(((tasksData ?? []) as Task[]).map((row) => [row.id, row]));

  const phaseLabelFor = (stageKey: string | null): string => {
    const key = stageKey ? phaseKeyByStage.get(stageKey) : null;
    return key ? (phaseLabelByKey.get(key) ?? '') : '';
  };
  const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

  const rows: ReviewRow[] = proposals.map((p) => {
    const task = p.target_task_id ? taskById.get(p.target_task_id) ?? null : null;
    const stageKey = asText(p.payload.stage_key) || task?.stage_key || null;
    const defaultChange: ChangeType = p.type === 'task_done'
      ? 'complete_existing'
      : task ? 'update_existing' : 'new_task';
    return {
      id: p.id,
      projectName: p.project_id ? names.get(p.project_id) ?? null : null,
      title: p.title ?? (asText(p.payload.title) || t(`inbox.type.${p.type}`)),
      phase: phaseLabelFor(stageKey),
      substage: stageKey ? prettyStage(stageKey) : '',
      owner: asText(p.payload.owner) || task?.owner || '',
      due: asText(p.payload.due) || task?.due || '',
      confidence: p.confidence >= 0.75 ? 'High' : p.confidence >= 0.5 ? 'Medium' : 'Low',
      evidence: p.evidence_excerpt ?? p.reasoning ?? '',
      changeType: p.change_type ?? defaultChange,
      resultNote: p.result_note ?? '',
      matchScore: p.match_score ?? (task ? Math.round(p.confidence * 100) : 0),
      matchReason: p.match_reason ?? p.reasoning ?? '',
      state: p.state,
      matched: task
        ? {
          title: task.title,
          status: t(`work.status.${task.status}`),
          owner: task.owner ?? '',
          phase: phaseLabelFor(task.stage_key),
          substage: task.stage_key ? prettyStage(task.stage_key) : '',
          due: task.due ?? '',
          latestUpdate: task.description ?? '',
        }
        : null,
    };
  });

  const labels: Record<string, string> = {
    needs: t('review.f_pending'), unsure: t('review.f_unsure'), approved: t('review.f_approved'),
    ignored: t('review.f_ignored'), wrong: t('review.f_wrong'), history: t('review.f_all'),
    match: t('review.match'), possibleDup: t('review.possible_dup'), noMatch: t('review.no_match'),
    general: t('common.general'), close: t('common.close'), error: t('common.error_save'),
    emptyTitle: t('review.empty_title'), emptySub: t('review.empty_sub'),
    kicker: t('inbox.title'),
    dupFound: t('review.dup_found'), likelyMatch: t('review.likely_match'), reviewHere: t('review.review_here'),
    existing: t('review.existing'), newInfo: t('review.new_info'), whySame: t('review.why_same'),
    latestUpdate: t('review.latest_update'), sourceSays: t('review.source_says'),
    treatment: t('review.treatment'), treatmentSub: t('review.treatment_sub'),
    fAction: t('review.f_action'), fPhase: t('review.f_phase'), fSubstage: t('review.f_substage'),
    fOwner: t('review.f_owner'), fDue: t('review.f_due'), fStatus: t('review.f_status'),
    fLocation: t('review.f_location'), fResult: t('review.f_result'), resultPh: t('review.result_ph'),
    wrongBtn: t('review.btn_wrong'), alreadyDone: t('review.btn_done'), apply: t('review.btn_apply'),
    restore: t('review.btn_restore'), undo: t('review.undo'), undone: t('review.undone'), undoFailed: t('common.error_save'),
    'ct.new_task': t('review.ct.new_task'), 'ct.update_existing': t('review.ct.update_existing'),
    'ct.complete_existing': t('review.ct.complete_existing'), 'ct.merge_duplicate': t('review.ct.merge_duplicate'),
    'ct.keep_open': t('review.ct.keep_open'), 'ct.information_only': t('review.ct.information_only'),
    'state.pending': t('review.f_pending'), 'state.accepted': t('review.f_approved'),
    'state.auto_applied': t('review.state_auto'), 'state.rejected': t('review.f_wrong'),
    'state.ignored': t('review.f_ignored'), 'state.not_sure': t('review.f_unsure'),
    'done.approved': t('review.done_applied'), 'done.rejected': t('review.done_rejected'),
    'done.not_sure': t('review.done_unsure'), 'done.ignored': t('review.done_ignored'),
    'done.pending': t('review.done_restored'),
  };

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink3">{t('inbox.title')}</p>
      <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{t('review.hero')}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink2">{t('review.hero_sub')}</p>
      <ReviewBoard rows={rows} labels={labels} />
    </div>
  );
}
