'use client';

import { useState, useTransition } from 'react';
import { acceptProposal, rejectProposal } from '@/app/actions/proposals';
import type { AgentProposal } from '@/lib/types';

interface Labels { accept: string; reject: string; confidence: string; typeLabel: string; error: string }

export function ProposalCard({ proposal, projectName, taskTitle, labels, summaryOverride }: {
  proposal: AgentProposal; projectName: string | null; taskTitle: string | null; labels: Labels;
  summaryOverride?: string | null;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const act = (fn: (id: string) => Promise<{ ok?: true; error?: string }>) => start(async () => {
    setFailed(false);
    const res = await fn(proposal.id);
    if (res?.error) setFailed(true);
  });
  const pay = proposal.payload as Record<string, unknown>;
  const arrow = <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>;
  // relationship_create payloads describe an edge between two tasks rather
  // than a single field — show it as "from → to" instead of the generic chain.
  const computedSummary: React.ReactNode = pay.from_match && pay.to_match
    ? <>{String(pay.from_match)} {arrow} {String(pay.to_match)}</>
    : String(pay.phase_key ?? pay.title ?? pay.what ?? pay.task_match ?? '');
  const summary = summaryOverride ?? computedSummary;
  return (
    <li className={`rounded-(--radius-card) border border-line bg-card p-4 shadow-card ${pending ? 'opacity-40' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-apricot-soft px-2 py-0.5 text-[11px] text-apricot">{labels.typeLabel}</span>
        {projectName && <span className="text-xs font-medium text-ink2">{projectName}</span>}
        <span className="ms-auto text-[11px] text-ink3">{labels.confidence}: {Math.round(proposal.confidence * 100)}%</span>
      </div>
      <p className="mt-2 text-sm text-ink">{summary || taskTitle}</p>
      {taskTitle && summary && <p className="mt-0.5 text-xs text-ink3">{arrow} {taskTitle}</p>}
      {proposal.reasoning && <p className="mt-1 text-xs text-ink3">{proposal.reasoning}</p>}
      {typeof pay.evidence === 'string' && pay.evidence && <p className="mt-1 border-s-2 border-line ps-2 text-xs italic text-ink3">{pay.evidence}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={pending} onClick={() => act(acceptProposal)}
          className="min-h-11 rounded-lg bg-sage px-3 py-1.5 text-sm text-white disabled:opacity-50 sm:min-h-0">{labels.accept}</button>
        <button type="button" disabled={pending} onClick={() => act(rejectProposal)}
          className="min-h-11 rounded-lg border border-line px-3 py-1.5 text-sm text-ink2 disabled:opacity-50 sm:min-h-0">{labels.reject}</button>
        {failed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
      </div>
    </li>
  );
}
