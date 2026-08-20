import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = process.argv[2] ?? 'dorazouri24@gmail.com';
const password = 'Sk-' + randomBytes(9).toString('base64url');
const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
console.log(error ? 'ERR: ' + error.message : `USER CREATED ${email} PASS ${password}`);
