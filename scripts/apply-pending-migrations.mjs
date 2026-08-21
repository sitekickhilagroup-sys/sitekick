// scripts/apply-pending-migrations.mjs — apply every not-yet-applied file in
// supabase/migrations/, in name order, via the Supabase Management API.
// Applied names are tracked in a `schema_migrations` ledger table so pushes
// to main (CI: .github/workflows/migrate.yml) only run what's new.
// Local usage: node scripts/apply-pending-migrations.mjs  (reads .env.local)
// CI usage:    SUPABASE_TOKEN + SUPABASE_PROJECT_REF env vars.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

if (!process.env.SUPABASE_TOKEN && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const token = process.env.SUPABASE_TOKEN;
const ref =
  process.env.SUPABASE_PROJECT_REF ??
  (process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
    : null);
if (!token || !ref) {
  console.error('missing SUPABASE_TOKEN / SUPABASE_PROJECT_REF');
  process.exit(1);
}

async function run(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// Ledger + baseline. 0001-0007 were applied by hand before this runner
// existed, and the early ones are NOT idempotent (0001 creates tables,
// 0003 seeds data) — so they are marked applied without being run. RLS on
// with no policies: the Management API (superuser) still works; the ledger
// is simply not exposed through PostgREST.
await run(`
  create table if not exists schema_migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  );
  alter table schema_migrations enable row level security;
  insert into schema_migrations (name) values
    ('0001_init.sql'),
    ('0002_proposals_activity.sql'),
    ('0003_process_model.sql'),
    ('0003b_phase_set_enum.sql'),
    ('0003c_soils_survey_map.sql'),
    ('0004_relationships.sql'),
    ('0004b_relationship_enum.sql'),
    ('0005_weekly_review.sql'),
    ('0006_narratives.sql'),
    ('0007_alignment.sql')
  on conflict (name) do nothing;
`);

const applied = new Set(((await run('select name from schema_migrations;')) ?? []).map((r) => r.name));
const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  console.log('applying', file);
  await run(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  await run(`insert into schema_migrations (name) values ('${file}') on conflict (name) do nothing;`);
  ran++;
}
console.log(ran ? `applied ${ran} migration(s)` : 'up to date');
