import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestDocument, processDocument } from '../ingest.ts';

// Gmail read-only poll via REST (no googleapis dependency).
// Activates when all GMAIL_* env vars are present.

export function isConfigured(): boolean {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

async function accessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`gmail token: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

interface GmailHeader { name: string; value: string }
interface GmailPart { mimeType: string; body?: { data?: string }; parts?: GmailPart[] }

function findPlainText(part: GmailPart): string | null {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const p of part.parts ?? []) {
    const found = findPlainText(p);
    if (found) return found;
  }
  return null;
}

export async function run(admin: SupabaseClient): Promise<{ processed: number } | { skipped: string }> {
  if (!isConfigured()) return { skipped: 'not_configured' };
  const token = await accessToken();
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=15',
    { headers: auth },
  );
  if (!listRes.ok) throw new Error(`gmail list: ${listRes.status}`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };

  let processed = 0;
  for (const m of list.messages ?? []) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
      { headers: auth },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as { id: string; payload: GmailPart & { headers: GmailHeader[] } };
    const h = (name: string) => msg.payload.headers.find((x) => x.name.toLowerCase() === name)?.value ?? '';
    const text = findPlainText(msg.payload) ?? '';
    const raw = `From: ${h('from')}\nTo: ${h('to')}\nDate: ${h('date')}\nSubject: ${h('subject')}\n\n${text}`;

    const { documentId, deduped } = await ingestDocument(admin, {
      kind: 'email', source: 'gmail', external_id: `gmail:${msg.id}`, raw_text: raw,
    });
    if (!deduped && documentId) {
      await processDocument(admin, { id: documentId, kind: 'email', raw_text: raw });
      processed++;
    }
  }
  return { processed };
}
