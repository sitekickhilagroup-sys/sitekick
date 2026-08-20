import type { SupabaseClient } from '@supabase/supabase-js';

// ZIMAS / LA City Planning case status (client item 11).
// Best effort: the PDIS case-info endpoint serves JSON for a case number.
// Any failure is recorded in settings.zimas_last_result; manual override wins.

export function isConfigured(): boolean {
  return true; // no credentials needed
}

interface CaseResult { caseNumber: string; ok: boolean; status?: string; note?: string }

async function fetchCase(caseNumber: string): Promise<CaseResult> {
  const clean = caseNumber.split(/[\s(]/)[0].trim(); // "ZA-2023-3802-ZAD" from decorated strings
  try {
    const res = await fetch(
      `https://planning.lacity.org/pdiscaseinfo/api/Service/GetCaseInfoByCaseNumber?caseNumber=${encodeURIComponent(clean)}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return { caseNumber: clean, ok: false, note: `http ${res.status}` };
    const json = (await res.json()) as Record<string, unknown>;
    const status = (json.caseStatus ?? json.status ?? json.CaseStatus) as string | undefined;
    return { caseNumber: clean, ok: true, status, note: undefined };
  } catch (e) {
    return { caseNumber: clean, ok: false, note: String(e).slice(0, 200) };
  }
}

export async function run(admin: SupabaseClient): Promise<{ processed: number; results: CaseResult[] }> {
  const { data: projects } = await admin
    .from('projects')
    .select('id,name,city_case')
    .not('city_case', 'is', null);

  const results: CaseResult[] = [];
  for (const p of projects ?? []) {
    if (!p.city_case) continue;
    const result = await fetchCase(p.city_case);
    results.push(result);
    if (result.ok && result.status) {
      const holdWords = /on hold|hold letter|suspended/i;
      await admin.from('project_events').insert({
        project_id: p.id, kind: 'history',
        step: `ZIMAS status: ${result.status}`,
        event_date: new Date().toISOString().slice(0, 10),
        src: 'zimas',
      });
      if (holdWords.test(result.status)) {
        await admin.from('projects').update({ city_on_hold: true }).eq('id', p.id);
      }
    }
  }

  await admin.from('settings').upsert({
    key: 'zimas_last_result',
    value: { results, at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
  return { processed: results.filter((r) => r.ok).length, results };
}
