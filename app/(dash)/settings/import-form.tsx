'use client';

import { useState, useTransition } from 'react';
import { importRequirements } from '@/app/actions/settings';

interface Labels { project: string; run: string; ok: string; help: string }

export function ImportForm({ projects, labels }: { projects: string[]; labels: Labels }) {
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-2"
      action={(fd) => start(async () => {
        setMessage('');
        const result = await importRequirements(fd);
        if ('error' in result && result.error) setMessage(`✗ ${result.error}`);
        else if ('ok' in result) {
          setMessage(labels.ok
            .replace('{stages}', String(result.stages))
            .replace('{requirements}', String(result.requirements))
            .replace('{project}', String(result.project)));
        }
      })}
    >
      <p className="text-xs text-ink3">{labels.help}</p>
      <label className="flex items-center gap-2 text-sm text-ink2">
        {labels.project}
        <select name="project" required className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink">
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <textarea
        name="json" required rows={8} spellCheck={false}
        placeholder='{"stage": "entitlements", "stages": {"entitlements": {"items": [{"r": "...", "state": "open", "who": "us"}]}}}'
        className="w-full rounded-lg border border-line bg-card2 p-3 font-mono text-xs text-ink"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-sage px-4 py-1.5 text-sm text-white disabled:opacity-60">
          {pending ? '…' : labels.run}
        </button>
        {message && <p className="text-xs text-ink2">{message}</p>}
      </div>
    </form>
  );
}
