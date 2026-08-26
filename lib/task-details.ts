// Pure write-shaping + validation for the task-details editor (A6). Kept out
// of app/actions/tasks.ts (a 'use server' file, which can only export async
// functions) so this logic is unit-testable without a database or an
// authenticated request — same reason lib/work-verbs.ts exists.

import type { PhaseKey, Task } from './types';

// stage_key is deliberately NOT one of these. tasks.stage_key is the LEGACY
// stage tag bridged to canonical phases via stage_phase_map
// (0003_process_model.sql:77-109) — its seeded domain is things like
// 'b_permit'/'grading'/'entitlements', never a phase_key. Writing a phase_key
// into it corrupts every other reader of that column: the current-stage bonus
// in lib/priority.ts, the different-stage penalty in lib/dedup.ts, the
// stageLabels lookup in lib/weekly.ts, and the phase bucketing in
// lib/process.ts. A task's phase is owned implicitly through
// substage_template_id instead — see resolveTaskPhaseKey below.
export const DETAIL_KEYS = ['owner', 'waiting_for', 'due', 'project_id',
  'substage_template_id', 'workstream_id', 'process_impact'] as const;

export interface TaskDetailsPatch {
  owner?: string | null; waiting_for?: string | null; due?: string | null;
  project_id?: string | null;
  substage_template_id?: string | null; workstream_id?: string | null;
  process_impact?: Task['process_impact'];
}

// Mirrors the ProcessImpact union in ./types. Kept as its own runtime array
// here — rather than imported — because ./types has no runtime exports, and
// app/actions/tasks.ts's own copy (for the pre-existing setProcessImpact)
// lives in a 'use server' file that can't export a plain const for this
// module (or task-editor.tsx's <select>) to share.
const PROCESS_IMPACTS: NonNullable<Task['process_impact']>[] = [
  'primary_blocker', 'workstream_blocker', 'future_gate',
  'external_gate', 'not_blocking', 'verify',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whitelists a submitted patch down to exactly the columns updateTaskDetails
 * is allowed to write, null-coalescing each present key, then checks the
 * shape-only rules (date format, impact enum, non-empty). Doesn't touch the
 * database — FK existence and cross-field consistency are
 * validateDetailsIntegrity's job, since those need rows the caller has to
 * fetch first.
 */
export function buildDetailsPatch(patch: TaskDetailsPatch): { clean: Record<string, unknown> } | { error: string } {
  const clean: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) if (k in patch) clean[k] = (patch as Record<string, unknown>)[k] ?? null;
  if (clean.due != null && !DATE_RE.test(String(clean.due))) return { error: 'invalid date' };
  if (clean.process_impact != null && !PROCESS_IMPACTS.includes(clean.process_impact as NonNullable<Task['process_impact']>)) {
    return { error: 'invalid impact' };
  }
  if (Object.keys(clean).length === 0) return { error: 'empty patch' };
  return { clean };
}

/**
 * Cross-field integrity for the row that results after this patch applies —
 * not just the keys the patch touches. A field the caller left out can still
 * end up inconsistent with one it did change (project_id changes, an old
 * workstream_id from the previous project silently stays), so the caller
 * resolves "effective" values (the patch's value if present, else the row's
 * current value) and pre-fetches the workstream/sub-stage-template rows.
 * Stays pure — testable with plain objects — because the server action is
 * the only place allowed to do the fetching; this is not something the
 * client can be trusted to enforce on its own.
 */
export function validateDetailsIntegrity(
  clean: Record<string, unknown>,
  ctx: {
    effectiveProjectId: string | null;
    /** Row for the effective workstream_id, when it resolves non-null. */
    workstream: { project_id: string; phase_key: string } | null;
    /** Row for the effective substage_template_id, when it resolves non-null. */
    substageTemplate: { phase_key: string } | null;
  },
): { error: string } | null {
  if (ctx.workstream && ctx.workstream.project_id !== ctx.effectiveProjectId) {
    return { error: 'workstream does not belong to this project' };
  }
  if (ctx.workstream && ctx.substageTemplate && ctx.workstream.phase_key !== ctx.substageTemplate.phase_key) {
    return { error: 'workstream and sub-stage are in different phases' };
  }
  return null;
}

/**
 * A task's phase, derived rather than stored — 0015 gave tasks a real,
 * task-owned signal (substage_template_id) instead of a phase column, so
 * nothing on `tasks` was ever "the" phase; phaseLabelFor has always derived
 * it. Precedence: an explicit sub-stage's own phase wins; the legacy
 * stage_key -> stage_phase_map bridge is next; the project's current phase is
 * the last resort. All three inputs are pre-resolved lookups (map gets, not
 * queries), so this has no I/O of its own — callers differ in which inputs
 * they have: the server's display-side phaseLabelFor supplies all three, the
 * editor's own initial-phase guess (client-side, no access to
 * stage_phase_map) only ever supplies substagePhaseKey/projectPhaseKey and
 * leaves legacyPhaseKey undefined.
 */
export function resolveTaskPhaseKey(input: {
  substagePhaseKey?: PhaseKey | null;
  legacyPhaseKey?: PhaseKey | null;
  projectPhaseKey?: PhaseKey | null;
}): PhaseKey | null {
  return input.substagePhaseKey ?? input.legacyPhaseKey ?? input.projectPhaseKey ?? null;
}

/**
 * A task's displayed sub-stage line — the same derive-don't-store rule as
 * resolveTaskPhaseKey, one column over. My Work's row used to read this off
 * `stage_key` alone, so re-classifying a task's Sub-stage within the same
 * phase (A6's editor) changed nothing a user could see: the linked template's
 * own name now wins, and the legacy tag is only ever the fallback for a task
 * that predates the 0015 backfill and carries no substage_template_id yet.
 */
export function resolveTaskSubstageLabel(input: {
  substageName?: string | null;
  legacyLabel?: string | null;
}): string | null {
  return input.substageName ?? input.legacyLabel ?? null;
}
