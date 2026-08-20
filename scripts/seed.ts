/**
 * Seed Supabase from supabase/seed/data.json (client-validated dashboard data).
 * Usage: node --experimental-strip-types scripts/seed.ts [--dry-run]
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (reads .env.local/.env).
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseRecordImport, applyImport, stagePosition, stageLabel } from '../lib/import/requirements.ts';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const DRY = process.argv.includes('--dry-run');

function parseWhen(s: string | undefined | null): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/); // "25.08" | "25.08.26"
  if (dm) {
    const yy = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : '2026';
    return `${yy}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  }
  return null;
}

function invoiceStatus(inv: { status?: string; approval?: number }): string {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'appr') return 'approved';
  return inv.approval === 2 ? 'for_rowan_approval' : 'received';
}

function parseContact(c: string | undefined) {
  const parts = (c ?? '').split('·').map((s) => s.trim());
  const email = parts.find((p) => p.includes('@')) ?? null;
  const phone = parts.find((p) => /\d{3}[-.\s]?\d{3,4}/.test(p) && !p.includes('@')) ?? null;
  return { contact_name: parts[0] || null, email, phone };
}

async function main() {
  loadEnv();
  const data = JSON.parse(readFileSync('supabase/seed/data.json', 'utf8'));
  const catalog = JSON.parse(readFileSync('supabase/seed/substage-catalog.json', 'utf8'));

  const counts = {
    projects: data.projects.length,
    tasks: data.tasks.length,
    blockers: data.blockers.length,
    invoices: data.invoices.length,
    decisions: (data.decisions ?? []).length,
    vendors: (data.directory ?? []).length,
  };
  console.log('Seed input:', JSON.stringify(counts));
  if (DRY) return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // substage catalog — replace wholesale
  await admin.from('substage_catalog').delete().neq('stage_key', '');
  for (const [stage_key, names] of Object.entries(catalog) as [string, string[]][]) {
    await admin.from('substage_catalog').insert(names.map((name, i) => ({ stage_key, position: i, name })));
  }

  const projectIds = new Map<string, string>();
  for (const p of data.projects) {
    const st = p.stages ?? {};
    const row = {
      name: p.name,
      address: p.address ?? null,
      llc: p.llc ?? null,
      city_case: st.city_case ?? null,
      city_on_hold: !!st.city_on_hold,
      city_flag: st.city_flag ?? null,
    };
    const { data: up, error } = await admin.from('projects').upsert(row, { onConflict: 'name' }).select('id').single();
    if (error || !up) throw new Error(`project ${p.name}: ${error?.message}`);
    projectIds.set(p.name, up.id);

    // stage rows: union of done[] + current + record keys
    const done: string[] = st.done ?? [];
    const recordStages: string[] = Object.keys(st.record?.stages ?? {});
    const alsoActive: string[] = st.record?.also_active ?? [];
    const keys = [...new Set([...done, st.current, ...recordStages].filter(Boolean))] as string[];
    for (const key of keys) {
      const status = done.includes(key) ? 'done' : key === st.current ? 'current' : 'upcoming';
      const stageRow = {
        project_id: up.id,
        stage_key: key,
        label: stageLabel(key),
        position: stagePosition(key),
        status,
        also_active: alsoActive.includes(key),
        substage: key === st.current ? (st.substage ?? null) : null,
        risk: st.risk === key,
        slip_days: st.risk === key ? (st.slip ?? 0) : 0,
        confirmed: key === st.current ? !!st.confirmed : false,
      };
      const { error: sErr } = await admin.from('project_stages').upsert(stageRow, { onConflict: 'project_id,stage_key' });
      if (sErr) throw new Error(`stage ${p.name}/${key}: ${sErr.message}`);
    }

    if (st.record) {
      const result = parseRecordImport(st.record);
      await applyImport(admin as never, p.name, result);
    }

    // timeline events — replace per project
    await admin.from('project_events').delete().eq('project_id', up.id);
    const evs = [
      ...(st.history ?? []).map((h: { step: string; when?: string; src?: string }) => ({
        kind: 'history', step: h.step, event_date: h.when ?? null, src: h.src ?? null,
      })),
      ...(st.forecast ?? []).map((f: { step: string; when?: string; source?: string; note?: string }) => ({
        kind: 'forecast', step: f.step, event_date: f.when ?? null, src: f.source ?? f.note ?? null,
      })),
    ];
    if (evs.length) await admin.from('project_events').insert(evs.map((e) => ({ ...e, project_id: up.id })));

    // next_steps -> tasks (deduped by source marker)
    for (const [i, ns] of (st.next_steps ?? []).entries()) {
      const source = `next_steps:${p.name}:${i}`;
      const { data: exists } = await admin.from('tasks').select('id').eq('source', source).maybeSingle();
      if (exists) continue;
      await admin.from('tasks').insert({
        project_id: up.id,
        title: ns.what,
        description: ns.evidence ?? null,
        owner: ns.by ?? null,
        waiting_for: ns.status === 'waiting' ? (ns.by ?? 'pending') : null,
        due: parseWhen(ns.when),
        stage_key: st.current ?? null,
        priority: ns.critical ? 'critical' : 'normal',
        status: ns.status === 'done' ? 'done' : 'open',
        planned: true,
        source,
      });
    }
  }

  // vendors (directory)
  const vendorIds = new Map<string, string>();
  for (const v of data.directory ?? []) {
    const c = parseContact(v.contact);
    const { data: up, error } = await admin.from('vendors').upsert({
      name: v.name,
      discipline: v.role ?? null,
      status: Array.isArray(v.status) ? v.status[0] : (v.status ?? 'active'),
      hue: v.hue ?? null,
      notes: v.projects ?? null,
      ...c,
    }, { onConflict: 'name' }).select('id').single();
    if (error || !up) throw new Error(`vendor ${v.name}: ${error?.message}`);
    vendorIds.set(v.name, up.id);
  }

  // tracker tasks (deduped by source marker)
  let taskOk = 0;
  for (const t of data.tasks) {
    const pid = t.project === 'All' ? null : projectIds.get(t.project);
    if (pid === undefined) continue;
    const source = t.id ? `tracker:${t.id}` : (t.source ?? null);
    if (source) {
      let q = admin.from('tasks').select('id').eq('source', source);
      q = pid === null ? q.is('project_id', null) : q.eq('project_id', pid);
      const { data: exists } = await q.maybeSingle();
      if (exists) continue;
    }
    const { error } = await admin.from('tasks').insert({
      project_id: pid,
      title: t.title,
      description: t.description ?? t.source ?? null,
      owner: t.owner ?? null,
      waiting_for: t.waiting_for ?? null,
      due: t.due || null,
      stage_key: t.stage ?? null,
      priority: ['critical', 'high', 'normal'].includes(t.priority) ? t.priority : 'normal',
      status: 'open',
      planned: t.planned !== false,
      source,
      admin: !!t.admin,
      last_touched: t.last_touched || undefined,
    });
    if (!error) taskOk++;
  }

  // blockers — replace wholesale (idempotent seed)
  await admin.from('blockers').delete().neq('what', '');
  for (const b of data.blockers) {
    const pid = projectIds.get(b.project);
    if (!pid) continue;
    await admin.from('blockers').insert({
      project_id: pid,
      what: b.what,
      blocked_by: b.blocked_by,
      days_at_risk: b.days_at_risk ?? 0,
      days_stuck: b.days_stuck ?? 0,
      downstream: b.downstream ?? [],
      suggested_action: b.suggested ?? null,
      status: 'active',
    });
    if (b.draft) {
      await admin.from('drafts').insert({
        subject: `Re: ${String(b.what).slice(0, 80)}`,
        body: b.draft,
        status: 'proposed',
      });
    }
  }

  // decisions — "why" carries "<project> - <who>"
  await admin.from('decisions').delete().neq('title', '');
  for (const d of data.decisions ?? []) {
    const projName = [...projectIds.keys()].find((n) => (d.why ?? '').includes(n));
    await admin.from('decisions').insert({
      project_id: projName ? (projectIds.get(projName) ?? null) : null,
      title: d.t,
      detail: d.why ?? null,
    });
  }

  // invoices
  let invOk = 0;
  for (const inv of data.invoices) {
    const pid = inv.project === 'All' ? null : projectIds.get(inv.project);
    if (pid === undefined) continue;
    let vid = vendorIds.get(inv.vendor) ?? null;
    if (!vid && inv.vendor) {
      const { data: v } = await admin.from('vendors').upsert({ name: inv.vendor }, { onConflict: 'name' }).select('id').single();
      vid = v?.id ?? null;
      if (vid) vendorIds.set(inv.vendor, vid);
    }
    const { error } = await admin.from('invoices').upsert({
      project_id: pid,
      vendor_id: vid,
      number: inv.number ?? null,
      amount_usd: inv.amount ?? 0,
      due: inv.due || null,
      status: invoiceStatus(inv),
      tab: 'invoices',
      entity: inv.llc ?? null,
    }, { onConflict: 'vendor_id,number' });
    if (!error) invOk++;
  }

  console.log(`Seeded. tasks inserted: ${taskOk}, invoices upserted: ${invOk}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
