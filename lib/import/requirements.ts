import type { SupabaseClient } from '@supabase/supabase-js';
import { RecordImportSchema, mapState, type RecordImport } from './schema.ts';
import type { ReqBasis, ReqState, ReqWho } from '../types.ts';

// Canonical display order for known stage keys (client-validated).
// Projects may use any subset plus unknown keys, which append after.
export const STAGE_ORDER = [
  'feasibility', 'entitlements', 'soils_survey', 'plan_check', 'rti', 'permits',
  'b_permit', 'haul_route', 'grading', 'foundation', 'framing', 'inspections', 'delivery',
];

const STAGE_LABELS: Record<string, string> = {
  feasibility: 'Feasibility',
  entitlements: 'Entitlements',
  soils_survey: 'Soils / Survey',
  plan_check: 'Plan Check',
  rti: 'RTI',
  permits: 'Permits',
  b_permit: 'B Permit',
  haul_route: 'Haul Route',
  grading: 'Grading',
  foundation: 'Foundation',
  framing: 'Framing',
  inspections: 'Inspections',
  delivery: 'Delivery',
};

export function stageLabel(key: string): string {
  return (
    STAGE_LABELS[key] ??
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function stagePosition(key: string): number {
  const i = STAGE_ORDER.indexOf(key);
  return i === -1 ? STAGE_ORDER.length + key.length : i;
}

export interface ImportRequirement {
  text: string;
  state: ReqState;
  who: ReqWho;
  basis: ReqBasis;
  evidence: string | null;
  note: string | null;
  src: string | null;
  position: number;
}

export interface ImportStage {
  stage_key: string;
  label: string;
  position: number;
  active: boolean;
  note: string | null;
  requirements: ImportRequirement[];
}

export interface ImportResult {
  currentStage: string;
  alsoActive: string[];
  note: string | null;
  stages: ImportStage[];
}

export function parseRecordImport(json: unknown): ImportResult {
  const rec: RecordImport = RecordImportSchema.parse(json);
  const stages: ImportStage[] = Object.entries(rec.stages).map(([key, s]) => ({
    stage_key: key,
    label: stageLabel(key),
    position: stagePosition(key),
    active: s.active ?? false,
    note: s.note ?? null,
    requirements: s.items.map((item, i) => ({
      text: item.r,
      state: mapState(item),
      who: item.who ?? 'us',
      basis: item.basis ?? 'standard',
      evidence: item.evidence || null,
      note: item.note || null,
      src: item.src || null,
      position: i,
    })),
  }));
  stages.sort((a, b) => a.position - b.position);
  return {
    currentStage: rec.stage,
    alsoActive: rec.also_active ?? [],
    note: rec.note ?? null,
    stages,
  };
}

// Upserts stage rows for a project and REPLACES their requirement lists.
// Existing stage rows keep their status/substage; new rows arrive as 'upcoming'.
// Same code path serves the seed and the Settings import UI.
export async function applyImport(
  admin: SupabaseClient,
  projectName: string,
  result: ImportResult,
): Promise<{ stages: number; requirements: number }> {
  const { data: project, error: pErr } = await admin
    .from('projects')
    .select('id')
    .eq('name', projectName)
    .single();
  if (pErr || !project) throw new Error(`Project not found: ${projectName}`);

  let reqCount = 0;
  for (const stage of result.stages) {
    const { data: existing } = await admin
      .from('project_stages')
      .select('id')
      .eq('project_id', project.id)
      .eq('stage_key', stage.stage_key)
      .maybeSingle();

    let stageId: string;
    if (existing) {
      stageId = existing.id;
      await admin
        .from('project_stages')
        .update({ also_active: stage.active, label: stage.label })
        .eq('id', stageId);
    } else {
      const { data: inserted, error } = await admin
        .from('project_stages')
        .insert({
          project_id: project.id,
          stage_key: stage.stage_key,
          label: stage.label,
          position: stage.position,
          status: 'upcoming',
          also_active: stage.active,
        })
        .select('id')
        .single();
      if (error || !inserted) throw new Error(`Stage insert failed: ${error?.message}`);
      stageId = inserted.id;
    }

    await admin.from('stage_requirements').delete().eq('project_stage_id', stageId);
    if (stage.requirements.length > 0) {
      const { error } = await admin.from('stage_requirements').insert(
        stage.requirements.map((r) => ({
          project_stage_id: stageId,
          text: r.text,
          state: r.state,
          who: r.who,
          basis: r.basis,
          evidence: r.evidence,
          note: r.note,
          src: r.src,
          position: r.position,
        })),
      );
      if (error) throw new Error(`Requirements insert failed: ${error.message}`);
      reqCount += stage.requirements.length;
    }
  }
  return { stages: result.stages.length, requirements: reqCount };
}
