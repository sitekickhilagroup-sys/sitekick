import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ingestDocument, processDocument } from '@/lib/ingest';

export const maxDuration = 300;

// Forward-address intake: Cloudflare worker / Gmail / Outlook forwarding rule
// POSTs here with the shared secret. Works for any mailbox provider.
export async function POST(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    from?: string; to?: string; subject?: string; text?: string;
    message_id?: string; date?: string; project_hint?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.text && !body.subject) {
    return NextResponse.json({ error: 'empty message' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const raw = [
    body.from ? `From: ${body.from}` : null,
    body.to ? `To: ${body.to}` : null,
    body.date ? `Date: ${body.date}` : null,
    body.subject ? `Subject: ${body.subject}` : null,
    '',
    body.text ?? '',
  ].filter((l) => l !== null).join('\n');

  const { documentId, deduped } = await ingestDocument(admin, {
    kind: 'email',
    source: 'forward',
    external_id: body.message_id ?? null,
    raw_text: raw,
  });
  if (deduped || !documentId) {
    return NextResponse.json({ ok: true, deduped: true, documentId });
  }

  try {
    const summary = await processDocument(admin, {
      id: documentId, kind: 'email', raw_text: raw, project_hint: body.project_hint ?? null,
    });
    return NextResponse.json({ ok: true, documentId, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, documentId, error: String(e) }, { status: 200 });
  }
}
