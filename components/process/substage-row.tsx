'use client';

import { useState, useTransition } from 'react';
import { activateSubstage, setSubstageStatus } from '@/app/actions/process';
import type { ProjectSubstage, SubstageTemplate } from '@/lib/types';

interface Props {
  projectId: string;
  template: SubstageTemplate;
  instance: ProjectSubstage | null;
  labels: Record<string, string>;
}

// Status chip cycles: no instance / upcoming -> activate (active); active -> done;
// done -> active (undo). not_applicable has no defined transition here — no-op.
export function SubstageRow({ projectId, template, instance, labels }: Props) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const status = instance?.status ?? 'upcoming';

  const cls =
    status === 'done' ? 'bg-sage-soft text-sage'
    : status === 'active' ? 'bg-mist-soft text-mist'
    : status === 'not_applicable' ? 'bg-inset text-ink3'
    : 'bg-card2 text-ink3';

  const onClick = () => start(async () => {
    setFailed(false);
    let res: { ok?: boolean; error?: string } | null = null;
    if (!instance || status === 'upcoming') {
      res = await activateSubstage(projectId, template.id, null);
    } else if (status === 'active' && instance) {
      res = await setSubstageStatus(projectId, instance.id, 'done');
    } else if (status === 'done' && instance) {
      res = await setSubstageStatus(projectId, instance.id, 'active');
    }
    if (res?.error) setFailed(true);
  });

  return (
    <li className={`flex flex-wrap items-center gap-2 border-b border-line2 px-1 py-1.5 last:border-b-0 ${pending ? 'opacity-40' : ''}`}>
      <span className="min-w-0 flex-1 text-sm text-ink">{template.name}</span>
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        aria-label={`${template.name}: ${labels['status.' + status]}`}
        className={`min-h-11 whitespace-nowrap rounded-full px-2.5 py-1 text-xs disabled:opacity-50 sm:min-h-0 ${cls}`}
      >
        {labels['status.' + status]}
      </button>
      {failed && <span role="alert" className="w-full text-[11px] text-coral">{labels.error}</span>}
    </li>
  );
}
