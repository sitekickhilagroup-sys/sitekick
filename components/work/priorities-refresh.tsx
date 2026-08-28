'use client';

import { useState, useTransition } from 'react';
import { refreshPriorities } from '@/app/actions/prioritize';

/** "Refresh priorities" — one on-demand agent run. The daily cron does the
 *  same thing at 14:00 UTC; this exists for the day that changed at 15:00. */
export function PrioritiesRefresh({ labels }: {
  labels: { refresh: string; running: string; done: string; error: string };
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = () => start(async () => {
    setMsg(null);
    const res = await refreshPriorities();
    setMsg('error' in res ? labels.error : labels.done.replace('{n}', String(res.ranked)));
  });

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="min-h-8 cursor-pointer rounded-[8px] border border-sage-line bg-sk-surface px-2.5 py-1 text-[10px] font-[650] text-sage hover:bg-sage-soft disabled:opacity-50"
      >
        {pending ? labels.running : labels.refresh}
      </button>
      {msg && <span role="status" className="text-[10px] text-sk-muted">{msg}</span>}
    </span>
  );
}
