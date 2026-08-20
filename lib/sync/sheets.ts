import type { SupabaseClient } from '@supabase/supabase-js';
import { SignJWT, importPKCS8 } from 'jose';

// Google Sheets sync (Gantt + budget live in Sheets — client item 10).
// Service-account JWT flow; sheet ids live in settings key "sheet_ids":
// { "gantt": {"id": "...", "range": "A1:E200"}, "budget": {"id": "...", "range": "A1:F300"} }
// Gantt rows: [project, step, date, source?] -> project_events (kind=forecast, src=sheets).
// Budget rows are snapshotted into settings "budget_snapshot" for the dashboard.

export function isConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY);
}

async function accessToken(): Promise<string> {
  const pk = await importPKCS8(process.env.GOOGLE_SA_KEY!.replace(/\n/g, '\n'), 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(process.env.GOOGLE_SA_EMAIL!)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`sheets token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function readRange(token: string, sheetId: string, range: string): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`sheets read ${sheetId}: ${res.status}`);
  return ((await res.json()) as { values?: string[][] }).values ?? [];
}

interface SheetRef { id: string; range: string }

export async function run(admin: SupabaseClient): Promise<{ processed: number } | { skipped: string }> {
  if (!isConfigured()) return { skipped: 'not_configured' };
  const { data: setting } = await admin.from('settings').select('value').eq('key', 'sheet_ids').maybeSingle();
  const refs = (setting?.value ?? {}) as { gantt?: SheetRef; budget?: SheetRef };
  if (!refs.gantt && !refs.budget) return { skipped: 'no_sheet_ids' };

  const token = await accessToken();
  let processed = 0;

  const { data: projects } = await admin.from('projects').select('id,name');
  const byName = new Map((projects ?? []).map((p: { id: string; name: string }) => [p.name.toLowerCase(), p.id]));

  if (refs.gantt) {
    const rows = await readRange(token, refs.gantt.id, refs.gantt.range || 'A1:E200');
    await admin.from('project_events').delete().eq('src', 'sheets');
    for (const row of rows.slice(1)) {
      const [projectName, step, date] = row;
      if (!projectName || !step) continue;
      const pid = [...byName.entries()].find(([n]) => projectName.toLowerCase().includes(n) || n.includes(projectName.toLowerCase()))?.[1];
      if (!pid) continue;
      await admin.from('project_events').insert({
        project_id: pid, kind: 'forecast', step, event_date: date ?? null, src: 'sheets',
      });
      processed++;
    }
  }

  if (refs.budget) {
    const rows = await readRange(token, refs.budget.id, refs.budget.range || 'A1:F300');
    await admin.from('settings').upsert({
      key: 'budget_snapshot',
      value: { rows, synced_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    processed += rows.length;
  }

  await admin.from('settings').upsert({
    key: 'sheets_last_result',
    value: { processed, at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
  return { processed };
}
