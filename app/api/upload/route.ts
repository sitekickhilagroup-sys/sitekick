import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { ingestDocument, processDocument } from '@/lib/ingest';
import { docxToText } from '@/lib/docx';

export const maxDuration = 300;

// Drop zone: PDF -> invoice pipeline, txt/docx -> transcript pipeline.
export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const projectHint = form.get('project') as string | null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file missing' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    const path = `uploads/${Date.now()}-${file.name}`;
    await admin.storage.from('documents').upload(path, buffer, {
      contentType: 'application/pdf', upsert: false,
    });
    const { documentId } = await ingestDocument(admin, {
      kind: 'invoice_pdf', source: 'upload', storage_path: path,
      external_id: `upload:${file.name}:${buffer.length}`,
    });
    if (!documentId) return NextResponse.json({ ok: true, deduped: true });
    const summary = await processDocument(admin, {
      id: documentId, kind: 'invoice_pdf', pdf_base64: buffer.toString('base64'),
      project_hint: projectHint,
    });
    return NextResponse.json({ ok: true, documentId, summary });
  }

  let text: string;
  if (name.endsWith('.docx')) text = await docxToText(buffer);
  else text = buffer.toString('utf8');

  const { documentId, deduped } = await ingestDocument(admin, {
    kind: 'transcript', source: 'upload', raw_text: text,
    external_id: `upload:${file.name}:${buffer.length}`,
  });
  if (deduped || !documentId) return NextResponse.json({ ok: true, deduped: true });
  const summary = await processDocument(admin, {
    id: documentId, kind: 'transcript', raw_text: text, project_hint: projectHint,
  });
  return NextResponse.json({ ok: true, documentId, summary });
}
