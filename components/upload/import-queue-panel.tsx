import type { ImportQueueStats } from '@/lib/import-queue';

interface Labels {
  title: string;
  stored: string;
  processed: string;
  waiting: string;
  failed: string;
}

interface Props {
  initialStats: ImportQueueStats;
  labels: Labels;
}

/**
 * Read-only queue stats. Demo Safety Gate (Rotem, 2026-09-13): this used to
 * also carry "Run batch (15)" / "Process all now" buttons — a FIFO batch
 * over "the next N unprocessed documents," with no per-document selection.
 * That's exactly the auto-processing shape the gate exists to remove:
 * uploading (or clicking a queue-drain button) must never spend the demo
 * budget without a human choosing which documents. Processing now only
 * happens through DataInboxTriagePanel's manual selection, capped and
 * budget-gated. lib/import-queue.ts's processImportBatch/drainPending still
 * exist (still budget-gated via runStructured, so they're safe if ever
 * called) but are no longer wired to a button here.
 */
export function ImportQueuePanel({ initialStats, labels }: Props) {
  const stats = initialStats;
  return (
    <section className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.title}</p>
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
    </section>
  );
}
