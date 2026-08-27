'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DropzoneLabels {
  drop: string; processing: string; done: string; failed: string;
  project: string; all: string; chooseFile: string; nextStep: string; retry: string;
  stored: string; noTranscript: string; notProcessed: string;
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
  const [dragging, setDragging] = useState(false);
  const last = useRef<File | null>(null);

  async function send(file: File) {
    last.current = file;
    setState('busy');
    setDetail(file.name);
    const fd = new FormData();
    fd.append('file', file);
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
      } else {
        setState('error');
        setDetail(json.error ?? file.name);
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
          const file = e.dataTransfer.files?.[0];
          if (file) void send(file);
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
            onClick={() => { const f = last.current; if (f) void send(f); }}
            className="min-h-11 cursor-pointer rounded-[8px] border border-sage-line px-3 py-1.5 text-[10px] font-[650] leading-none text-sk-green sm:min-h-0"
          >
            {labels.retry}
          </button>
        )}
      </div>

      <input
        ref={input} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }}
      />
    </div>
  );
}
