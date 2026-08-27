// Q12 (Noa, 2026-08-27): projects are presented "לפי הקצב המתקדם ביותר של
// הפרויקט בשלבי הפרויקט — כרגע הכי קרוב ל-RTI", i.e. ordered by real progress
// through the phase pipeline toward Permit Ready-to-Issue, not by a fixed
// hand-ranked list. Pure and unit-tested; pages feed it the same phases/
// templates/instances they already fetch.

import type { Phase, PhaseKey, Project, ProjectSubstage, SubstageTemplate } from './types.ts';

/** Statuses that count as actual motion inside a phase — the sub-stage was
 *  genuinely reached (even if currently stuck). `upcoming` is "nothing
 *  decided", `waiting` is "activated but not started", `not_applicable` is
 *  an opt-out — none prove progress, and QA test-flips tend to leave exactly
 *  those behind. */
const MOVING: ProjectSubstage['status'][] = ['active', 'submitted', 'with_city', 'verify', 'blocked', 'done'];

export function rtiProgressScore(
  project: Pick<Project, 'current_phase_key'>,
  projectInstances: ProjectSubstage[],
  templatesById: Map<string, SubstageTemplate>,
  phasePositionByKey: Map<PhaseKey, number>,
): number {
  const phasePos = project.current_phase_key
    ? (phasePositionByKey.get(project.current_phase_key) ?? 0)
    : 0;
  // Furthest moving sub-stage inside the CURRENT phase only — a stray
  // instance from another phase (test residue, an early look-ahead) must not
  // teleport the project forward.
  let inPhase = 0;
  for (const inst of projectInstances) {
    if (!MOVING.includes(inst.status)) continue;
    const tpl = templatesById.get(inst.substage_template_id);
    if (!tpl || tpl.phase_key !== project.current_phase_key) continue;
    if (tpl.position > inPhase) inPhase = tpl.position;
  }
  return phasePos * 1000 + inPhase * 10;
}

/** Most-advanced first. Ties break by business_rank (asc, nulls last), then
 *  name — so two projects at the same pipeline point keep Noa's business
 *  ordering between them. */
export function orderProjectsByRtiProgress<P extends Pick<Project, 'id' | 'name' | 'current_phase_key' | 'business_rank'>>(
  projects: P[],
  phases: Pick<Phase, 'key' | 'position'>[],
  templates: SubstageTemplate[],
  instances: ProjectSubstage[],
): P[] {
  const phasePositionByKey = new Map(phases.map((p) => [p.key, p.position]));
  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const byProject = new Map<string, ProjectSubstage[]>();
  for (const inst of instances) {
    byProject.set(inst.project_id, [...(byProject.get(inst.project_id) ?? []), inst]);
  }
  const score = new Map(projects.map((p) => [
    p.id,
    rtiProgressScore(p, byProject.get(p.id) ?? [], templatesById, phasePositionByKey),
  ]));
  return [...projects].sort((a, b) =>
    (score.get(b.id)! - score.get(a.id)!) ||
    ((a.business_rank ?? Number.MAX_SAFE_INTEGER) - (b.business_rank ?? Number.MAX_SAFE_INTEGER)) ||
    a.name.localeCompare(b.name),
  );
}
