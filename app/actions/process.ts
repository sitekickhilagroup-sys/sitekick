'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { type PhaseKey, type ProjectSubstageStatus } from '@/lib/types';
import { logActivity } from '@/lib/state-writer';
import { computeSubstageMove, substageUndoRestore } from '@/lib/process';
import { inferProjectPhase } from '@/agents/infer-phase';
import type { ProjectSubstage, SubstageTemplate } from '@/lib/types';

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
  // Snapshot the full prior row first (mirrors applyWorkVerb) — the spec
  // counts a sub-stage change as material and requires every material change
  // to support undo, and undo restores from before_json.
  const { data: before } = await admin
    .from('project_substages').select('*').eq('id', projectSubstageId).maybeSingle();
  const { error } = await admin.from('project_substages').update({ status, completed_at }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  const undoId = await logActivity(admin, {
    entity_type: 'project_substage',
    entity_id: projectSubstageId,
    actor: user.email ?? user.id,
    action: `status:${status}`,
    before: before ?? undefined,
    after: { status, completed_at },
  });
  revalidatePath('/projects/' + projectId);
  revalidatePath('/');
  return { ok: true as const, undoId };
}

/** Restores the project_substages snapshot taken before setSubstageStatus ran. */
export async function undoSubstageChange(logId: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const { data } = await admin.from('activity_log').select('*').eq('id', logId).maybeSingle();
  const entry = data as { entity_type: string; entity_id: string; before_json: Record<string, unknown> | null } | null;
  if (!entry?.before_json || entry.entity_type !== 'project_substage') return { error: 'nothing to undo' };
  const restore = substageUndoRestore(entry.before_json);
  const { error } = await admin.from('project_substages').update(restore).eq('id', entry.entity_id);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage', entity_id: entry.entity_id, actor: user.email ?? user.id,
    action: 'undo', after: restore,
  });
  revalidatePath('/');
  revalidatePath('/projects/[id]', 'page');
  return { ok: true as const };
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

/** Noa request #2: one arrow press in the sub-stage list. The move itself is
 *  computed by computeSubstageMove (lib/process, tested) over the same
 *  visible list the explorer renders, so "up" is always one row up on
 *  screen; this action just loads the phase's entries and writes the one
 *  position it returns. */
export async function moveSubstage(projectId: string, projectSubstageId: string, dir: 'up' | 'down') {
  const user = await requireUser();
  if (dir !== 'up' && dir !== 'down') return { error: 'invalid direction' };
  const admin = supabaseAdmin();
  const { data: inst } = await admin
    .from('project_substages').select('*').eq('id', projectSubstageId).maybeSingle();
  const instance = inst as ProjectSubstage | null;
  if (!instance || instance.project_id !== projectId) return { error: 'not found' };
  const { data: tpl } = await admin
    .from('substage_templates').select('*').eq('id', instance.substage_template_id).maybeSingle();
  const template = tpl as SubstageTemplate | null;
  if (!template) return { error: 'not found' };
  const [templatesQ, instancesQ] = await Promise.all([
    admin.from('substage_templates').select('*').eq('phase_key', template.phase_key),
    admin.from('project_substages').select('*').eq('project_id', projectId),
  ]);
  const templates = (templatesQ.data ?? []) as SubstageTemplate[];
  const byTemplate = new Map(((instancesQ.data ?? []) as ProjectSubstage[]).map((i) => [i.substage_template_id, i]));
  const entries = templates.map((t) => ({ template: t, instance: byTemplate.get(t.id) ?? null }));
  const move = computeSubstageMove(entries, projectSubstageId, dir);
  if (!move) return { ok: true as const }; // already at the edge — nothing to write
  const { error } = await admin
    .from('project_substages').update({ position: move.newPosition }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage', entity_id: projectSubstageId, actor: user.email ?? user.id,
    action: 'reorder', before: { position: instance.position }, after: { position: move.newPosition },
  });
  revalidatePath('/projects/' + projectId);
  return { ok: true as const };
}

// Noa bug #5: the dependency line ("after X · parallel to Y") gets its own
// field instead of being buried inside the note.
export async function setSubstageDepends(projectId: string, projectSubstageId: string, dependsOn: string) {
  const user = await requireUser();
  const admin = supabaseAdmin();
  const trimmed = dependsOn.trim() || null;
  const { error } = await admin.from('project_substages').update({ depends_on: trimmed }).eq('id', projectSubstageId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project_substage', entity_id: projectSubstageId, actor: user.email ?? user.id,
    action: 'set_depends', after: { depends_on: trimmed },
  });
  revalidatePath('/projects/' + projectId);
  return { ok: true };
}

/** Noa bug #7: Bidding (or any phase) had no sub-stage bank to draw from.
 *  Adds a named sub-stage to the shared library as 'conditional' — it shows
 *  in every project's bank for that phase, not as an unactivated row — and
 *  activates it for the requesting project in the same breath, since adding
 *  it here means she needs it now. */
export async function addSubstageTemplate(projectId: string, phaseKey: PhaseKey, name: string) {
  const user = await requireUser();
  if (!VALID_PHASES.includes(phaseKey)) return { error: 'invalid phase' };
  const trimmed = name.trim();
  if (!trimmed) return { error: 'missing name' };
  const admin = supabaseAdmin();
  const { data: maxRow } = await admin
    .from('substage_templates').select('position').eq('phase_key', phaseKey)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  const position = ((maxRow as { position: number } | null)?.position ?? 0) + 1;
  // unique (phase_key, name) — a duplicate name surfaces as a save error
  // instead of a second identical library row.
  const { data, error } = await admin
    .from('substage_templates')
    .insert({ phase_key: phaseKey, name: trimmed, kind: 'conditional', position })
    .select('id').single();
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'substage_template', entity_id: data.id, actor: user.email ?? user.id,
    action: 'create', after: { phase_key: phaseKey, name: trimmed, position },
  });
  return activateSubstage(projectId, data.id, null);
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
  // Changing the current phase is the first item on the spec's material-change
  // list, so it has to be reversible — which means capturing the prior value.
  const { data: prior } = await admin
    .from('projects').select('current_phase_key').eq('id', projectId).maybeSingle();
  const { error } = await admin.from('projects').update({ current_phase_key: phaseKey }).eq('id', projectId);
  if (error) return { error: error.message };
  await logActivity(admin, {
    entity_type: 'project',
    entity_id: projectId,
    actor: user.email ?? user.id,
    action: 'set_phase',
    before: prior ?? undefined,
    after: { current_phase_key: phaseKey },
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
