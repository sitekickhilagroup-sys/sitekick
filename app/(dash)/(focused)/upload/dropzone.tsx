'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DropzoneLabels {
  drop: string; processing: string; done: string; failed: string;
  project: string; all: string; chooseFile: string; nextStep: string; retry: string;
  stored: string; noTranscript: string; notProcessed: string;
  /** Typed result cards (Noa, 2026-08-28: her tracker upload succeeded but
   *  "המסך לא השתנה" — the numbers the route returns were never shown). */
  invoiceTracker: string; taskTracker: string; emailBatch: string; alreadyUploaded: string;
  /** PDF outcomes: an invoice row was created (flagged for verification), the
   *  agent classified the PDF as a contract/proposal/letter and stored it as
   *  a document only, or an invoice that created no row (no project match /
   *  duplicate). */
  invoiceCreated: string; notAnInvoice: string; invoiceSkipped: string;
  /** Summary + raw transcript of one meeting, dropped together and processed
   *  as a single communication. */
  bundleDone: string;
}

interface Props {
  projects: string[];
  labels: DropzoneLabels;
  /** Narrowed per source tab. Never widened past what /api/upload handles. */
  accept: string;
  title: string;
  formats: string;
  /** Lifted into IntakePanel — a tab switch through Sheet or Paste must not
      reset the chosen project, since this component unmounts on those. */
  project: string;
  onProjectChange: (project: string) => void;
}

export function Dropzone({ projects, labels, accept, title, formats, project, onProjectChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'stored' | 'unprocessed' | 'error'>('idle');
  const [detail, setDetail] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const last = useRef<File[] | null>(null);

  // The route answers with real numbers — upserted/failed for an invoice
  // tracker, created/updated for a task tracker, stored/processed for an
  // email batch, deduped for a re-upload. They were dropped on the floor and
  // the only feedback was a 10px status line, which is exactly what Noa
  // reported as "המסך לא השתנה". This turns them into a visible sentence.
  function reportFor(json: Record<string, unknown>): string | null {
    if (json.deduped) return labels.alreadyUploaded;
    const n = (v: unknown) => String(typeof v === 'number' ? v : 0);
    if (json.type === 'invoice_tracker') {
      return labels.invoiceTracker.replace('{updated}', n(json.upserted)).replace('{failed}', n(json.failed));
    }
    if (json.type === 'task_tracker') {
      return labels.taskTracker.replace('{created}', n(json.created)).replace('{updated}', n(json.updated));
    }
    if (json.type === 'email_dump' || json.type === 'email_archive') {
      return labels.emailBatch.replace('{stored}', n(json.stored)).replace('{processed}', n(json.processed));
    }
    if (json.type === 'invoice_pdf') {
      const summary = (json.summary ?? {}) as { invoice_id?: string | null; document_kind?: string };
      if (summary.document_kind && summary.document_kind !== 'invoice') return labels.notAnInvoice;
      return summary.invoice_id ? labels.invoiceCreated : labels.invoiceSkipped;
    }
    if (json.type === 'transcript_bundle') return labels.bundleDone;
    return null;
  }

  // One file = today's flow. Two files = a summary + raw-transcript pair of
  // the same meeting, sent in ONE request so the agent reads them together.
  async function send(files: File[]) {
    last.current = files;
    setState('busy');
    setDetail(files.map((f) => f.name).join(' + '));
    setReport(null);
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    if (project) fd.append('project', project);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (res.ok && json.ok !== false) {
        // .mp4 is stored and linked only — no transcription runs — so it must
        // not claim "Processed" or promise a review that never comes. A
        // dedup hit on a document a *previous* attempt stored but never
        // finished processing is the same shape of problem: the row is real,
        // but nothing ran, so this must not claim "Processed" either — see
        // route.ts's `stored_unprocessed` branches.
        setState(
          json.type === 'recording' ? 'stored'
          : json.type === 'stored_unprocessed' ? 'unprocessed'
          : 'done',
        );
        setReport(reportFor(json));
      } else {
        setState('error');
        setDetail(json.error ?? files.map((f) => f.name).join(' + '));
      }
      // Either way, a `documents` row can now exist that didn't before —
      // ingestDocument's insert runs before processing does, so a failure
      // here doesn't mean nothing was stored. Refresh so the queue (item 19)
      // never looks unchanged while a real row sits behind it.
      router.refresh();
    } catch (e) {
      setState('error');
      setDetail(String(e));
    }
  }

  const busy = state === 'busy';

  return (
    <div className="space-y-3">
      {/* Project selection keeps sending names, not ids: /api/upload reads it
          as a free-text project_hint. */}
      <label className="flex items-center gap-2 text-[10px] text-sk-muted">
        {labels.project}
        <select
          value={project}
          onChange={(e) => onProjectChange(e.target.value)}
          className="min-h-11 cursor-pointer rounded-[8px] border border-line bg-sk-surface px-2 py-1.5 text-[10px] text-sk-ink sm:min-h-0"
        >
          <option value="">{labels.all}</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) void send(files.slice(0, 2));
        }}
        aria-busy={busy}
        className={`flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed px-5 py-8 text-center transition-colors ${
          dragging ? 'border-sage bg-sk-green-soft'
          : state === 'error' ? 'border-coral/50 bg-sk-surface'
          : 'border-sk-line-strong bg-sk-upload-surface'
        }`}
      >
        <span aria-hidden="true" className="grid h-[46px] w-[46px] place-items-center rounded-full bg-sage text-[29px] leading-none text-white">
          +
        </span>
        <span className="block text-[13px] font-[650] text-sk-ink">{title}</span>
        <span className="block font-mono text-[9px] text-sk-muted">{formats}</span>

        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="min-h-11 cursor-pointer rounded-[8px] bg-sage px-4 py-2 text-[10px] font-[650] leading-none text-white hover:opacity-90 disabled:opacity-50 sm:min-h-0"
        >
          {labels.chooseFile}
        </button>
        <span className="block text-[10px] text-sk-muted">{labels.drop}</span>

        {/* No percentage: /api/upload is a single fetch with no multipart
            endpoint behind it, so a progress bar would be fabricated. */}
        <span role="status" className="block max-w-full truncate text-[10px]">
          {busy && <span className="text-sk-muted">{labels.processing} {detail}</span>}
          {state === 'done' && (
            <span className="text-sk-green">✓ {labels.done} · {detail} — {labels.nextStep}</span>
          )}
          {state === 'stored' && (
            <span className="text-sk-green">✓ {labels.stored} · {detail} — {labels.noTranscript}</span>
          )}
          {state === 'unprocessed' && (
            <span className="text-sk-green">✓ {labels.stored} · {detail} — {labels.notProcessed}</span>
          )}
          {state === 'error' && <span className="text-coral">✗ {labels.failed} · {detail}</span>}
        </span>

        {state === 'error' && (
          <button
            type="button"
            onClick={() => { const f = last.current; if (f?.length) void send(f); }}
            className="min-h-11 cursor-pointer rounded-[8px] border border-sage-line px-3 py-1.5 text-[10px] font-[650] leading-none text-sk-green sm:min-h-0"
          >
            {labels.retry}
          </button>
        )}

        {/* The typed result card — what actually happened, in numbers. */}
        {report && state !== 'busy' && state !== 'error' && (
          <p role="status" className="mt-1 max-w-md rounded-[10px] bg-sk-green-soft px-4 py-2.5 text-[12px] font-[650] leading-[1.5] text-sk-green">
            {report}
          </p>
        )}
      </div>

      <input
        ref={input} type="file" accept={accept} multiple className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void send(files.slice(0, 2));
          e.target.value = '';
        }}
      />
    </div>
  );
}
