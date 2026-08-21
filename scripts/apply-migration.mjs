// scripts/apply-migration.mjs — run one SQL file via Supabase Management API.
// Usage: node scripts/apply-migration.mjs supabase/migrations/0002_proposals_activity.sql
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-migration.mjs <sql-file>'); process.exit(1); }

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const token = process.env.SUPABASE_TOKEN;
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const sql = readFileSync(file, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
