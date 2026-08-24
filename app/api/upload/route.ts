import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { ingestDocument, processDocument } from '@/lib/ingest';
import { docxToText } from '@/lib/docx';
import { parseWorkbook } from '@/lib/parse/xlsx';
import { parseEml } from '@/lib/parse/eml';
import { parseEmailsJsonl, dumpEmailToRaw } from '@/lib/parse/emails-jsonl';
import { extractEmailsFromArchive } from '@/lib/parse/archive';
import { applyInvoiceRows, applyTaskRows } from '@/lib/import/tracker';
import type { Project, Task } from '@/lib/types';
import { laToday } from '@/lib/date';

export const maxDuration = 300;

// Drop zone, manual-first POC:
//   .pdf            -> invoice agent (native PDF)
//   .mp4            -> weekly review recording: store + link only (no transcription yet)
//   .txt / .docx    -> transcript/email -> comms agent
//   .eml            -> parsed email -> comms agent
//   .xlsx / .xls    -> tracker importers (invoices / tasks) or CSV-text -> comms agent
//   .jsonl          -> email dump: store all, agent-process the newest few
//   .zip / .olm     -> email archive (Outlook export): store all, agent-process the newest few
//   .csv            -> text -> comms agent
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // zip-based formats can inflate — cap the input

/**
 * Sort key for an email's own Date header.
 *
 * These were compared as strings, which is not chronological for RFC-822 —
 * "Mon, 14 Jul 2026" sorts above "Fri, 22 Aug 2026" because M precedes F. With
 * a processing budget of ten messages, that meant the "newest ten" were an
 * effectively arbitrary ten. Undated messages sort last rather than first.
 */
function emailTime(date: string | null | undefined): number {
  if (!date) return 0;
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const projectHint = (form.get('project') as string | null) || null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file missing' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'file too large (max 20MB)' }, { status: 413 });
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

    if (name.endsWith('.mp4')) {
      const path = `recordings/${Date.now()}-${file.name}`;
      await admin.storage.from('documents').upload(path, buffer, {
        contentType: 'video/mp4', upsert: false,
      });
      const { documentId, deduped } = await ingestDocument(admin, {
        kind: 'transcript', source: 'upload', storage_path: path, external_id: dedupKey,
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) return NextResponse.json({ ok: true, type: 'recording', documentId, deduped: true });
      // Transcription is future work (mirrors client demo's design-only upload) — store + link only.
      return NextResponse.json({ ok: true, type: 'recording', documentId });
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
        const today = laToday();
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
      const sorted = [...emails].sort((a, b) => emailTime(b.date) - emailTime(a.date));
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

    if (name.endsWith('.zip') || name.endsWith('.olm')) {
      const emails = await extractEmailsFromArchive(buffer, name.endsWith('.olm') ? 'olm' : 'zip');
      let stored = 0, deduped = 0, processed = 0;
      const PROCESS_CAP = 10;
      // newest first so the cap spends agent budget on recent mail (same as .jsonl branch)
      const sorted = [...emails].sort((a, b) => emailTime(b.date) - emailTime(a.date));
      for (let i = 0; i < sorted.length; i++) {
        const email = sorted[i];
        const { documentId, deduped: dup } = await ingestDocument(admin, {
          kind: 'email', source: 'upload', external_id: email.external_id ?? `${dedupKey}:${i}`,
          raw_text: email.raw,
        });
        if (dup) { deduped++; continue; }
        stored++;
        if (processed < PROCESS_CAP && documentId) {
          try {
            await processDocument(admin, { id: documentId, kind: 'email', raw_text: email.raw, project_hint: projectHint });
            processed++;
          } catch { /* keep storing even if one extraction fails */ }
        }
      }
      return NextResponse.json({ ok: true, type: 'email_archive', stored, deduped, processed });
    }

    // .txt / .docx / .csv -> transcript text
    let text: string;
    if (name.endsWith('.docx')) text = await docxToText(buffer);
    else text = buffer.toString('utf8');
    const { documentId, deduped } = await ingestDocument(admin, {
      kind: 'transcript', source: 'upload', raw_text: text, external_id: dedupKey,
    });
    if (!documentId) return NextResponse.json({ ok: true, deduped: true });
    if (deduped) return NextResponse.json({ ok: true, type: 'transcript', documentId, deduped: true });
    const summary = await processDocument(admin, {
      id: documentId, kind: 'transcript', raw_text: text, project_hint: projectHint,
    });
    return NextResponse.json({ ok: true, type: 'transcript', documentId, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
