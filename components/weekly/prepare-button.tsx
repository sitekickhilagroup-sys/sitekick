'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { prepareCurrentReview } from '@/app/actions/weekly';
import { WEEKLY_ERRORS } from '@/lib/weekly';

// No review row exists yet for this Monday — Sunday prep creates/refreshes it,
// then a hard refresh re-runs the page's server query to pick up the new row.
//
// C2: this used to discard res.error entirely and always show the same fixed
// generic label, regardless of what actually failed — so the one anticipated,
// nameable cause (0016 not applied yet) read exactly like every other
// failure, with no clue what to actually do. The migration case now gets its
// own translated string, the way createInvoice's migrationPending branch
// does; anything else still surfaces the real reason (interpolated into
// errorReason), never a blanket "couldn't do that".
export function PrepareButton(
  { label, errorReason, migrationPendingError }: { label: string; errorReason: string; migrationPendingError: string },
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const prepare = () => start(async () => {
    setMessage(null);
    const res = await prepareCurrentReview();
    if (res && 'error' in res) {
      setMessage(
        res.error === WEEKLY_ERRORS.migrationPending
          ? migrationPendingError
          : errorReason.replace('{reason}', res.error),
      );
      return;
    }
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
      {message && <span role="alert" className="text-xs text-coral">{message}</span>}
    </div>
  );
}
