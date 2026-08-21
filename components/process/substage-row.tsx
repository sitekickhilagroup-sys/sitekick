'use client';

import { useState, useTransition } from 'react';
import { activateSubstage, setSubstageStatus } from '@/app/actions/process';
import type { ProjectSubstage, ProjectSubstageStatus, SubstageTemplate } from '@/lib/types';

interface Props {
  projectId: string;
  template: SubstageTemplate;
  instance: ProjectSubstage | null;
  labels: Record<string, string>;
}

// Noa's full sub-stage lifecycle (spec §ג). Order mirrors her list.
const STATUSES: ProjectSubstageStatus[] = [
  'upcoming', 'active', 'waiting', 'blocked', 'verify', 'submitted', 'with_city', 'done', 'not_applicable',
];

// Spec §טז color semantics: green = progress/completed, blue = waiting on an
// external party (incl. submitted / with the city), red = blocked, amber =
// verify, gray = upcoming / not applicable.
const STATUS_CLASS: Record<ProjectSubstageStatus, string> = {
  done: 'bg-sage text-white',
  active: 'bg-sage-soft text-sage',
  waiting: 'bg-mist-soft text-mist',
  submitted: 'bg-mist-soft text-mist',
  with_city: 'bg-mist-soft text-mist',
  blocked: 'bg-coral-soft text-coral',
  verify: 'bg-apricot-soft text-apricot',
  upcoming: 'bg-card2 text-ink3',
  not_applicable: 'bg-card2 text-ink3',
};

// Unactivated template -> one-tap activate. Activated instance -> a status
// select covering the full lifecycle (a select, not a button cycle — with 9
// states cycling would bury half of them).
export function SubstageRow({ projectId, template, instance, labels }: Props) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const status: ProjectSubstageStatus = instance?.status ?? 'upcoming';

  const activate = () => start(async () => {
    setFailed(false);
    const res = await activateSubstage(projectId, template.id, null);
    if (res?.error) setFailed(true);
  });

  const setStatus = (next: ProjectSubstageStatus) => start(async () => {
    if (!instance || next === status) return;
    setFailed(false);
    const res = await setSubstageStatus(projectId, instance.id, next);
    if (res?.error) setFailed(true);
  });

  return (
    <li className={`flex flex-wrap items-center gap-2 border-b border-line2 px-1 py-1.5 last:border-b-0 ${pending ? 'opacity-40' : ''}`}>
      <span className="min-w-0 flex-1 text-sm text-ink">{template.name}</span>
      {!instance ? (
        <button
          type="button"
          disabled={pending}
          onClick={activate}
          aria-label={`${template.name}: ${labels['status.upcoming']}`}
          className="min-h-11 cursor-pointer whitespace-nowrap rounded-full bg-card2 px-2.5 py-1 text-xs text-ink3 ring-line transition-shadow hover:ring-2 disabled:opacity-50 sm:min-h-0"
        >
          {labels['status.upcoming']}
        </button>
      ) : (
        <select
          disabled={pending}
          value={status}
          onChange={(e) => setStatus(e.target.value as ProjectSubstageStatus)}
          aria-label={`${template.name}: ${labels['status.' + status]}`}
          className={`min-h-11 cursor-pointer appearance-none rounded-full border-0 px-2.5 py-1 text-xs outline-none disabled:opacity-50 sm:min-h-0 ${STATUS_CLASS[status]}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{labels['status.' + s]}</option>
          ))}
        </select>
      )}
      {failed && <span role="alert" className="w-full text-[11px] text-coral">{labels.error}</span>}
    </li>
  );
}
