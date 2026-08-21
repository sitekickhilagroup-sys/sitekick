'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { prepareCurrentReview } from '@/app/actions/weekly';

// No review row exists yet for this Monday — Sunday prep creates/refreshes it,
// then a hard refresh re-runs the page's server query to pick up the new row.
export function PrepareButton({ label, error }: { label: string; error: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const prepare = () => start(async () => {
    setFailed(false);
    const res = await prepareCurrentReview();
    if (res && 'error' in res) { setFailed(true); return; }
    router.refresh();
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={prepare}
        className="min-h-11 cursor-pointer rounded-lg bg-sage px-4 py-2 text-sm text-white disabled:opacity-50 sm:min-h-0"
      >
        {label}
      </button>
      {failed && <span role="alert" className="text-xs text-coral">{error}</span>}
    </div>
  );
}
