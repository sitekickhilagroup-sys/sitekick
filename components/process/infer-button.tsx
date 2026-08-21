'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { inferPhases } from '@/app/actions/process';
import type { PhaseKey } from '@/lib/types';

interface Props {
  projectId: string;
  label: string;
  doneLabel: string;
  sameLabel: string;
  errorLabel: string;
}

type Result = { ok: true; proposed: PhaseKey | null } | { error: string };

// Dor: "2 or 3 smart iterations" — button next to the phase switcher that
// runs agents/infer-phase.ts and reports where its suggestion landed.
export function InferButton({ projectId, label, doneLabel, sameLabel, errorLabel }: Props) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  const onClick = () => start(async () => {
    setResult(null);
    const res = await inferPhases(projectId);
    setResult(res as Result);
  });

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className="min-h-11 rounded-lg border border-line px-2 py-1 text-xs text-ink2 disabled:opacity-50 sm:min-h-0"
      >
        {label}
      </button>
      {result && 'error' in result && (
        <span role="alert" className="text-[11px] text-coral">{errorLabel}</span>
      )}
      {result && 'ok' in result && result.proposed && (
        <span role="status" className="text-[11px] text-sage">
          <Link href="/inbox" className="underline">{doneLabel}</Link>
        </span>
      )}
      {result && 'ok' in result && !result.proposed && (
        <span role="status" className="text-[11px] text-ink3">{sameLabel}</span>
      )}
    </span>
  );
}
