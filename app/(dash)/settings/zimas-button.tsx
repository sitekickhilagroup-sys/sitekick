'use client';

import { useState, useTransition } from 'react';
import { runZimasNow } from '@/app/actions/settings';

export function ZimasButton({ label }: { label: string }) {
  const [result, setResult] = useState('');
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button" disabled={pending} aria-busy={pending}
        onClick={() => start(async () => {
          const r = await runZimasNow();
          setResult(`✓ ${r.processed}`);
        })}
        className="min-h-11 cursor-pointer rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink2 hover:text-ink disabled:opacity-60 sm:min-h-0"
      >
        {pending ? '…' : label}
      </button>
      {result && <span role="status" className="text-xs text-sage">{result}</span>}
    </span>
  );
}
