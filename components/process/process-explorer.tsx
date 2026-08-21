'use client';

import { useState } from 'react';
import { SubstageRow } from './substage-row';
import type { ProjectSubstage, SubstageTemplate, Workstream } from '@/lib/types';

export interface ExplorerPhase {
  key: string;
  label: string;
  /** Localized: Current focus / Active in parallel / Done / Not started */
  state: string;
  isCurrent: boolean;
  isParallel: boolean;
  substages: { template: SubstageTemplate; instance: ProjectSubstage | null }[];
  unactivated: SubstageTemplate[];
  workstreams: Workstream[];
}

interface Props {
  projectId: string;
  phases: ExplorerPhase[];
  labels: Record<string, string>;
}

// Client-demo master-detail: vertical numbered phase rail on the start side,
// the selected phase's sub-stages on the other. Mobile stacks rail then detail.
export function ProcessExplorer({ projectId, phases, labels }: Props) {
  const current = phases.find((p) => p.isCurrent)?.key ?? phases[0]?.key;
  const [selectedKey, setSelectedKey] = useState(current);
  const selected = phases.find((p) => p.key === selectedKey) ?? phases[0];

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
        {phases.map((p, i) => {
          const active = p.key === selectedKey;
          return (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => setSelectedKey(p.key)}
                aria-current={p.isCurrent ? 'step' : undefined}
                aria-expanded={active}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-(--radius-card) border px-3 py-2 text-start transition-colors ${
                  active ? 'border-sage-line bg-card shadow-card' : 'border-line bg-card2 hover:bg-card'
                }`}
              >
                <span className={`font-mono text-xs ${p.isCurrent ? 'text-sage' : p.isParallel ? 'text-mist' : 'text-ink3'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${active ? 'font-medium text-ink' : 'text-ink2'}`}>{p.label}</span>
                  <span className={`block text-[11px] ${
                    p.isCurrent ? 'text-sage' : p.isParallel ? 'text-mist' : 'text-ink3'
                  }`}>{p.state}</span>
                </span>
                {p.substages.length > 0 && (
                  <span className="font-mono text-[11px] text-ink3">
                    {p.substages.filter((s) => s.instance?.status === 'done').length}/{p.substages.length}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
            selected.isCurrent ? 'bg-sage text-white' : 'bg-card2 text-ink3'
          }`}>
            {selected.label}
          </span>
          <span className="text-[11px] text-ink3">{selected.state}</span>
          {selected.workstreams.map((w) => (
            <span key={w.id} className="rounded-full bg-mist-soft px-2 py-0.5 text-[11px] text-mist">
              {labels.parallel}: {w.name}
            </span>
          ))}
        </div>

        <div className="mt-3">
          {selected.substages.length === 0 ? (
            <p className="text-xs text-ink3">{labels.emptyPhase}</p>
          ) : (
            <ul>
              {selected.substages.map(({ template, instance }) => (
                <SubstageRow key={template.id} projectId={projectId} template={template} instance={instance} labels={labels} />
              ))}
            </ul>
          )}
        </div>

        {selected.unactivated.length > 0 && (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-1 text-xs text-ink3 hover:text-ink sm:min-h-0">{labels.activate}</summary>
            <ul className="mt-1">
              {selected.unactivated.map((template) => (
                <SubstageRow key={template.id} projectId={projectId} template={template} instance={null} labels={labels} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
