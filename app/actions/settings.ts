'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { parseRecordImport, applyImport } from '@/lib/import/requirements';
import * as zimas from '@/lib/sync/zimas';

// Item: requirement lists load from file, never hardcoded. Same code path as seed.
export async function importRequirements(formData: FormData) {
  await requireUser();
  const projectName = String(formData.get('project') ?? '').trim();
  const raw = String(formData.get('json') ?? '');
  if (!projectName || !raw) return { error: 'missing fields' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: 'invalid JSON' };
  }
  try {
    const result = parseRecordImport(json);
    const summary = await applyImport(supabaseAdmin(), projectName, result);
    revalidatePath('/');
    return { ok: true, ...summary, project: projectName };
  } catch (e) {
    return { error: String(e) };
  }
}

export async function saveStageOverride(formData: FormData) {
  await requireUser();
  const admin = supabaseAdmin();
  const projectId = String(formData.get('project_id') ?? '');
  const stageKey = String(formData.get('stage_key') ?? '');
  const substage = String(formData.get('substage') ?? '').trim() || null;
  if (!projectId || !stageKey) return { error: 'missing fields' };

  // Demote the previous current stage, promote the chosen one as confirmed.
  await admin.from('project_stages')
    .update({ status: 'upcoming', confirmed: false, substage: null })
    .eq('project_id', projectId).eq('status', 'current');
  await admin.from('project_stages')
    .update({ status: 'current', confirmed: true, substage })
    .eq('project_id', projectId).eq('stage_key', stageKey);
  revalidatePath('/');
  revalidatePath('/settings');
  return { ok: true };
}

export async function saveSheetIds(formData: FormData) {
  await requireUser();
  const admin = supabaseAdmin();
  const value = {
    gantt: { id: String(formData.get('gantt_id') ?? '').trim(), range: String(formData.get('gantt_range') ?? 'A1:E200').trim() },
    budget: { id: String(formData.get('budget_id') ?? '').trim(), range: String(formData.get('budget_range') ?? 'A1:F300').trim() },
  };
  await admin.from('settings').upsert({ key: 'sheet_ids', value, updated_at: new Date().toISOString() });
  revalidatePath('/settings');
  return { ok: true };
}

export async function runZimasNow() {
  await requireUser();
  const result = await zimas.run(supabaseAdmin());
  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true, processed: result.processed };
}
