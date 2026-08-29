import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { resolveTaskPhaseKey, resolveTaskSubstageLabel } from '@/lib/task-details';
import { ReviewBoard, type ReviewRow } from '@/components/inbox/review-board';
import type { AgentProposal, ChangeType, Phase, PhaseKey, Project, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

const prettyStage = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const sp = await searchParams;
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();

  // History matters here: Noa needs to see what she already decided, not only
  // what is waiting, so the queue loads every state and filters client-side.
  //
  // I2: a task's phase is derived (substage -> legacy -> project), never
  // read off stage_key alone — see resolveTaskPhaseKey (lib/task-details.ts)
  // and work/page.tsx's own phaseLabelFor, which this now matches. This page
  // used to keep its own legacy-stage_key-only copy, so the same task could
  // read a different phase here than on My Work the moment it carried a
  // substage_template_id — latent until 0015 lands, and no task's diff in
  // this round touched this file, so no reviewer saw it.
  // Two queries, not one window: EVERY pending row always loads (a pending
  // suggestion must never fall off the page — with 270+ history rows the old
  // 200-newest window silently hid the entire queue while the bell kept
  // counting it), plus the newest 200 of everything for the history shelves.
  const [pendingQ, proposalsQ, projectsQ, phasesQ, stageMapQ, substageTemplatesQ] = await Promise.all([
    supabase.from('agent_proposals').select('*').eq('state', 'pending').order('created_at', { ascending: false }).limit(500),
    supabase.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('projects').select('id,name,current_phase_key,active'),
    supabase.from('phases').select('*'),
    supabase.from('stage_phase_map').select('*'),
    supabase.from('substage_templates').select('id,phase_key,name'),
  ]);

  const pendingRows = (pendingQ.data ?? []) as AgentProposal[];
  const historyRows = (proposalsQ.data ?? []) as AgentProposal[];
  const pendingIds = new Set(pendingRows.map((p) => p.id));
  let proposals = [...pendingRows, ...historyRows.filter((p) => !pendingIds.has(p.id))];
  const projectRows = (projectsQ.data ?? []) as Pick<Project, 'id' | 'name' | 'current_phase_key' | 'active'>[];
  // Drawer attribution select: active projects only — filing new work under
  // a parked project would just hide it.
  const projectOptions = projectRows
    .filter((p) => p.active !== false)
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = new Map(projectRows.map((p) => [p.id, p.name]));
  const projectPhaseById = new Map(projectRows.map((p) => [p.id, p.current_phase_key]));
  const phaseLabelByKey = new Map(((phasesQ.data ?? []) as Phase[]).map((ph) => [ph.key as string, ph.label]));
  const phaseKeyByStage = new Map(((stageMapQ.data ?? []) as { stage_key: string; phase_key: PhaseKey }[])
    .map((m) => [m.stage_key, m.phase_key]));
  const substageTemplates = (substageTemplatesQ.data ?? []) as { id: string; phase_key: PhaseKey; name: string }[];
  const phaseKeyBySubstageId = new Map(substageTemplates.map((s) => [s.id, s.phase_key]));
  const substageNameById = new Map(substageTemplates.map((s) => [s.id, s.name]));

  // I8: "Review when ready" on the Data Inbox links here with the document
  // that produced the row(s), ?doc=<document id> (see app/(dash)/(focused)/
  // upload/page.tsx). A stale/hostile value — matching no proposal actually
  // loaded above — is dropped rather than honored, the same rule work/
  // page.tsx applies to its own ?substage= deep link: checked against the
  // set of real values already being loaded, not a separate existence query.
  const rawDoc = typeof sp.doc === 'string' ? sp.doc : '';
  const docIds = new Set(proposals.map((p) => p.document_id).filter((x): x is string => !!x));
  const spDoc = rawDoc && docIds.has(rawDoc) ? rawDoc : '';
  if (spDoc) proposals = proposals.filter((p) => p.document_id === spDoc);

  const taskIds = proposals.map((p) => p.target_task_id).filter((x): x is string => !!x);
  const { data: tasksData } = taskIds.length
    ? await supabase.from('tasks').select('*').in('id', taskIds)
    : { data: [] };
  const taskById = new Map(((tasksData ?? []) as Task[]).map((row) => [row.id, row]));

  const phaseLabelForKey = (key: PhaseKey | null): string => (key ? (phaseLabelByKey.get(key) ?? '') : '');
  // A task's own derived phase — same precedence as work/page.tsx's
  // phaseLabelFor: the sub-stage it's actually on wins, then the legacy
  // stage_key bridge, then the project's current phase.
  const taskPhaseKey = (task: Task): PhaseKey | null => resolveTaskPhaseKey({
    substagePhaseKey: task.substage_template_id ? phaseKeyBySubstageId.get(task.substage_template_id) ?? null : null,
    legacyPhaseKey: task.stage_key ? phaseKeyByStage.get(task.stage_key) ?? null : null,
    projectPhaseKey: task.project_id ? projectPhaseById.get(task.project_id) ?? null : null,
  });
  const taskSubstageLabel = (task: Task): string => resolveTaskSubstageLabel({
    substageName: task.substage_template_id ? substageNameById.get(task.substage_template_id) ?? null : null,
    legacyLabel: task.stage_key ? prettyStage(task.stage_key) : null,
  }) ?? '';
  const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

  const rows: ReviewRow[] = proposals.map((p) => {
    const task = p.target_task_id ? taskById.get(p.target_task_id) ?? null : null;
    // A stage_key the payload itself proposes is a raw legacy value with no
    // task to derive from — resolveTaskPhaseKey has nothing to add there, so
    // it stays a direct legacy-bridge lookup. Only when the payload is
    // silent does this fall back to the MATCHED task's own state, and that
    // fallback now goes through the same derivation My Work uses (I2),
    // rather than repeating the legacy-only read that could disagree with it.
    const proposedStageKey = asText(p.payload.stage_key) || null;
    const phase = proposedStageKey
      ? phaseLabelForKey(phaseKeyByStage.get(proposedStageKey) ?? null)
      : task ? phaseLabelForKey(taskPhaseKey(task)) : '';
    const substage = proposedStageKey
      ? prettyStage(proposedStageKey)
      : task ? taskSubstageLabel(task) : '';
    const defaultChange: ChangeType = p.type === 'task_done'
      ? 'complete_existing'
      : task ? 'update_existing' : 'new_task';
    return {
      id: p.id,
      projectId: p.project_id,
      projectName: p.project_id ? names.get(p.project_id) ?? null : null,
      title: p.title ?? (asText(p.payload.title) || t(`inbox.type.${p.type}`)),
      phase,
      substage,
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
          phase: phaseLabelForKey(taskPhaseKey(task)),
          substage: taskSubstageLabel(task),
          due: task.due ?? '',
          latestUpdate: task.description ?? '',
        }
        : null,
    };
  });

  const labels: Record<string, string> = {
    needs: t('review.f_pending'), unsure: t('review.f_unsure'), approved: t('review.f_approved'),
    ignored: t('review.f_ignored'), wrong: t('review.f_wrong'), history: t('review.f_all'),
    auto: t('review.state_auto'),
    selectAll: t('review.select_all'), selectedN: t('review.selected_n'),
    bulkApprove: t('review.bulk_approve'), bulkIgnore: t('review.bulk_ignore'),
    triageNow: t('review.triage_now'), triageDone: t('review.triage_done'),
    fProject: t('common.project'), projectLearnHint: t('review.project_learn_hint'),
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
    'ct.keep_both_linked': t('review.ct.keep_both_linked'),
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
      {/* I8: a scoped view (?doc=) must never look like an unexplained empty
          list — say what it's scoped to, and always offer the way back. */}
      {spDoc && (
        <p className="mt-2 text-xs text-ink3">
          {t('inbox.showing_file')}
          {' · '}
          <Link href="/inbox" className="font-semibold text-sage hover:underline">{t('inbox.show_all')}</Link>
        </p>
      )}
      <ReviewBoard rows={rows} projects={projectOptions} labels={labels} />
    </div>
  );
}
