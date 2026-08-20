import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const [email, password, filePath, project] = process.argv.slice(2);
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data, error } = await client.auth.signInWithPassword({ email, password });
if (error) { console.log('AUTH ERR', error.message); process.exit(1); }
const ref = new URL(url).hostname.split('.')[0];
const b64 = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64');
const chunks = [];
for (let i = 0; i < b64.length; i += 3180) chunks.push(b64.slice(i, i + 3180));
const cookie = chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join('; ');

const buffer = readFileSync(filePath);
const name = filePath.split(/[\/]/).pop();
const fd = new FormData();
fd.append('file', new File([buffer], name));
if (project) fd.append('project', project);
const res = await fetch('http://localhost:3000/api/upload', { method: 'POST', headers: { cookie }, body: fd });
console.log(name.slice(0, 45), '->', res.status, JSON.stringify(await res.json()).slice(0, 220));
