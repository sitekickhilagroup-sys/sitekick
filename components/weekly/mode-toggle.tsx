'use client';

import { useRouter, useSearchParams } from 'next/navigation';

// Sunday Draft / Monday Presentation (spec §2). Lives in the header, but the
// mode itself is held in the URL rather than in component state, so the board
// below reads the same value without either component owning the other — and
// it survives a refresh, which the previous useState did not.
export function WeeklyModeToggle({ draftLabel, presentLabel }: { draftLabel: string; presentLabel: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const present = params.get('mode') === 'meeting';

  const setMode = (meeting: boolean) => {
    const next = new URLSearchParams(params.toString());
    if (meeting) next.set('mode', 'meeting');
    else next.delete('mode');
    router.replace(`/weekly${next.toString() ? `?${next}` : ''}`);
  };

  return (
    <div className="flex rounded-full bg-sk-surface-soft p-0.5" role="group" aria-label={draftLabel}>
      <button
        type="button"
        onClick={() => setMode(false)}
        aria-pressed={!present}
        className={`min-h-11 cursor-pointer rounded-full px-3.5 py-1 text-[11px] font-[650] sm:min-h-0 ${
          !present ? 'bg-sk-surface text-sk-green shadow-card' : 'text-sk-muted hover:text-sk-ink'
        }`}
      >
        {draftLabel}
      </button>
      <button
        type="button"
        onClick={() => setMode(true)}
        aria-pressed={present}
        className={`min-h-11 cursor-pointer rounded-full px-3.5 py-1 text-[11px] font-[650] sm:min-h-0 ${
          present ? 'bg-sk-surface text-sk-green shadow-card' : 'text-sk-muted hover:text-sk-ink'
        }`}
      >
        {presentLabel}
      </button>
    </div>
  );
}
