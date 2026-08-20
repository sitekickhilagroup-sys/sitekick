'use client';

import { useRef, useState } from 'react';

interface Labels { drop: string; processing: string; done: string; failed: string; project: string; all: string }

export function Dropzone({ projects, labels }: { projects: string[]; labels: Labels }) {
  const input = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [detail, setDetail] = useState('');
  const [dragging, setDragging] = useState(false);

  async function send(file: File) {
    setState('busy');
    setDetail(file.name);
    const fd = new FormData();
    fd.append('file', file);
    if (project) fd.append('project', project);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (res.ok && json.ok !== false) setState('done');
      else { setState('error'); setDetail(json.error ?? file.name); }
    } catch (e) {
      setState('error');
      setDetail(String(e));
    }
  }

  return (
    <div className="max-w-xl space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink2">
        {labels.project}
        <select value={project} onChange={(e) => setProject(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink">
          <option value="">{labels.all}</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void send(file);
        }}
        className={`flex h-44 w-full items-center justify-center rounded-(--radius-card) border-2 border-dashed text-sm transition-colors ${
          dragging ? 'border-sage bg-sage-soft text-sage' : 'border-line bg-card text-ink2 hover:border-sage-line'
        }`}
      >
        {state === 'busy' ? `${labels.processing} ${detail}`
          : state === 'done' ? `✓ ${labels.done} · ${detail}`
          : state === 'error' ? `✗ ${labels.failed} · ${detail}`
          : labels.drop}
      </button>
      <input
        ref={input} type="file" accept=".pdf,.txt,.docx" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }}
      />
    </div>
  );
}
