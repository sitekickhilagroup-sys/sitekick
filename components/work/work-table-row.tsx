'use client';

import { useState } from 'react';
import type { Task } from '@/lib/types';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';
import { RelationEditor, type RelationRow } from './relation-editor';

interface Props {
  task: Task;
  labels: Record<string, string>;
  relations?: RelationRow[];
  taskOptions?: { id: string; title: string }[];
  /** LA-today (YYYY-MM-DD); enables the Now/Overdue due chip. */
  today?: string;
  /** Today view's clear numeric rank (spec §ז). */
  rank?: number;
  /** Derived "why this ranks now" one-liner (spec §ט). */
  whyNow?: string | null;
  /** Titles of open tasks this one verifiably blocks (spec §ט). */
  unlocks?: string[];
  /** Canonical phase this task maps to (stage_phase_map). */
  phaseLabel?: string | null;
  /** Legacy stage tag shown under the phase — her "sub-stage" line. */
  stageLabel?: string | null;
  /** Project page link target for "Open project". */
  projectHref?: string | null;
}

// Her My Work table row: What must move | Phase / sub-stage | Owner /
// waiting on | Due | Status & update — with an explicit Details toggle.
// Below lg everything stacks; the columns only exist on wide screens.
export function WorkTableRow({ task, labels, relations, taskOptions, today, rank, whyNow, unlocks, phaseLabel, stageLabel, projectHref }: Props) {
  const [open, setOpen] = useState(false);
  const dueState = task.due && today
    ? task.due < today ? 'overdue' : task.due === today ? 'now' : 'future'
    : task.due ? 'future' : null;
  const blocking = task.priority === 'critical';

  // Her task-context derivations — verified relationships only; anything
  // unverified is presented as a suggestion, never as fact.
  const verifiedRel = (relations ?? []).find((r) => r.rel.verified_by || r.rel.manual_override);
  const relationText = verifiedRel
    ? `${labels['rel.type.' + verifiedRel.rel.type] ?? verifiedRel.rel.type}: ${verifiedRel.rel.reason || verifiedRel.otherTitle}`
    : labels.noRel;
  const blocksTitle = (relations ?? []).find(
    (r) => r.direction === 'from' && r.rel.type === 'blocks' && (r.rel.verified_by || r.rel.manual_override),
  )?.otherTitle ?? null;
  const confidence = verifiedRel
    ? verifiedRel.rel.confidence >= 0.8 ? labels.confHigh : verifiedRel.rel.confidence >= 0.5 ? labels.confMed : labels.confLow
    : labels.confLow;
  const recommendation = task.waiting_for
    ? (labels.recWaiting ?? '').replace('{who}', task.waiting_for)
    : blocking ? labels.recBlocking : labels.recComplete;

  return (
    <li className="border-b border-line2 px-3 py-3 last:border-b-0">
      <div className="grid gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1.1fr)] lg:items-start">
        {/* What must move — her .action-name: a state dot (red halo when
            blocking) beside the title. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
            blocking ? 'bg-coral shadow-[0_0_0_4px_var(--color-coral-soft)]' : 'bg-line'
          }`} />
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              {rank != null && (
                <span className="font-mono text-xs font-medium text-sage">{String(rank).padStart(2, '0')}</span>
              )}
              <span className="min-w-0 text-sm font-medium text-ink">{task.title}</span>
            </span>
            {task.source && <span className="mt-0.5 block truncate text-[11px] text-ink3">{task.source}</span>}
          </span>
        </div>

        {/* Phase / sub-stage */}
        <div className="min-w-0 text-xs">
          {phaseLabel && <p className="text-ink2">{phaseLabel}</p>}
          {stageLabel && <p className="truncate text-ink3">{stageLabel}</p>}
        </div>

        {/* Owner / waiting on */}
        <div className="min-w-0 text-xs">
          {task.owner && <p className="truncate text-ink2">{task.owner}</p>}
          <div className="mt-0.5">
            <WaitingEditor taskId={task.id} value={task.waiting_for} label={labels.waiting}
              editTitle={labels.editWaiting} saveLabel={labels.save} cancelLabel={labels.cancel} errorLabel={labels.errorSave} />
          </div>
        </div>

        {/* Due */}
        <div>
          {dueState === 'overdue' && (
            <span className="rounded-full bg-coral-soft px-2 py-0.5 font-mono text-[11px] text-coral">{labels.dueOverdue ?? task.due}</span>
          )}
          {dueState === 'now' && (
            <span className="rounded-full bg-apricot-soft px-2 py-0.5 font-mono text-[11px] text-apricot">{labels.dueNow ?? task.due}</span>
          )}
          {dueState === 'future' && (
            <span className="whitespace-nowrap font-mono text-xs text-ink2">{task.due}</span>
          )}
        </div>

        {/* Status & update */}
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {blocking && labels.blocking && (
            <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-coral">
              {labels.blocking}
            </span>
          )}
          <VerbMenu taskId={task.id} labels={labels} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="min-h-11 cursor-pointer rounded-full px-2 py-0.5 text-xs text-ink3 hover:text-ink sm:min-h-7"
          >
            {labels.details} <span aria-hidden="true" className={`inline-block transition-transform ${open ? 'rotate-90' : ''} rtl:-scale-x-100`}>›</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-line2 pt-3 text-xs text-ink2">
          {task.description && <p className="mb-2">{task.description}</p>}
          {/* Her .context-grid: EVIDENCE / RELATIONSHIP / RECOMMENDED NEXT MOVE. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.evidence}</p>
              <p className="mt-1">{task.source ?? labels.noEvidence}{whyNow ? ` · ${whyNow}` : ''}</p>
            </section>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.relationship}</p>
              <p className="mt-1">{relationText}</p>
            </section>
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.recommended}</p>
              <p className="mt-1">{recommendation}</p>
            </section>
          </div>
          {/* Her .dependency-line: BLOCKS / AFFECTS → UNLOCKS + confidence. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-card2 px-3 py-2.5">
            <span>
              <span className="block text-[9px] font-semibold uppercase tracking-wide text-ink3">{labels.blocksAffects}</span>
              <span className="mt-0.5 block font-medium text-ink">{blocksTitle ?? labels.needsVerification}</span>
            </span>
            <span aria-hidden="true" className="text-ink3 rtl:-scale-x-100">→</span>
            <span>
              <span className="block text-[9px] font-semibold uppercase tracking-wide text-ink3">{labels.unlocks}</span>
              <span className="mt-0.5 block font-medium text-ink">
                {unlocks && unlocks.length > 0 ? unlocks.join(' · ') : labels.noUnlocks}
              </span>
            </span>
            <em className="ms-auto not-italic text-[10px] text-ink3">{confidence}</em>
          </div>
          <div className="mt-3">
            <RelationEditor taskId={task.id} relations={relations ?? []} taskOptions={taskOptions ?? []} labels={labels} />
          </div>
          {projectHref && (
            <a href={projectHref} className="mt-2 inline-flex min-h-11 items-center text-xs text-mist hover:underline sm:min-h-0">
              {labels.openProject} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
            </a>
          )}
        </div>
      )}
    </li>
  );
}
