'use client';

import { useState, useTransition } from 'react';
import { setCurrentPhase } from '@/app/actions/process';
import type { Phase, PhaseKey } from '@/lib/types';

interface Props {
  projectId: string;
  phases: Phase[];
  current: PhaseKey | null;
  label: string;
  errorLabel: string;
}

// Client feedback (Noa #2): changing the project's stage from the old settings
// screen failed silently. This inline switcher reports failure explicitly.
export function PhaseSwitcher({ projectId, phases, current, label, errorLabel }: Props) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const onChange = (value: string) => start(async () => {
    setFailed(false);
    const res = await setCurrentPhase(projectId, value as PhaseKey);
    if (res?.error) setFailed(true);
  });

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        defaultValue={current ?? ''}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="min-h-11 rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink disabled:opacity-50 sm:min-h-0"
      >
        <option value="" disabled>—</option>
        {phases.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {failed && <span role="alert" className="text-[11px] text-coral">{errorLabel}</span>}
    </span>
  );
}
