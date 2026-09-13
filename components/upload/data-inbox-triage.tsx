'use client';

import { useState, useTransition } from 'react';
import { processSelectedDocuments, getDataInboxTriage, type DataInboxTriage, type PilotRunResult, type TriageDocument } from '@/app/actions/data-inbox';
import type { PreflightReason } from '@/lib/preflight';
import { fmtDate } from '@/lib/format';

// pilotMaxDocs/pilotBudgetUsd/demoBudgetUsd come in as PROPS, computed
// server-side (this is a 'use client' component — it must never import
// lib/data-inbox.ts or lib/claude.ts directly, since both transitively pull
// in 'server-only'-marked modules that cannot enter a client bundle).

export interface TriageLabels {
  help: string;
  groupCandidate: string; groupCandidateD: string;
  groupNeedsSelection: string; groupNeedsSelectionD: string;
  groupDoNotProcess: string; groupDoNotProcessD: string;
  empty: string;
  reasons: Record<PreflightReason, string>;
  selectedCount: string; // "{n} selected (max {max})"
  processSelected: string; // "Process selected (pilot, up to {max})"
  processing: string;
  resultTitle: string;
  outcomeSucceeded: string;
  outcomeFailed: string;
  outcomeBudgetBlocked: string;
  budgetNote: string; // "Demo budget: pilot cap ${pilot}, total demo cap ${total}"
  errorSave: string;
  duplicateOf: string; // "Duplicate of document {id}"
  showingCount: string; // "Showing {shown} of {total} unprocessed documents"
  loadMore: string; // "Load {n} more"
  loading: string;
}

interface Props {
  initialTriage: DataInboxTriage;
  labels: TriageLabels;
  pilotMaxDocs: number;
  pilotBudgetUsd: number;
  demoBudgetUsd: number;
  triagePageSize: number;
}

function Group({
  title, description, docs, selectable, selected, onToggle, reasonLabels, duplicateOfLabel,
}: {
  title: string; description: string; docs: TriageDocument[]; selectable: boolean;
  selected: Set<string>; onToggle: (id: string) => void; reasonLabels: Record<PreflightReason, string>;
  duplicateOfLabel: string;
}) {
  if (docs.length === 0) return null;
  return (
    <div className="rounded-[12px] border border-line2 bg-sk-surface-soft p-3.5">
      <p className="text-[11px] font-[650] text-sk-ink">{title} <span className="font-mono text-sk-muted">({docs.length})</span></p>
      <p className="mt-0.5 text-[10px] leading-[1.4] text-sk-muted">{description}</p>
      <ul className="mt-2.5 divide-y divide-line2">
        {docs.map((doc) => (
          <li key={doc.id} className="flex items-start gap-2.5 py-2">
            {selectable ? (
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                onChange={() => onToggle(doc.id)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-sage"
                aria-label={doc.name}
              />
            ) : (
              <span className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-[6px] bg-sk-surface px-1.5 py-0.5 text-center font-mono text-[8px] uppercase text-sk-muted">{doc.kind}</span>
                <span className="min-w-0 truncate text-[11px] text-sk-ink"><bdi>{doc.name}</bdi></span>
                <span className="font-mono text-[8px] text-sk-muted"><bdi>{fmtDate(doc.received_at)}</bdi></span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {doc.preflight.reasons.map((r) => (
                  <span key={r} className="rounded-full bg-sk-blue-soft px-1.5 py-0.5 text-[9px] font-[600] text-sk-blue">
                    {reasonLabels[r]}
                  </span>
                ))}
              </div>
              {doc.duplicateOfId && (
                <p className="mt-1 text-[9px] text-sk-muted">
                  {duplicateOfLabel.replace('{id}', doc.duplicateOfId)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataInboxTriagePanel({ initialTriage, labels, pilotMaxDocs, pilotBudgetUsd, demoBudgetUsd, triagePageSize }: Props) {
  const [triage, setTriage] = useState(initialTriage);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PilotRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [loadingMore, startLoadMore] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= pilotMaxDocs) return prev; // hard cap enforced client-side too
      next.add(id);
      return next;
    });
  };

  const run = () => start(async () => {
    setError(null);
    setResult(null);
    try {
      const res = await processSelectedDocuments([...selected]);
      setResult(res);
      // Processed documents leave the "unprocessed" pool this view reads
      // from — drop them locally so the list reflects reality without a
      // full reload; budget_blocked/failed ones stay, selectable again.
      const doneIds = new Set(res.perDocument.filter((d) => d.outcome === 'succeeded').map((d) => d.documentId));
      setTriage((prev) => ({
        ...prev,
        do_not_process: prev.do_not_process.filter((d) => !doneIds.has(d.id)),
        needs_selection: prev.needs_selection.filter((d) => !doneIds.has(d.id)),
        candidate: prev.candidate.filter((d) => !doneIds.has(d.id)),
      }));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorSave);
    }
  });

  // Demo Safety Gate hardening: TRIAGE_PAGE_SIZE (200) is a page size, not a
  // silent cap — a backlog bigger than that must stay reachable, not
  // invisible. Appends the next page's groups onto the current ones rather
  // than replacing them.
  const loadMore = () => startLoadMore(async () => {
    setError(null);
    try {
      const next = await getDataInboxTriage(triage.offset + triage.shown);
      setTriage((prev) => ({
        do_not_process: [...prev.do_not_process, ...next.do_not_process],
        needs_selection: [...prev.needs_selection, ...next.needs_selection],
        candidate: [...prev.candidate, ...next.candidate],
        totalUnprocessed: next.totalUnprocessed,
        shown: prev.shown + next.shown,
        offset: prev.offset,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.errorSave);
    }
  });

  const total = triage.do_not_process.length + triage.needs_selection.length + triage.candidate.length;
  const remaining = triage.totalUnprocessed - triage.shown;

  return (
    <section className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">Data Inbox</p>
      <p className="mt-1.5 max-w-2xl text-[10px] leading-[1.5] text-sk-muted">{labels.help}</p>

      {total === 0 ? (
        <p className="mt-4 py-6 text-center text-[11px] text-sk-muted">{labels.empty}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <Group
            title={labels.groupCandidate} description={labels.groupCandidateD}
            docs={triage.candidate} selectable selected={selected} onToggle={toggle} reasonLabels={labels.reasons} duplicateOfLabel={labels.duplicateOf}
          />
          <Group
            title={labels.groupNeedsSelection} description={labels.groupNeedsSelectionD}
            docs={triage.needs_selection} selectable selected={selected} onToggle={toggle} reasonLabels={labels.reasons} duplicateOfLabel={labels.duplicateOf}
          />
          <Group
            title={labels.groupDoNotProcess} description={labels.groupDoNotProcessD}
            docs={triage.do_not_process} selectable={false} selected={selected} onToggle={toggle} reasonLabels={labels.reasons} duplicateOfLabel={labels.duplicateOf}
          />
        </div>
      )}

      {triage.totalUnprocessed > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="font-mono text-[9px] text-sk-muted">
            {labels.showingCount.replace('{shown}', String(triage.shown)).replace('{total}', String(triage.totalUnprocessed))}
          </p>
          {remaining > 0 && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={loadMore}
              className="min-h-9 cursor-pointer rounded-full border border-line2 px-2.5 py-1 text-[10px] font-semibold text-sk-ink hover:bg-sk-surface-soft disabled:opacity-50"
            >
              {loadingMore ? labels.loading : labels.loadMore.replace('{n}', String(Math.min(remaining, triagePageSize)))}
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line2 pt-3.5">
        <p className="font-mono text-[10px] text-sk-muted">
          {labels.selectedCount.replace('{n}', String(selected.size)).replace('{max}', String(pilotMaxDocs))}
        </p>
        <button
          type="button"
          disabled={selected.size === 0 || pending}
          onClick={run}
          className="min-h-11 cursor-pointer rounded-full bg-sage px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? labels.processing : labels.processSelected.replace('{max}', String(pilotMaxDocs))}
        </button>
      </div>
      <p className="mt-2 font-mono text-[9px] text-sk-muted">
        {labels.budgetNote.replace('{pilot}', String(pilotBudgetUsd)).replace('{total}', String(demoBudgetUsd))}
      </p>

      {error && <p role="alert" className="mt-3 text-[11px] font-semibold text-coral">{error}</p>}

      {result && (
        <div role="status" className="mt-3 rounded-[10px] border border-line2 bg-sk-surface-soft p-3">
          <p className="text-[10px] font-[650] text-sk-ink">{labels.resultTitle}</p>
          <ul className="mt-1.5 space-y-1">
            {result.perDocument.map((d) => (
              <li key={d.documentId} className="flex items-center gap-2 text-[10px]">
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-[650] ${
                  d.outcome === 'succeeded' ? 'bg-sk-green-soft-strong text-sk-green'
                  : d.outcome === 'budget_blocked' ? 'bg-sk-amber-halo text-sk-amber'
                  : 'bg-coral/15 text-coral'
                }`}
                >
                  {d.outcome === 'succeeded' ? labels.outcomeSucceeded
                    : d.outcome === 'budget_blocked' ? labels.outcomeBudgetBlocked
                    : labels.outcomeFailed}
                </span>
                <span className="truncate text-sk-muted">{d.detail ?? d.documentId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
