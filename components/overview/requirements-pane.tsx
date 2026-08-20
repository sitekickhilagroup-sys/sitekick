'use client';

import type { StageRequirement } from '@/lib/types';

export interface RailLabels {
  whatWeOwe: string; timeline: string; onUs: string; cityIssues: string;
  statusUnknown: string; doneGroup: string; toFinish: string; completedStage: string;
  ahead: string; alsoActive: string; noRecord: string; needsChecking: string;
  noEvidence: string; onHold: string; onTrack: string; slip: string; progress: string;
  confirmed: string; estimated: string; standardUnconfirmed: string;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

interface PaneProps {
  requirements: StageRequirement[];
  relation: 'past' | 'current' | 'future' | 'also_active';
  labels: RailLabels;
}

// The 3-state pane the client signed off on: On us / The City issues /
// Status unknown / Done — unknown is first-class, never shown as open.
export function RequirementsPane({ requirements, relation, labels }: PaneProps) {
  if (requirements.length === 0) {
    return <p className="px-1 py-3 text-sm text-ink3">{labels.noRecord}</p>;
  }
  const done = requirements.filter((r) => r.state === 'done');
  const pending = requirements.filter((r) => r.state !== 'done');
  const ours = pending.filter((r) => r.who !== 'city' && r.state !== 'unknown');
  const city = pending.filter((r) => r.who === 'city' && r.state !== 'unknown');
  const unknown = pending.filter((r) => r.state === 'unknown');
  const total = requirements.length;
  const unconfirmedStd = pending.filter((r) => r.basis === 'standard').length;

  const header =
    relation === 'past' ? labels.completedStage
    : relation === 'future' ? fill(labels.ahead, { total })
    : relation === 'also_active' ? fill(labels.alsoActive, { done: done.length, total })
    : fill(labels.toFinish, { done: done.length, total });

  const row = (r: StageRequirement) => {
    const mark = r.state === 'done' ? '✓' : r.state === 'unknown' ? '?' : '';
    const evidence = r.state === 'done'
      ? (r.evidence || labels.noEvidence)
      : r.state === 'open'
        ? (r.evidence ?? '')
        : labels.needsChecking;
    return (
      <div
        key={r.id}
        className={`grid grid-cols-[20px_1fr] gap-x-2 rounded-lg px-2 py-1.5 ${
          r.state === 'done' ? 'opacity-70' : r.state === 'unknown' ? 'bg-inset' : ''
        }`}
        title={r.src ?? undefined}
      >
        <span className={`text-center text-sm ${
          r.state === 'done' ? 'text-sage' : r.state === 'unknown' ? 'text-ink3' : 'text-ink3'
        }`}>{mark || '·'}</span>
        <div className="min-w-0">
          <p className="text-sm leading-snug text-ink">{r.text}</p>
          {evidence && <p className="mt-0.5 text-xs text-ink3">{evidence}</p>}
        </div>
      </div>
    );
  };

  const group = (label: string, items: StageRequirement[], accent?: string) =>
    items.length > 0 && (
      <div>
        <p className={`mb-1 mt-3 text-xs font-semibold uppercase tracking-wide ${accent ?? 'text-ink2'}`}>
          {label}
        </p>
        {items.map(row)}
      </div>
    );

  const pct = total ? Math.round((done.length / total) * 100) : 0;

  return (
    <div className={relation === 'future' ? 'opacity-75' : ''}>
      <p className="text-sm font-medium text-ink">{header}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inset">
        <i className="block h-full rounded-full bg-sage" style={{ width: `${pct}%` }} />
      </div>
      {unconfirmedStd > 0 && relation !== 'past' && (
        <p className="mt-2 rounded-lg bg-apricot-soft px-2.5 py-1.5 text-xs text-ink2">
          {fill(labels.standardUnconfirmed, { n: unconfirmedStd })}
        </p>
      )}
      <div className="mt-1">
        {group(fill(labels.onUs, { n: ours.length }), ours)}
        {group(fill(labels.cityIssues, { n: city.length }), city, 'text-mist')}
        {group(fill(labels.statusUnknown, { n: unknown.length }), unknown, 'text-ink3')}
        {group(fill(labels.doneGroup, { n: done.length }), done, 'text-sage')}
      </div>
    </div>
  );
}
