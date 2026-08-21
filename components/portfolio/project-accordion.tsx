'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PortfolioEntry } from '@/lib/queries';

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
    project, currentPhaseLabel, workstreams, mainBlocker, nextAction, thenAction,
    blockingCount, lastEvidence, parallelPhaseKeys, riskState,
  } = entry;
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
            className="block truncate font-serif text-[15px] text-ink hover:underline"
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
          <span className="block text-[8px] font-semibold uppercase tracking-[0.1em] text-ink3">{labels.position}</span>
          <span className="mt-0.5 block truncate text-xs font-semibold text-ink">{currentPhaseLabel ?? '—'}</span>
        </span>
        <span className={`justify-self-end whitespace-nowrap rounded-[10px] px-2 py-1 text-center text-[10px] ${stateClass}`}>
          {stateLabel}{blockingCount > 0 ? ` · ${labels.blockingN.replace('{n}', String(blockingCount))}` : ''}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center font-serif text-lg text-sage sm:min-h-0 sm:min-w-0"
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {open && (
        <div className="border-t border-line2 p-4 pt-3">
          {project.summary && (
            <p className="mb-3 max-w-2xl text-sm leading-relaxed text-ink2">{project.summary}</p>
          )}
          {/* Her .drop-phases rail: 5 top-border strips — sage current,
              apricot parallel, quiet line otherwise. */}
          <ol className="mb-3 grid grid-cols-5 gap-1">
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
          <div className="space-y-2.5 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sage">{labels.next}</p>
              <p className="mt-0.5 text-ink">{nextAction ? nextAction.title : labels.none}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-coral">{labels.blocker}</p>
              <p className="mt-0.5 text-ink">
                {mainBlocker ? `${mainBlocker.what} · ${mainBlocker.blocked_by}` : labels.none}
              </p>
            </div>
            {thenAction && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.then}</p>
                <p className="mt-0.5 text-ink2">{thenAction.title}</p>
              </div>
            )}
            {/* Her PRIMARY PHASE / PARALLEL WORKSTREAM pair above the rail. */}
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              {currentPhaseLabel && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.primaryPhase}</p>
                  <p className="mt-0.5 font-medium text-ink">{currentPhaseLabel}</p>
                </div>
              )}
              {workstreams.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.parallelWs}</p>
                  <p className="mt-0.5 font-medium text-ink">{workstreams.map((w) => w.name).join(', ')}</p>
                </div>
              )}
            </div>
          </div>
          {/* Her .portfolio-actions row: evidence line + solid green button. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line2 pt-3">
            <p className="text-[11px] text-ink3">
              {lastEvidence ? <>{labels.evidence.replace('{date}', '')}<bdi>{lastEvidence}</bdi></> : null}
            </p>
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-11 items-center rounded-[9px] bg-sage px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 sm:min-h-0"
            >
              {labels.investigate} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}
