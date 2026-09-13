import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { ingestDocument } from '@/lib/ingest';
import { bundleCommunication, isBundleableName } from '@/lib/bundle';
import { docxToText } from '@/lib/docx';
import { pdfToText } from '@/lib/pdf';
import { parseWorkbook } from '@/lib/parse/xlsx';
import { parseEml } from '@/lib/parse/eml';
import { parseEmailsJsonl, dumpEmailToRaw } from '@/lib/parse/emails-jsonl';
import { extractEmailsFromArchive } from '@/lib/parse/archive';
import { applyInvoiceRows, applyTaskRows } from '@/lib/import/tracker';
import { runPreflight, type PreflightResult } from '@/lib/preflight';
import type { ProjectMatchCandidate } from '@/lib/project-match';
import type { DocKind, Project, Task } from '@/lib/types';
import { laToday } from '@/lib/date';

export const maxDuration = 300;

// Drop zone, manual-first POC:
//   .pdf            -> stored, preflight only; the invoice agent runs when a
//                       human selects it (Data Inbox)
//   .mp4            -> weekly review recording: store + link only (no transcription yet)
//   .txt / .docx    -> stored, preflight only; comms agent runs on selection
//   .eml            -> parsed email, stored, preflight only
//   .xlsx / .xls    -> tracker importers (invoices / tasks, applied immediately —
//                       deterministic, not an LLM call) or CSV-text, stored + preflight only
//   .jsonl          -> email dump: store all, preflight all — nothing auto-processes
//   .zip / .olm     -> email archive (Outlook export): store all, preflight all
//   .csv            -> text, stored + preflight only
//
// Demo Safety Gate (Rotem, 2026-09-13): uploading a document NEVER calls the
// model. Every new document is stored first and gets a free, deterministic
// preflight (lib/preflight.ts) — duplicate/size/text/project-match signals
// only, never a business decision. Processing happens ONLY when a human
// selects specific documents in Data Inbox (app/actions/data-inbox.ts),
// which is itself budget-gated (lib/claude.ts's Demo Safety Gate).
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // zip-based formats can inflate — cap the input

/** Content identity: the same bytes (or same extracted text) under a new
 *  filename must dedup — the name+size external_id alone misses renames. */
const sha256 = (data: Buffer | string) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

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

/** Preflight needs the same city_case/address-bearing project list
 *  identifyDeterministicProject/matchingProjectIds use elsewhere — one query
 *  per upload request, shared across every document it stores. */
async function loadProjectsForPreflight(admin: ReturnType<typeof supabaseAdmin>): Promise<ProjectMatchCandidate[]> {
  const { data } = await admin.from('projects').select('id,name,city_case,address');
  return (data ?? []) as ProjectMatchCandidate[];
}

function preflightFor(
  kind: DocKind, rawText: string | null, storagePath: string | null, projects: ProjectMatchCandidate[],
): PreflightResult {
  return runPreflight({ kind, raw_text: rawText, storage_path: storagePath }, projects);
}

export async function POST(req: NextRequest) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Staged path (app/actions/upload.ts's createUploadUrl): the browser has
  // already put the file's bytes directly into Storage, bypassing Vercel's
  // 4.5MB function-body limit entirely — this request is a small JSON body
  // naming where they landed, not the bytes themselves. Only single-file;
  // the summary+transcript pair below stays multipart-only (pairs are always
  // small text files, never the reason a file needed staging).
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await req.json() as { stagedPath?: string; fileName?: string; project?: string };
    if (!body.stagedPath || !body.fileName) {
      return NextResponse.json({ error: 'stagedPath/fileName missing' }, { status: 400 });
    }
    const { data: blob, error: dlError } = await admin.storage.from('documents').download(body.stagedPath);
    if (dlError || !blob) {
      return NextResponse.json({ error: dlError?.message ?? 'staged file not found' }, { status: 400 });
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    // Best-effort cleanup of the staging copy — the real content is either
    // re-stored under its own path below (pdf/mp4) or extracted to raw_text
    // (everything else), so nothing depends on this blob surviving.
    admin.storage.from('documents').remove([body.stagedPath]).catch(() => {});
    // Direct-to-storage only bypasses Vercel's 4.5MB function-body ceiling —
    // the app's own business-logic cap (zip-based formats can inflate a lot)
    // still applies, same limit and message as the multipart path below.
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'file too large (max 20MB)' }, { status: 413 });
    }
    return processUploadedFile(admin, { name: body.fileName, buffer });
  }

  const form = await req.formData();
  const allFiles = form.getAll('file').filter((f): f is File => f instanceof File);
  const file = allFiles[0];
  // form.get('project') (a project hint) is still sent by the dropzone but
  // no longer consumed here — nothing downstream of storage+preflight runs
  // at upload time to use it (Demo Safety Gate: upload never processes).
  if (!file) {
    return NextResponse.json({ error: 'file missing' }, { status: 400 });
  }
  if (allFiles.length > 2) {
    return NextResponse.json({ error: 'one file, or a summary + transcript pair' }, { status: 400 });
  }
  for (const f of allFiles) {
    if (f.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'file too large (max 20MB)' }, { status: 413 });
    }
  }

  // Summary + raw transcript of the SAME meeting, uploaded together — one
  // communication, stored as one document. Both files must be text-like;
  // anything else (a PDF next to a transcript) is two unrelated uploads, not
  // a pair.
  if (allFiles.length === 2) {
    const [a, b] = allFiles;
    if (!isBundleableName(a.name) || !isBundleableName(b.name)) {
      return NextResponse.json({ error: 'a pair must be two transcript files (.txt / .docx / .pdf)' }, { status: 400 });
    }
    try {
      const toText = async (f: File) => {
        const buf = Buffer.from(await f.arrayBuffer());
        const n = f.name.toLowerCase();
        if (n.endsWith('.docx')) return docxToText(buf);
        if (n.endsWith('.pdf')) return pdfToText(buf);
        return buf.toString('utf8');
      };
      const [textA, textB] = await Promise.all([toText(a), toText(b)]);
      const merged = bundleCommunication({ name: a.name, text: textA }, { name: b.name, text: textB });
      const bundleKey = `upload:bundle:${a.name}:${a.size}+${b.name}:${b.size}`;
      const { documentId, deduped, processed } = await ingestDocument(admin, {
        kind: 'transcript', source: 'upload', raw_text: merged, external_id: bundleKey,
        // Hash of the MERGED text: orderBundle normalizes which file comes
        // first, so the same pair re-uploaded under new names still dedups.
        content_hash: sha256(merged),
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) {
        return NextResponse.json({
          ok: true, documentId, deduped: true,
          type: processed ? 'transcript_bundle' : 'stored_unprocessed',
        });
      }
      const projects = await loadProjectsForPreflight(admin);
      const preflight = preflightFor('transcript', merged, null, projects);
      return NextResponse.json({ ok: true, type: 'stored_unprocessed', documentId, preflight });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
    }
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return processUploadedFile(admin, { name: file.name, buffer });
}

/**
 * The single-file storage+preflight path that used to be the tail of POST()
 * directly — pulled out so both the ordinary multipart path above and the
 * staged (direct-to-storage) path can share it verbatim. Takes bytes already
 * in hand; does not care where they came from. Never calls the model —
 * see the Demo Safety Gate note at the top of this file.
 *
 * The project hint (form field / staged-upload body) is still READ by the
 * caller but no longer passed in here: nothing downstream of storage+
 * preflight runs at upload time to use it. It stays meaningful for a future
 * manual "process selected" action to accept explicitly, not for storage.
 */
async function processUploadedFile(
  admin: ReturnType<typeof supabaseAdmin>,
  input: { name: string; buffer: Buffer },
): Promise<NextResponse> {
  const buffer = input.buffer;
  const name = input.name.toLowerCase();
  const dedupKey = `upload:${input.name}:${buffer.length}`;

  try {
    if (name.endsWith('.pdf')) {
      const path = `uploads/${Date.now()}-${input.name}`;
      await admin.storage.from('documents').upload(path, buffer, {
        contentType: 'application/pdf', upsert: false,
      });
      const { documentId, deduped, processed } = await ingestDocument(admin, {
        kind: 'invoice_pdf', source: 'upload', storage_path: path, external_id: dedupKey,
        content_hash: sha256(buffer),
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) {
        // A prior attempt (from before this gate shipped) can have already
        // processed this file — don't claim "not processed" for that case;
        // otherwise, stay stored+preflight-only like every fresh upload.
        return NextResponse.json({
          ok: true, documentId, deduped: true,
          type: processed ? 'invoice_pdf' : 'stored_unprocessed',
        });
      }
      const projects = await loadProjectsForPreflight(admin);
      const preflight = preflightFor('invoice_pdf', null, path, projects);
      return NextResponse.json({ ok: true, type: 'stored_unprocessed', documentId, preflight });
    }

    if (name.endsWith('.mp4')) {
      const path = `recordings/${Date.now()}-${input.name}`;
      await admin.storage.from('documents').upload(path, buffer, {
        contentType: 'video/mp4', upsert: false,
      });
      const { documentId, deduped } = await ingestDocument(admin, {
        kind: 'transcript', source: 'upload', storage_path: path, external_id: dedupKey,
        content_hash: sha256(buffer),
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) return NextResponse.json({ ok: true, type: 'recording', documentId, deduped: true });
      // Transcription is future work (mirrors client demo's design-only upload) — store + link only.
      return NextResponse.json({ ok: true, type: 'recording', documentId });
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const parsed = parseWorkbook(buffer);
      const { documentId, deduped, processed } = await ingestDocument(admin, {
        kind: 'sheet', source: 'upload', external_id: dedupKey,
        content_hash: sha256(buffer),
        raw_text: parsed.kind === 'text' ? parsed.text : `tracker:${parsed.kind} rows:${parsed.rows.length}`,
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) {
        return NextResponse.json({
          ok: true, documentId, deduped: true,
          type: processed ? 'sheet' : 'stored_unprocessed',
        });
      }

      // Tracker rows are a deterministic, non-LLM import (applyInvoiceRows/
      // applyTaskRows parse the workbook directly) — never gated by the Demo
      // Safety Gate, since no model call happens here either way.
      if (parsed.kind === 'invoices') {
        const { data: projectRows } = await admin.from('projects').select('id,name');
        const result = await applyInvoiceRows(admin, documentId, parsed.rows, (projectRows ?? []) as Pick<Project, 'id' | 'name'>[]);
        await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', documentId);
        return NextResponse.json({ ok: true, type: 'invoice_tracker', ...result, rows: parsed.rows.length });
      }
      if (parsed.kind === 'tasks') {
        const { data: projectRows } = await admin.from('projects').select('id,name');
        const { data: openTasks } = await admin.from('tasks').select('*').eq('status', 'open');
        const today = laToday();
        const result = await applyTaskRows(admin, documentId, parsed.rows, (projectRows ?? []) as Pick<Project, 'id' | 'name'>[], (openTasks ?? []) as Task[], today);
        await admin.from('documents').update({ processed_at: new Date().toISOString() }).eq('id', documentId);
        return NextResponse.json({ ok: true, type: 'task_tracker', ...result, rows: parsed.rows.length });
      }
      const projects = await loadProjectsForPreflight(admin);
      const preflight = preflightFor('sheet', parsed.text, null, projects);
      return NextResponse.json({ ok: true, type: 'stored_unprocessed', documentId, preflight });
    }

    if (name.endsWith('.jsonl')) {
      const emails = parseEmailsJsonl(buffer.toString('utf8'));
      let stored = 0, deduped = 0;
      const sorted = [...emails].sort((a, b) => emailTime(b.date) - emailTime(a.date));
      for (const email of sorted) {
        const raw = dumpEmailToRaw(email);
        // content_hash (not just external_id) so the same message dedupes
        // regardless of channel — see lib/mail/gmail.ts's comment.
        const { deduped: dup } = await ingestDocument(admin, {
          kind: 'email', source: 'upload', external_id: email.externalId, raw_text: raw,
          content_hash: sha256(raw),
        });
        if (dup) { deduped++; continue; }
        stored++;
      }
      return NextResponse.json({
        ok: true, type: 'email_dump', stored, deduped,
        note: stored ? `stored ${stored} — select in Data Inbox to process` : undefined,
      });
    }

    if (name.endsWith('.eml')) {
      const parsed = parseEml(buffer.toString('utf8'));
      const raw = `From: ${parsed.from}\nTo: ${parsed.to}\nDate: ${parsed.date}\nSubject: ${parsed.subject}\n\n${parsed.body}`;
      const { documentId, deduped, processed } = await ingestDocument(admin, {
        kind: 'email', source: 'upload', external_id: parsed.messageId ?? dedupKey, raw_text: raw,
        content_hash: sha256(raw),
      });
      if (!documentId) return NextResponse.json({ ok: true, deduped: true });
      if (deduped) {
        return NextResponse.json({
          ok: true, documentId, deduped: true,
          type: processed ? 'email' : 'stored_unprocessed',
        });
      }
      const projects = await loadProjectsForPreflight(admin);
      const preflight = preflightFor('email', raw, null, projects);
      return NextResponse.json({ ok: true, type: 'stored_unprocessed', documentId, preflight });
    }

    if (name.endsWith('.zip') || name.endsWith('.olm')) {
      const emails = await extractEmailsFromArchive(buffer, name.endsWith('.olm') ? 'olm' : 'zip');
      let stored = 0, deduped = 0;
      const sorted = [...emails].sort((a, b) => emailTime(b.date) - emailTime(a.date));
      for (let i = 0; i < sorted.length; i++) {
        const email = sorted[i];
        // content_hash (not just external_id) so the same message dedupes
        // regardless of channel — see lib/mail/gmail.ts's comment.
        const { deduped: dup } = await ingestDocument(admin, {
          kind: 'email', source: 'upload', external_id: email.external_id ?? `${dedupKey}:${i}`,
          raw_text: email.raw, content_hash: sha256(email.raw),
        });
        if (dup) { deduped++; continue; }
        stored++;
      }
      return NextResponse.json({
        ok: true, type: 'email_archive', stored, deduped,
        note: stored ? `stored ${stored} — select in Data Inbox to process` : undefined,
      });
    }

    // .txt / .docx / .csv -> transcript text. Cap before it becomes an LLM
    // prompt (same 30k as lib/parse/eml.ts) — the 20MB byte cap alone lets a
    // plain-text file force a very large, billed Claude call.
    let text: string;
    if (name.endsWith('.docx')) text = await docxToText(buffer);
    else text = buffer.toString('utf8');
    text = text.slice(0, 30000);
    const { documentId, deduped, processed } = await ingestDocument(admin, {
      kind: 'transcript', source: 'upload', raw_text: text, external_id: dedupKey,
      // Hash of the extracted TEXT, not the file bytes: a re-saved .docx with
      // identical words but fresh metadata still dedups.
      content_hash: sha256(text),
    });
    if (!documentId) return NextResponse.json({ ok: true, deduped: true });
    if (deduped) {
      return NextResponse.json({
        ok: true, documentId, deduped: true,
        type: processed ? 'transcript' : 'stored_unprocessed',
      });
    }
    const projects = await loadProjectsForPreflight(admin);
    const preflight = preflightFor('transcript', text, null, projects);
    return NextResponse.json({ ok: true, type: 'stored_unprocessed', documentId, preflight });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
