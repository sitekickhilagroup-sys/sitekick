import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const [email, password] = process.argv.slice(2);
const client = createClient(url, anon, { auth: { persistSession: false } });
const { data, error } = await client.auth.signInWithPassword({ email, password });
if (error) { console.log('AUTH ERR:', error.message); process.exit(1); }
console.log('auth ok, user:', data.user.email);

const ref = new URL(url).hostname.split('.')[0];
const session = JSON.stringify(data.session);
const b64 = 'base64-' + Buffer.from(session).toString('base64');
// @supabase/ssr chunks cookies at ~3180 chars
const chunks = [];
for (let i = 0; i < b64.length; i += 3180) chunks.push(b64.slice(i, i + 3180));
const cookie = chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join('; ');

for (const path of ['/', '/invoices', '/drafts', '/directory', '/settings']) {
  const res = await fetch('http://localhost:3000' + path, { headers: { cookie }, redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  const marks = {
    '/': ["Today's top actions", 'Where every project stands', '3375 Blair Dr', 'Decisions this week'],
    '/invoices': ['For Rowan approval', 'Crest Real Estate', 'Payment Summary'],
    '/drafts': ['Draft approval queue'],
    '/directory': ['PREMISE'],
    '/settings': ['Import requirement lists', 'ZIMAS'],
  }[path];
  const found = marks.filter((m) => html.includes(m));
  console.log(path, res.status, `${found.length}/${marks.length} markers`, found.length < marks.length ? 'MISSING: ' + marks.filter((m) => !html.includes(m)).join(', ') : 'OK');
}
