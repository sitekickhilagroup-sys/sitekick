'use client';

import { useState } from 'react';
import type { Task } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { isBlockingTask } from '@/lib/blockers';
import { WaitingEditor } from '@/components/overview/waiting-editor';
import { VerbMenu } from './verb-menu';
import type { TaskEditorOptions } from './task-editor';
import { RelationEditor, type RelationRow } from './relation-editor';
import { WORK_COLS } from './work-cols';

interface Props {
  task: Task;
  labels: Record<string, string>;
  relations?: RelationRow[];
  taskOptions?: { id: string; title: string }[];
  /** Project/Phase/Sub-stage/Workstream choices for VerbMenu's "Edit
   *  details…" item (A6) — one query batch in work/page.tsx. */
  editorOptions: TaskEditorOptions;
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
  /** Her "sub-stage" line under the phase — resolveTaskSubstageLabel's
   *  result: the linked sub-stage template's own name, falling back to the
   *  legacy stage tag only for a task that predates the 0015 backfill. */
  stageLabel?: string | null;
  /** Project page link target for "Open project". */
  projectHref?: string | null;
  /** C2: this is the row a `/work?...&task=<id>#task-<id>` deep link (from
   *  the process page's "Open register") points at — rings it so landing on
   *  a page of many rows doesn't leave the user hunting for the one that
   *  sent them here. */
  highlight?: boolean;
}

// Her My Work table row: What must move | Phase / sub-stage | Owner /
// waiting on | Due | Status & update — with an explicit Details toggle.
// Below lg everything stacks; the columns only exist on wide screens.
export function WorkTableRow({ task, labels, relations, taskOptions, editorOptions, today, rank, whyNow, unlocks, phaseLabel, stageLabel, projectHref, highlight }: Props) {
  const [open, setOpen] = useState(false);
  const dueState = task.due && today
    ? task.due < today ? 'overdue' : task.due === today ? 'now' : 'future'
    : task.due ? 'future' : null;
  // Impact on process, not urgency. Falls back to priority only while the task
  // is unclassified — see isBlockingTask.
  const blocking = isBlockingTask(task);

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
    // id + scroll-mt-20: the target of a `#task-<id>` deep link — scroll-mt
    // keeps the sticky app header (h-16) from landing on top of the row the
    // native anchor-scroll just brought into view. The ring is a plain
    // box-shadow (ring-inset so the parent's overflow-hidden can never clip
    // it) — visible in both themes via the existing --color-sage token, adds
    // no border/padding so nothing else in the row reflows.
    <li
      id={`task-${task.id}`}
      className={`scroll-mt-20 border-b border-line2 px-3 py-3 last:border-b-0 ${highlight ? 'ring-2 ring-inset ring-sage' : ''}`}
    >
      <div className={`grid gap-x-4 gap-y-2 ${WORK_COLS} lg:items-start`}>
        {/* What must move — her .action-name: a state dot (red halo when
            blocking) beside the title. */}
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
            blocking ? 'bg-coral shadow-[0_0_0_4px_var(--color-coral-soft)]' : 'bg-line'
          }`} />
          <span className="min-w-0">
            {/* Noa round 3, request #1: the sub-stage as a small eyebrow ABOVE
                the task name — the middle column kept it too easy to miss, and
                this line is what ties the register row to the process view at
                a glance. */}
            {stageLabel && (
              <span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-sk-muted-light">
                {stageLabel}
              </span>
            )}
            <span className="flex items-baseline gap-2">
              {rank != null && (
                <span className="font-mono text-[11px] font-medium text-sage">{String(rank).padStart(2, '0')}</span>
              )}
              <span className="min-w-0 text-[11px] font-[650] leading-[1.4] text-sk-ink">{task.title}</span>
            </span>
            {task.latest_note && (
              <span className="mt-0.5 block text-[10px] leading-[1.4] text-sk-muted">“{task.latest_note}”</span>
            )}
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
            <span className="rounded-[6px] bg-sk-salmon px-2 py-0.5 font-mono text-[10px] text-sk-salmon-text">{labels.dueOverdue ?? fmtDate(task.due)}</span>
          )}
          {dueState === 'now' && (
            <span className="rounded-[6px] bg-sk-amber-halo px-2 py-0.5 font-mono text-[10px] text-sk-amber">{labels.dueNow ?? fmtDate(task.due)}</span>
          )}
          {dueState === 'future' && (
            <span className="whitespace-nowrap font-mono text-[10px] text-sk-text">{fmtDate(task.due)}</span>
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
          <VerbMenu taskId={task.id} task={task} editorOptions={editorOptions} labels={labels} />
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
