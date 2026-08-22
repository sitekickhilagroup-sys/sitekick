'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { type PhaseKey, type ProjectSubstageStatus } from '@/lib/types';
import { logActivity } from '@/lib/state-writer';
import { inferProjectPhase } from '@/agents/infer-phase';

const VALID_PHASES: PhaseKey[] = ['planning', 'plan_check', 'bidding', 'financing', 'construction'];
// Noa's full sub-stage lifecycle (spec §ג, enum widened in 0007).
const VALID_SUBSTAGE_STATUSES: ProjectSubstageStatus[] = [
  'upcoming', 'active', 'done', 'not_applicable',
  'waiting', 'blocked', 'verify', 'submitted', 'with_city',
];

export async function setSubstageStatus(
  projectId: string,
  projectSubstageId: string,
  status: ProjectSubstageStatus,
) {
  const user = await requireUser();
  if (!VALID_SUBSTAGE_STATUSES.includes(status)) return { error: 'invalid status' };
  const admin = supabaseAdmin();
  const completed_at = status === 'done' ? laToday() : null;
  const { error } = await admin.from('project_substages').update({ status, completed_at }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage',
    entity_id: projectSubstageId,
    actor: user.email ?? user.id,
    action: `status:${status}`,
    after: { status },
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true };
}

// Spec §ג: every sub-stage carries a short explanation ("what is needed to
// complete it") — her demo shows it under the name and in the detail panel.
export async function setSubstageNote(projectId: string, projectSubstageId: string, note: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const trimmed = note.trim() || null;
  const { error } = await admin.from('project_substages').update({ note: trimmed }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage',
    entity_id: projectSubstageId,
    actor: user.email ?? user.id,
    action: 'set_note',
    after: { note: trimmed },
  });
  revalidatePath('/projects/' + projectId);
  return { ok: true };
}

/**
 * The conditional rule attached to a sub-stage (spec §ד): "IF the extension is
 * denied THEN …". It is stored so the outcomes can be explored, never applied —
 * choosing an option in the UI changes nothing about project state.
 */
export async function setSubstageDecision(
  projectId: string,
  projectSubstageId: string,
  decision: { label: string; options: string[]; results: string[] } | null,
) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  let value: { label: string; options: string[]; results: string[] } | null = null;
  if (decision) {
    const label = decision.label.trim();
    const pairs = decision.options
      .map((option, i) => ({ option: option.trim(), result: (decision.results[i] ?? '').trim() }))
      .filter((p) => p.option);
    if (!label || pairs.length < 2) return { error: 'a decision needs a question and at least two outcomes' };
    value = { label, options: pairs.map((p) => p.option), results: pairs.map((p) => p.result) };
  }
  const { error } = await admin.from('project_substages').update({ decision: value }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage',
    entity_id: projectSubstageId,
    actor: user.email ?? user.id,
    action: value ? 'set_decision' : 'clear_decision',
    after: value,
  });
  revalidatePath('/projects/' + projectId);
  return { ok: true };
}

export async function activateSubstage(projectId: string, substageTemplateId: string, workstreamId: string | null) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('project_substages')
    .upsert(
      {
        project_id: projectId,
        substage_template_id: substageTemplateId,
        workstream_id: workstreamId,
        status: 'active',
        activated_at: laToday(),
      },
      { onConflict: 'project_id,substage_template_id' },
    )
    .select('id')
    .single();
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage',
    entity_id: data.id,
    actor: user.email ?? user.id,
    action: 'activate',
    after: { substage_template_id: substageTemplateId, workstream_id: workstreamId },
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true };
}

export async function setCurrentPhase(projectId: string, phaseKey: PhaseKey) {
  const user = await requireUser();
  if (!VALID_PHASES.includes(phaseKey)) return { error: 'invalid phase' };
  const admin = supabaseAdmin();
  const { error } = await admin.from('projects').update({ current_phase_key: phaseKey }).eq('id', projectId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project',
    entity_id: projectId,
    actor: user.email ?? user.id,
    action: 'set_phase',
    after: { phaseKey },
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true };
}

// Narrative context paragraph (0006). Manual first-class; agents may propose
// later, but a person can always set it directly.
export async function setProjectSummary(projectId: string, summary: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const trimmed = summary.trim() || null;
  const { error } = await admin.from('projects').update({ summary: trimmed }).eq('id', projectId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project',
    entity_id: projectId,
    actor: user.email ?? user.id,
    action: 'set_summary',
    after: { summary: trimmed },
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true };
}

export async function addWorkstream(projectId: string, name: string, phaseKey: PhaseKey) {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return { error: 'missing name' };
  if (!VALID_PHASES.includes(phaseKey)) return { error: 'invalid phase' };
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('workstreams')
    .insert({ project_id: projectId, name: trimmed, phase_key: phaseKey, status: 'active' })
    .select('id')
    .single();
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'workstream',
    entity_id: data.id,
    actor: user.email ?? user.id,
    action: 'create',
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true };
}

// Dor: "2 or 3 smart iterations" — runs the iterative phase-inference agent
// and proposes through the inbox (never writes current_phase_key directly).
export async function inferPhases(projectId: string) {
  await requireUser();
  const admin = supabaseAdmin();

  const { data: pending } = await admin
    .from('agent_proposals')
    .select('id')
    .eq('project_id', projectId)
    .eq('type', 'phase_set')
    .eq('state', 'pending')
    .maybeSingle();
  if (pending) return { error: 'inference already pending review' };

  const result = await inferProjectPhase(admin, projectId);
  if ('skipped' in result) return { error: result.skipped };

  const { data: project } = await admin.from('projects').select('current_phase_key').eq('id', projectId).maybeSingle();
  if (project?.current_phase_key === result.phase_key) {
    return { ok: true, proposed: null };
  }

  const { error } = await admin.from('agent_proposals').insert({
    type: 'phase_set',
    project_id: projectId,
    payload: { phase_key: result.phase_key, evidence: result.evidence },
    confidence: result.confidence,
    reasoning: 'phase inference (iterative)',
    state: 'pending',
  });
  if (error) return { error: error.message };

  revalidatePath('/inbox');
  revalidatePath('/projects/' + projectId);
  return { ok: true, proposed: result.phase_key };
}
