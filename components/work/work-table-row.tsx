'use client';

import { useState } from 'react';
import type { Task } from '@/lib/types';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';
import { RelationEditor, type RelationRow } from './relation-editor';

/**
 * Spec §9 column proportions: What must move | Phase / sub-stage |
 * Owner / waiting on | Due | Status & update.
 *
 * Exported because the header row in work/page.tsx and every data row here
 * must stay in lockstep — they were two separate literals before, which is a
 * silent misalignment waiting to happen.
 */
export const WORK_COLS =
  'lg:grid-cols-[minmax(240px,2.2fr)_minmax(130px,1.15fr)_minmax(150px,1.25fr)_minmax(70px,0.55fr)_minmax(120px,0.9fr)]';

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
      <div className={`grid gap-x-4 gap-y-2 ${WORK_COLS} lg:items-start`}>
        {/* What must move — her .action-name: a state dot (red halo when
            blocking) beside the title. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
            blocking ? 'bg-coral shadow-[0_0_0_4px_var(--color-coral-soft)]' : 'bg-line'
          }`} />
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              {rank != null && (
                <span className="font-mono text-[11px] font-medium text-sage">{String(rank).padStart(2, '0')}</span>
              )}
              <span className="min-w-0 text-[11px] font-[650] leading-[1.4] text-sk-ink">{task.title}</span>
            </span>
            {task.source && <span className="mt-0.5 block truncate text-[10px] text-sk-muted">{task.source}</span>}
          </span>
        </div>

        {/* Phase / sub-stage. The column headers are hidden below lg, so each
            cell names itself there — spec §15 wants labelled mobile fields. */}
        <div className="min-w-0 text-[10px]">
          <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-sk-muted-light lg:hidden">
            {labels.colPhase}
          </span>
          {phaseLabel && <p className="text-sk-text">{phaseLabel}</p>}
          {stageLabel && <p className="truncate text-sk-muted">{stageLabel}</p>}
        </div>

        {/* Owner / waiting on */}
        <div className="min-w-0 text-[10px]">
          <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-sk-muted-light lg:hidden">
            {labels.colOwner}
          </span>
          {task.owner && <p className="truncate text-sk-text">{task.owner}</p>}
          <div className="mt-0.5">
            <WaitingEditor taskId={task.id} value={task.waiting_for} label={labels.waiting}
              editTitle={labels.editWaiting} saveLabel={labels.save} cancelLabel={labels.cancel} errorLabel={labels.errorSave} />
          </div>
        </div>

        {/* Due */}
        <div>
          <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-sk-muted-light lg:hidden">
            {labels.colDue}
          </span>
          {dueState === 'overdue' && (
            <span className="rounded-[6px] bg-sk-salmon px-2 py-0.5 font-mono text-[10px] text-sk-salmon-text">{labels.dueOverdue ?? task.due}</span>
          )}
          {dueState === 'now' && (
            <span className="rounded-[6px] bg-sk-amber-halo px-2 py-0.5 font-mono text-[10px] text-sk-amber">{labels.dueNow ?? task.due}</span>
          )}
          {dueState === 'future' && (
            <span className="whitespace-nowrap font-mono text-[10px] text-sk-text">{task.due}</span>
          )}
        </div>

        {/* Status & update. Spec §10 asks for varied treatments rather than one
            red BLOCKING on everything — but TaskStatus is only open/done/dropped,
            so Verify, In Progress and With the City have no source here. Only
            what the data actually proves is rendered. */}
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {blocking && labels.blocking && (
            <span className="rounded-[6px] bg-sk-salmon px-2 py-1 text-[9px] font-[650] uppercase tracking-[0.06em] leading-none text-sk-salmon-text">
              {labels.blocking}
            </span>
          )}
          {!blocking && task.waiting_for && labels.waiting && (
            <span className="rounded-[6px] bg-sk-blue-soft px-2 py-1 text-[9px] font-[650] uppercase tracking-[0.06em] leading-none text-sk-blue">
              {labels.waiting}
            </span>
          )}
          <VerbMenu taskId={task.id} labels={labels} />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="min-h-11 cursor-pointer rounded-[6px] border border-sage-line px-2 py-1 text-[9px] font-[650] leading-none text-sage hover:bg-sk-green-soft sm:min-h-7"
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
