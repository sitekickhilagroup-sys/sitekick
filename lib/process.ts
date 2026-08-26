import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveTaskPhaseKey } from './task-details.ts';
import type { Phase, PhaseKey, Project, ProjectSubstage, ProjectSubstageStatus, SubstageTemplate, Task, Workstream } from './types.ts';

export interface PhaseView {
  phase: Phase;
  /** `activated` is false when this project has no instance for the template:
   *  nothing has been decided about the stage, which is not the same as it
   *  being planned and upcoming. */
  substages: { template: SubstageTemplate; instance: ProjectSubstage | null; activated: boolean }[];
  workstreams: Workstream[];
}

export function groupProcess(input: {
  phases: Phase[]; templates: SubstageTemplate[]; instances: ProjectSubstage[]; workstreams: Workstream[];
}): PhaseView[] {
  const byTemplate = new Map(input.instances.map((i) => [i.substage_template_id, i]));
  return [...input.phases]
    .sort((a, b) => a.position - b.position)
    .map((phase) => ({
      phase,
      substages: input.templates
        .filter((tp) => tp.phase_key === phase.key)
        .sort((a, b) => a.position - b.position)
        .map((template) => {
          const instance = byTemplate.get(template.id) ?? null;
          // A template with no instance is not "Upcoming" — nothing has been
          // decided about it for this project. The spec forbids presenting
          // every possible stage as planned ("that creates false certainty"),
          // so the view renders these as not activated instead.
          return { template, instance, activated: !!instance };
        })
        .filter((s) => s.template.kind === 'standard' || (s.instance && s.instance.status !== 'upcoming')),
      workstreams: input.workstreams.filter((w) => w.phase_key === phase.key),
    }));
}

// True complement of groupProcess's substages visibility test: a conditional
// template is "unactivated" when !instance || instance.status === 'upcoming'
// — exactly what groupProcess's filter (kind === 'standard' || (instance &&
// instance.status !== 'upcoming')) excludes. Without this, a conditional
// template whose instance got set back to 'upcoming' (Task 3's
// setSubstageStatus allows that status in its union) would vanish from both
// substages AND this list — invisible, unrecoverable from the UI. Grouped by
// phase — feeds Task 4's "Activate sub-stage" disclosure per phase column.
// Pure + exported so it's unit-testable on its own; getProjectProcess below
// computes it from the same fetched templates/instances and assigns the
// result straight to unactivatedByPhase.
export function unactivatedConditionals(
  templates: SubstageTemplate[],
  instances: ProjectSubstage[],
): Map<PhaseKey, SubstageTemplate[]> {
  const byTemplate = new Map(instances.map((i) => [i.substage_template_id, i]));
  const byPhase = new Map<PhaseKey, SubstageTemplate[]>();
  for (const tp of [...templates].sort((a, b) => a.position - b.position)) {
    const instance = byTemplate.get(tp.id);
    if (tp.kind !== 'conditional' || (instance && instance.status !== 'upcoming')) continue;
    byPhase.set(tp.phase_key, [...(byPhase.get(tp.phase_key) ?? []), tp]);
  }
  return byPhase;
}

// C3: which columns undoSubstageChange writes back, given the full
// project_substages row snapshotted as `before_json` before setSubstageStatus
// ran. Kept pure and separate from the server action (same reason
// lib/work-verbs.ts exists) so the restore set is unit-testable without a
// database.
//
// setSubstageStatus only ever writes `status` and `completed_at` — always
// together, since completed_at is derived from status in that same update
// (laToday() when status becomes 'done', null otherwise). Restoring `status`
// alone would leave completed_at out of sync with the status undo just put
// back (e.g. status reverts to 'done' but completed_at stays null, or status
// leaves 'done' but completed_at keeps a stale date), so both travel
// together. `note` is included too, mirroring undoWorkVerb's own restore set
// being slightly wider than any single action's write: setSubstageStatus
// never touches note, so restoring it is a no-op for the direct
// flip-then-undo sequence, but it keeps this restore aligned with the full
// row shape the way undoWorkVerb's does. Deliberately NOT included: decision,
// workstream_id, activated_at, substage_template_id, project_id — no action
// in this round writes those, and undoWorkVerb's stage_key precedent is to
// leave out columns nothing here changes rather than let an unrelated undo
// overwrite them.
export function substageUndoRestore(before: Record<string, unknown>): {
  status: ProjectSubstageStatus; completed_at: string | null; note: string | null;
} {
  return {
    status: (before.status as ProjectSubstageStatus | undefined) ?? 'upcoming',
    completed_at: (before.completed_at as string | null | undefined) ?? null,
    note: (before.note as string | null | undefined) ?? null,
  };
}

// Review round 2 (C2 ruling): tasks used to be bucketed into a phase by
// stage_key -> stage_phase_map alone, falling back to the project's current
// phase — the same gap A6 already fixed for My Work's phaseLabelFor, just
// not here yet. Once C2 scoped each sub-stage's "Connected actions" panel to
// tasks whose substage_template_id actually equals that template's id, the
// gap turned load-bearing: a task whose ONLY phase signal was its linked
// sub-stage template (no stage_key, project since moved to a different
// current phase) could be bucketed under the wrong phase's tasks entirely —
// or, worse, disappear from every phase's panel, since it would fail the
// `mine` match everywhere its id doesn't equal AND fail the `phaseOnly` catch
// (not null) everywhere too. resolveTaskPhaseKey already settled this
// precedence for My Work (sub-stage's own phase wins, legacy tag next,
// project's current phase last) — reused here rather than re-decided, so the
// two pages can't drift apart on what "a task's phase" means.
//
// getProjectProcess itself can't be unit-tested (live supabase calls), so
// this grouping lives in a pure, exported, tested helper — getProjectProcess
// just assigns its result. Same reason groupProcess/unactivatedConditionals
// are split out above.
export function bucketTasksByPhase(
  tasks: Task[],
  templates: SubstageTemplate[],
  stageMap: { stage_key: string; phase_key: PhaseKey }[],
  projectPhaseKey: PhaseKey | null,
): { tasksByPhase: Map<PhaseKey, Task[]>; unmappedTasks: Task[] } {
  const phaseKeyByStage = new Map(stageMap.map((m) => [m.stage_key, m.phase_key]));
  const phaseKeyBySubstageId = new Map(templates.map((tp) => [tp.id, tp.phase_key]));
  const tasksByPhase = new Map<PhaseKey, Task[]>();
  const unmappedTasks: Task[] = [];
  for (const t of tasks) {
    const phase = resolveTaskPhaseKey({
      substagePhaseKey: t.substage_template_id ? phaseKeyBySubstageId.get(t.substage_template_id) ?? null : null,
      legacyPhaseKey: t.stage_key ? phaseKeyByStage.get(t.stage_key) ?? null : null,
      projectPhaseKey,
    });
    if (!phase) { unmappedTasks.push(t); continue; }
    tasksByPhase.set(phase, [...(tasksByPhase.get(phase) ?? []), t]);
  }
  return { tasksByPhase, unmappedTasks };
}

// C2: SubstageDetail's "Connected actions" selection — which of a phase's
// tasks belong to THIS sub-stage (`mine`, capped at 4 for `shown`), and the
// phase-level fallback (`phaseOnly`) rendered in `mine`'s place until a task
// actually carries a substage_template_id (pre-A6/B1-backfill, that's most
// of them — without this fallback the panel would go empty for every
// project). Generic over the minimal shape so process-explorer.tsx's
// client-only ExplorerTask never has to be imported into this file.
export function selectConnectedTasks<T extends { substage_template_id: string | null }>(
  tasks: T[],
  substageTemplateId: string,
): { mine: T[]; phaseOnly: T[]; shown: T[] } {
  const mine = tasks.filter((t) => t.substage_template_id === substageTemplateId);
  const phaseOnly = tasks.filter((t) => !t.substage_template_id);
  return { mine, phaseOnly, shown: mine.slice(0, 4) };
}

export async function getProjectProcess(supabase: SupabaseClient, projectId: string) {
  const [projectQ, phasesQ, templatesQ, instancesQ, workstreamsQ, tasksQ, mapQ] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).single(),
    supabase.from('phases').select('*'),
    supabase.from('substage_templates').select('*'),
    supabase.from('project_substages').select('*').eq('project_id', projectId),
    supabase.from('workstreams').select('*').eq('project_id', projectId),
    supabase.from('tasks').select('*').eq('project_id', projectId).eq('status', 'open').order('created_at'),
    supabase.from('stage_phase_map').select('*'),
  ]);
  const project = projectQ.data as Project;
  const templates = (templatesQ.data ?? []) as SubstageTemplate[];
  const instances = (instancesQ.data ?? []) as ProjectSubstage[];
  const phaseViews = groupProcess({
    phases: (phasesQ.data ?? []) as Phase[],
    templates,
    instances,
    workstreams: (workstreamsQ.data ?? []) as Workstream[],
  });
  const unactivatedByPhase = unactivatedConditionals(templates, instances);
  const stageMap = (mapQ.data ?? []) as { stage_key: string; phase_key: PhaseKey }[];
  const { tasksByPhase, unmappedTasks } = bucketTasksByPhase(
    (tasksQ.data ?? []) as Task[], templates, stageMap, project.current_phase_key ?? null,
  );
  return { project, phaseViews, tasksByPhase, unmappedTasks, unactivatedByPhase };
}
