import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { ingestDocument, processDocument } from '@/lib/ingest';
import { docxToText } from '@/lib/docx';
import { parseWorkbook } from '@/lib/parse/xlsx';
import { parseEml } from '@/lib/parse/eml';
import { parseEmailsJsonl, dumpEmailToRaw } from '@/lib/parse/emails-jsonl';
import { applyInvoiceRows, applyTaskRows } from '@/lib/import/tracker';
import type { Project, Task } from '@/lib/types';

export const maxDuration = 300;

// Drop zone, manual-first POC:
//   .pdf            -> invoice agent (native PDF)
//   .txt / .docx    -> transcript/email -> comms agent
//   .eml            -> parsed email -> comms agent
//   .xlsx / .xls    -> tracker importers (invoices / tasks) or CSV-text -> comms agent
//   .jsonl          -> email dump: store all, agent-process the newest few
//   .csv            -> text -> comms agent
export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const projectHint = (form.get('project') as string | null) || null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file missing' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const dedupKey = `upload:${file.name}:${buffer.length}`;

  try {
    if (name.endsWith('.pdf')) {
      const path = `uploads/${Date.now()}-${file.name}`;
      await admin.storage.from('documents').upload(path, buffer, {
        contentType: 'application/pdf', upsert: false,
      });
      const { documentId, deduped } = await ingestDocument(admin, {
        kind: 'invoice_pdf', source: 'upload', storage_path: path, external_id: dedupKey,
      });
      if (deduped || !documentId) return NextResponse.json({ ok: true, deduped: true });
      const summary = await processDocument(admin, {
        id: documentId, kind: 'invoice_pdf', pdf_base64: buffer.toString('base64'), project_hint: projectHint,
      });
      return NextResponse.json({ ok: true, type: 'invoice_pdf', documentId, summary });
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const parsed = parseWorkbook(buffer);
      const { documentId, deduped } = await ingestDocument(admin, {
        kind: 'sheet', source: 'upload', external_id: dedupKey,
        raw_text: parsed.kind === 'text' ? parsed.text : `tracker:${parsed.kind} rows:${parsed.rows.length}`,
      });
      if (deduped || !documentId) return NextResponse.json({ ok: true, deduped: true });
      const { data: projects } = await admin.from('projects').select('id,name');
      const projectList = (projects ?? []) as Pick<Project, 'id' | 'name'>[];

      if (parsed.kind === 'invoices') {
        const result = await applyInvoiceRows(admin, documentId, parsed.rows, projectList);
        await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', documentId);
        return NextResponse.json({ ok: true, type: 'invoice_tracker', ...result, rows: parsed.rows.length });
      }
      if (parsed.kind === 'tasks') {
        const { data: openTasks } = await admin.from('tasks').select('*').eq('status', 'open');
        const today = new Date().toISOString().slice(0, 10);
        const result = await applyTaskRows(admin, documentId, parsed.rows, projectList, (openTasks ?? []) as Task[], today);
        await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', documentId);
        return NextResponse.json({ ok: true, type: 'task_tracker', ...result, rows: parsed.rows.length });
      }
      const summary = await processDocument(admin, {
        id: documentId, kind: 'transcript', raw_text: parsed.text, project_hint: projectHint,
      });
      return NextResponse.json({ ok: true, type: 'sheet_text', documentId, summary });
    }

    if (name.endsWith('.jsonl')) {
      const emails = parseEmailsJsonl(buffer.toString('utf8'));
      let stored = 0, deduped = 0, processed = 0;
      const PROCESS_CAP = 10;
      // newest first so the cap spends agent budget on recent mail
      const sorted = [...emails].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const email of sorted) {
        const { documentId, deduped: dup } = await ingestDocument(admin, {
          kind: 'email', source: 'upload', external_id: email.externalId,
          raw_text: dumpEmailToRaw(email),
        });
        if (dup) { deduped++; continue; }
        stored++;
        if (processed < PROCESS_CAP && documentId) {
          try {
            await processDocument(admin, { id: documentId, kind: 'email', raw_text: dumpEmailToRaw(email), project_hint: projectHint });
            processed++;
          } catch { /* keep storing even if one extraction fails */ }
        }
      }
      return NextResponse.json({
        ok: true, type: 'email_dump',
        stored, deduped, processed,
        note: stored > processed ? `stored ${stored}, agent-processed newest ${processed}` : undefined,
      });
    }

    if (name.endsWith('.eml')) {
      const parsed = parseEml(buffer.toString('utf8'));
      const raw = `From: ${parsed.from}\nTo: ${parsed.to}\nDate: ${parsed.date}\nSubject: ${parsed.subject}\n\n${parsed.body}`;
      const { documentId, deduped } = await ingestDocument(admin, {
        kind: 'email', source: 'upload', external_id: parsed.messageId ?? dedupKey, raw_text: raw,
      });
      if (deduped || !documentId) return NextResponse.json({ ok: true, deduped: true });
      const summary = await processDocument(admin, { id: documentId, kind: 'email', raw_text: raw, project_hint: projectHint });
      return NextResponse.json({ ok: true, type: 'email', documentId, summary });
    }

    // .txt / .docx / .csv -> transcript text
    let text: string;
    if (name.endsWith('.docx')) text = await docxToText(buffer);
    else text = buffer.toString('utf8');
    const { documentId, deduped } = await ingestDocument(admin, {
      kind: 'transcript', source: 'upload', raw_text: text, external_id: dedupKey,
    });
    if (deduped || !documentId) return NextResponse.json({ ok: true, deduped: true });
    const summary = await processDocument(admin, {
      id: documentId, kind: 'transcript', raw_text: text, project_hint: projectHint,
    });
    return NextResponse.json({ ok: true, type: 'transcript', documentId, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
