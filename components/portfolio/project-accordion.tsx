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
  const stateClass =
    riskState === 'on_hold' || riskState === 'at_risk'
      ? 'bg-coral-soft text-coral'
      : riskState === 'waiting' ? 'bg-apricot-soft text-apricot' : 'bg-sage-soft text-sage';

  return (
    <article className="rounded-(--radius-card) border border-line bg-card shadow-card">
      {/* Whole header toggles the body (row = tap target); the name link and
          chevron stop propagation / act on their own. */}
      <div
        className="flex cursor-pointer flex-wrap items-center gap-2 p-4"
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className="text-[15px] font-semibold text-ink">
          <Link
            href={`/projects/${project.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-11 items-center hover:underline sm:min-h-0"
          >
            {project.name}
          </Link>
        </h3>

        {project.city_case && (
          <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
            project.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-inset text-ink3'
          }`}>
            {project.city_case}{project.city_on_hold ? ` · ${labels.onHold}` : ''}
          </span>
        )}

        {currentPhaseLabel && (
          <span className="rounded-full bg-sage px-2.5 py-1 text-xs font-medium text-white">
            {currentPhaseLabel}
          </span>
        )}

        {workstreams.map((w) => (
          <span key={w.id} className="rounded-full bg-mist-soft px-2 py-0.5 text-[11px] text-mist">
            {w.name}
          </span>
        ))}

        <span className="ms-auto flex items-center gap-1.5">
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${stateClass}`}>
            {stateLabel}
          </span>
          {blockingCount > 0 && (
            <span className="whitespace-nowrap rounded-full bg-coral-soft px-2 py-0.5 text-xs text-coral">
              {labels.blockingN.replace('{n}', String(blockingCount))}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full text-ink2 hover:text-ink sm:min-h-9 sm:min-w-9"
        >
          <span className={`inline-block transition-transform rtl:-scale-x-100 ${open ? 'rotate-90' : ''}`}>▸</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-line2 p-4 pt-3">
          {/* Numbered 01-05 phase rail — current phase in sage, phases lit by an
              active parallel workstream in mist, everything else quiet. */}
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink3">{labels.position}</p>
          <ol className="mb-3 flex flex-wrap gap-1.5">
            {labels.phases.map((ph, i) => {
              const isCurrent = project.current_phase_key === ph.key;
              const isParallel = !isCurrent && parallelPhaseKeys.includes(ph.key);
              return (
                <li
                  key={ph.key}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    isCurrent ? 'bg-sage text-white'
                    : isParallel ? 'bg-mist-soft text-mist'
                    : 'bg-card2 text-ink3'
                  }`}
                >
                  <span className="font-mono">{String(i + 1).padStart(2, '0')}</span>
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
          </div>
          {lastEvidence && (
            <p className="mt-2 text-[11px] text-ink3">
              {labels.evidence.replace('{date}', '')}<bdi>{lastEvidence}</bdi>
            </p>
          )}
          <Link
            href={`/projects/${project.id}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm text-mist hover:underline sm:min-h-0"
          >
            {labels.investigate} <span aria-hidden="true" className="ms-1 inline-block rtl:-scale-x-100">→</span>
          </Link>
        </div>
      )}
    </article>
  );
}
