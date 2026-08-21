'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PortfolioEntry } from '@/lib/queries';

export interface AccordionLabels {
  onHold: string;
  onTrack: string;
  next: string;
  blocker: string;
  investigate: string;
  none: string;
  expand: string;
  collapse: string;
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
  const { project, currentPhaseLabel, workstreams, mainBlocker, nextAction } = entry;

  return (
    <article className="rounded-(--radius-card) border border-line bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-2 p-4">
        <h3 className="text-[15px] font-semibold text-ink">
          <Link
            href={`/projects/${project.id}`}
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

        <span className={`ms-auto whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
          project.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-sage-soft text-sage'
        }`}>
          {project.city_on_hold ? labels.onHold : labels.onTrack}
        </span>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? labels.collapse : labels.expand}
          className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full text-ink2 hover:text-ink sm:min-h-9 sm:min-w-9"
        >
          <span className={`inline-block transition-transform rtl:-scale-x-100 ${open ? 'rotate-90' : ''}`}>▸</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-line2 p-4 pt-3">
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-ink2">{labels.next}:</span>{' '}
              <span className="text-ink">{nextAction ? nextAction.title : labels.none}</span>
            </p>
            <p>
              <span className="font-medium text-ink2">{labels.blocker}:</span>{' '}
              <span className="text-ink">
                {mainBlocker ? `${mainBlocker.what} · ${mainBlocker.blocked_by}` : labels.none}
              </span>
            </p>
          </div>
          <Link
            href={`/projects/${project.id}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm text-mist hover:underline sm:min-h-0"
          >
            {labels.investigate} →
          </Link>
        </div>
      )}
    </article>
  );
}
