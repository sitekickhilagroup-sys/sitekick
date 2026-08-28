'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PortfolioEntry } from '@/lib/queries';
import { fmtDate } from '@/lib/format';

export interface AccordionLabels {
  onHold: string;
  onTrack: string;
  atRisk: string;
  waiting: string;
  position: string;
  blockingN: string;
  evidence: string;
  next: string;
  then: string;
  blocker: string;
  /** Used instead of `blocker` when the headline is only a workstream or
   *  external-gate fallback — the audit forbids calling those project-wide. */
  blockerWorkstream: string;
  blockerExternal: string;
  blockerTechnical: string;
  waitingN: string;
  verifyN: string;
  investigate: string;
  none: string;
  expand: string;
  collapse: string;
  primaryPhase: string;
  parallelWs: string;
  /** phase key -> localized label, in canonical order */
  phases: { key: string; label: string }[];
}

interface Props {
  entry: PortfolioEntry;
  defaultOpen: boolean;
  labels: AccordionLabels;
}

// One project's status card on the portfolio overview (Sprint C Task 5).
// Header (name, city case, phase, workstreams, on-hold/on-track) always
// shows; body collapses to next action + main blocker + a link into the
// full process page. Mirrors the process page's own city_case chip copy
// and PhaseColumn's phase/workstream chip colors for visual continuity.
export function ProjectAccordion({ entry, defaultOpen, labels }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const {
    project, currentPhaseLabel, workstreams, mainBlocker, primaryBlockerKind,
    technicalBlocker, nextAction, thenAction, blockingCount, blockerCounts,
    lastEvidence, parallelPhaseKeys, riskState,
  } = entry;
  // Blocker audit: a fallback headline must say what it actually is. Only a
  // true primary blocker may read as the project's main blocker.
  const blockerHeading =
    primaryBlockerKind === 'workstream' ? labels.blockerWorkstream
    : primaryBlockerKind === 'external_gate' ? labels.blockerExternal
    : labels.blocker;
  const stateLabel =
    riskState === 'on_hold' ? labels.onHold
    : riskState === 'at_risk' ? labels.atRisk
    : riskState === 'waiting' ? labels.waiting
    : labels.onTrack;
  // Spec §טז color semantics: red = verified blocker, blue = waiting on an
  // external party, green = on track.
  const stateClass =
    riskState === 'on_hold' || riskState === 'at_risk'
      ? 'bg-coral-soft text-coral'
      : riskState === 'waiting' ? 'bg-mist-soft text-mist' : 'bg-sage-soft text-sage';

  // Her .health-dot semantics on the trigger.
  const dotClass =
    riskState === 'on_hold' || riskState === 'at_risk' ? 'bg-coral shadow-[0_0_0_4px_var(--color-coral-soft)]'
    : riskState === 'waiting' ? 'bg-mist shadow-[0_0_0_4px_var(--color-mist-soft)]'
    : 'bg-sage shadow-[0_0_0_4px_var(--color-sage-soft)]';

  return (
    <article className={`overflow-hidden rounded-[12px] border transition-colors ${
      open ? 'border-sage-line bg-card shadow-card' : 'border-line bg-card2/50'
    }`}>
      {/* Her .project-drop-trigger grid: dot | name+case | position | state chip | ± */}
      <div
        className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto_22px] items-center gap-3 px-4 py-3 sm:grid-cols-[16px_minmax(0,1fr)_110px_auto_22px]"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
        <h3 className="min-w-0">
          <Link
            href={`/projects/${project.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-[14px] font-[650] leading-[1.25] text-sk-ink hover:underline"
          >
            {project.name}
          </Link>
          {project.city_case && (
            <span className="block truncate font-mono text-[10px] text-ink3">
              {project.city_case}{project.city_on_hold ? ` · ${labels.onHold}` : ''}
            </span>
          )}
        </h3>
        <span className="hidden min-w-0 sm:block">
          <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.position}</span>
          <span className="mt-0.5 block truncate text-[11px] font-[650] text-sk-ink">{currentPhaseLabel ?? '—'}</span>
        </span>
        <span className={`justify-self-end whitespace-nowrap rounded-[10px] px-2 py-1 text-center text-[10px] ${stateClass}`}>
          {stateLabel}{blockingCount > 0 ? ` · ${labels.blockingN.replace('{n}', String(blockingCount))}` : ''}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center text-[16px] font-[650] leading-none text-sage sm:min-h-0 sm:min-w-0"
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {/* Body stays mounted so the grid-rows collapse can animate both ways
          (open and close); inert keeps its links out of the tab order and
          screen readers while collapsed. */}
      <div
        inert={open ? undefined : true}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line2 p-4 pt-3">
          {project.summary && (
            <p className="max-w-3xl text-xs leading-relaxed text-ink2">{project.summary}</p>
          )}

          {/* .portfolio-story: three equal boxes, not stacked rows. */}
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-[11px] border border-line bg-sk-surface-soft p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.next}</p>
              <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-ink">
                {nextAction ? nextAction.title : labels.none}
              </p>
            </div>
            <div className="rounded-[11px] border border-line bg-sk-surface-soft p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{blockerHeading}</p>
              <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-ink">
                {mainBlocker ? `${mainBlocker.what} · ${mainBlocker.blocked_by}` : labels.none}
              </p>
              {/* Two independently blocked workstreams show separately. */}
              {technicalBlocker && (
                <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] leading-[1.5] text-sk-muted">
                  <span className="font-[650] text-sk-ink">{labels.blockerTechnical}: </span>
                  {technicalBlocker.what}
                </p>
              )}
            </div>
            <div className="rounded-[11px] border border-line bg-sk-surface-soft p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.then}</p>
              <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-ink">
                {thenAction ? thenAction.title : labels.none}
              </p>
            </div>
          </div>

          {/* External waits and unverified items get their own labels — the
              audit forbids folding either into the blocker count. */}
          {(blockerCounts.waiting > 0 || blockerCounts.verify > 0) && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-[0.12em]">
              {blockerCounts.waiting > 0 && (
                <span className="text-sk-blue">{labels.waitingN.replace('{n}', `⁨${blockerCounts.waiting}⁩`)}</span>
              )}
              {blockerCounts.verify > 0 && (
                <span className="text-sk-amber">{labels.verifyN.replace('{n}', `⁨${blockerCounts.verify}⁩`)}</span>
              )}
            </p>
          )}

          {/* .project-position: one tinted strip, the two tracks joined by +. */}
          <div className="mt-4 flex items-center gap-2.5 rounded-[8px] bg-sk-surface-soft p-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.primaryPhase}</span>
              <span className="mt-1 block truncate text-[11px] font-[650] text-sk-ink">{currentPhaseLabel ?? '—'}</span>
            </span>
            <span aria-hidden="true" className="text-[13px] text-sk-muted-light">+</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.parallelWs}</span>
              <span className="mt-1 block truncate text-[11px] font-[650] text-sk-ink">
                {workstreams.length > 0 ? workstreams.map((w) => w.name).join(', ') : labels.none}
              </span>
            </span>
          </div>

          {/* Her .drop-phases rail: 5 top-border strips — sage current,
              apricot parallel, quiet line otherwise. */}
          <ol className="mt-3 grid grid-cols-5 gap-1">
            {labels.phases.map((ph, i) => {
              const isCurrent = project.current_phase_key === ph.key;
              const isParallel = !isCurrent && parallelPhaseKeys.includes(ph.key);
              return (
                <li
                  key={ph.key}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`border-t-[3px] pt-1.5 text-[10px] leading-tight ${
                    isCurrent ? 'border-sage font-semibold text-sage'
                    : isParallel ? 'border-apricot text-apricot'
                    : 'border-line text-ink3'
                  }`}
                >
                  <span className="block font-mono text-[9px]">{String(i + 1).padStart(2, '0')}</span>
                  {ph.label}
                </li>
              );
            })}
          </ol>
          {/* Her .portfolio-actions row: evidence line + solid green button. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line2 pt-3">
            <p className="text-[11px] leading-[1.5] text-sk-muted">
              {lastEvidence ? <>{labels.evidence.replace('{date}', '')}<bdi>{fmtDate(lastEvidence)}</bdi></> : null}
            </p>
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-11 items-center rounded-[8px] bg-sage px-3.5 py-2 text-[10px] font-[650] leading-none text-white hover:opacity-90 sm:min-h-0"
            >
              {labels.investigate} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
            </Link>
          </div>
          </div>
        </div>
      </div>
    </article>
  );
}
