'use client';

import { useState, useTransition } from 'react';
import { runZimasNow } from '@/app/actions/settings';

export function ZimasButton({ label }: { label: string }) {
  const [result, setResult] = useState('');
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <button
        type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await runZimasNow();
          setResult(`✓ ${r.processed}`);
        })}
        className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink2 hover:text-ink disabled:opacity-60"
      >
        {pending ? '…' : label}
      </button>
      {result && <span className="text-xs text-sage">{result}</span>}
    </span>
  );
}
