import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestDocument } from '../ingest.ts';

const sha256 = (data: string) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

// Outlook / Microsoft 365 poll via Graph API (client-credentials app).
// Activates when all MSGRAPH_* env vars are present.

export function isConfigured(): boolean {
  return !!(process.env.MSGRAPH_TENANT_ID && process.env.MSGRAPH_CLIENT_ID
    && process.env.MSGRAPH_CLIENT_SECRET && process.env.MSGRAPH_USER);
}

async function accessToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MSGRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MSGRAPH_CLIENT_ID!,
        client_secret: process.env.MSGRAPH_CLIENT_SECRET!,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );
  if (!res.ok) throw new Error(`graph token: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
}

// Demo Safety Gate (Rotem, 2026-09-13): polling stores documents only — it
// never calls the model. Every polled email lands in Data Inbox's triage
// view (lib/preflight.ts) exactly like an upload, and is only ever
// processed via an explicit human selection (app/actions/data-inbox.ts).
export async function run(admin: SupabaseClient): Promise<{ stored: number } | { skipped: string }> {
  if (!isConfigured()) return { skipped: 'not_configured' };
  const token = await accessToken();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MSGRAPH_USER!)}/messages?$filter=isRead eq false&$top=15&$select=id,internetMessageId,subject,from,receivedDateTime,body,bodyPreview`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`graph list: ${res.status}`);
  const list = (await res.json()) as { value: GraphMessage[] };

  let stored = 0;
  for (const msg of list.value ?? []) {
    // Cap before it could ever become an LLM prompt (same 30k as
    // lib/parse/eml.ts) — kept even though nothing here calls the model, so
    // a later manual selection doesn't send an unbounded body either.
    const bodyText = (msg.body?.contentType === 'html'
      ? stripHtml(msg.body.content ?? '')
      : (msg.body?.content ?? msg.bodyPreview ?? '')).slice(0, 30000);
    const raw = `From: ${msg.from?.emailAddress?.name ?? ''} <${msg.from?.emailAddress?.address ?? ''}>\nDate: ${msg.receivedDateTime ?? ''}\nSubject: ${msg.subject ?? ''}\n\n${bodyText}`;

    // content_hash (not just external_id) so the SAME message polled via a
    // different channel still dedupes — see lib/mail/gmail.ts's comment.
    const { documentId, deduped } = await ingestDocument(admin, {
      kind: 'email', source: 'outlook',
      external_id: `outlook:${msg.internetMessageId ?? msg.id}`,
      raw_text: raw, content_hash: sha256(raw),
    });
    if (!deduped && documentId) stored++;
  }
  return { stored };
}
