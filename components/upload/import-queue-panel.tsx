'use client';

import { useState, useTransition } from 'react';
import { runImportBatch } from '@/app/actions/import-queue';
import type { ImportQueueStats } from '@/lib/import-queue';

interface Labels {
  title: string;
  stored: string;
  processed: string;
  waiting: string;
  failed: string;
  runBatch: string;
  running: string;
  /** "{succeeded} processed, {failed} failed" */
  result: string;
  more: string;
  errorSave: string;
}

interface Props {
  initialStats: ImportQueueStats;
  labels: Labels;
}

/**
 * Manual trigger for the same batch app/api/cron/process-import-queue runs
 * on a schedule — drains the documents backlog (lib/import-queue.ts) on
 * demand instead of only whenever the cron next fires, and gives a real
 * click-and-verify surface for the batch/resume/retry mechanism.
 */
export function ImportQueuePanel({ initialStats, labels }: Props) {
  const [stats, setStats] = useState(initialStats);
  const [result, setResult] = useState<{ succeeded: number; failed: number; more: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const runBatch = () => start(async () => {
    setError(null);
    setResult(null);
    try {
      const res = await runImportBatch(15);
      setResult({ succeeded: res.succeeded, failed: res.failed, more: res.more });
      // Reflect the batch immediately without waiting for a full page
      // reload — the server action already revalidated /upload for the
      // next real navigation, this just keeps THIS render in sync too.
      setStats((s) => ({
        ...s,
        processed: s.processed + res.succeeded,
        waiting: Math.max(0, s.waiting - res.succeeded - res.failed),
        failed: s.failed + res.failed,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorSave);
    }
  });

  return (
    <section className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.title}</p>
        <button
          type="button" disabled={pending} onClick={runBatch}
          className="min-h-11 cursor-pointer rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? labels.running : labels.runBatch}
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          [labels.stored, stats.stored],
          [labels.processed, stats.processed],
          [labels.waiting, stats.waiting],
          [labels.failed, stats.failed],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line2 bg-sk-surface-soft px-3 py-2">
            <dt className="text-[9px] font-semibold tracking-[0.06em] text-sk-muted uppercase">{label}</dt>
            <dd className="mt-0.5 font-mono text-lg font-[650] text-sk-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {result && (
        <p role="status" className="mt-3 text-[11px] text-sk-muted">
          {labels.result.replace('{succeeded}', String(result.succeeded)).replace('{failed}', String(result.failed))}
          {result.more && ` ${labels.more}`}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-[11px] font-semibold text-coral">{error}</p>}
    </section>
  );
}
