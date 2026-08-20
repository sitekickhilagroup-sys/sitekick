'use client';

import { useTransition } from 'react';
import { generateDigest } from '@/app/actions/digest';

export function GenerateButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await generateDigest(); })}
      className="rounded-full bg-sage px-4 py-1.5 text-sm text-white transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      {pending ? '…' : label}
    </button>
  );
}
