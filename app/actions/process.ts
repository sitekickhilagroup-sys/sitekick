'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { type PhaseKey } from '@/lib/types';
import { logActivity } from '@/lib/state-writer';
import { inferProjectPhase } from '@/agents/infer-phase';

const VALID_PHASES: PhaseKey[] = ['planning', 'plan_check', 'bidding', 'financing', 'construction'];

export async function setSubstageStatus(
  projectId: string,
  projectSubstageId: string,
  status: 'upcoming' | 'active' | 'done' | 'not_applicable',
) {
  const user = await requireUser();
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
