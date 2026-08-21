import type { Blocker } from '@/lib/types';

interface Props {
  blockers: Blocker[];
  projectNames: Record<string, string>;
  title: string;
  labels: { stuckDays: string; blockedBy: string; suggested: string; empty: string };
}

export function WhatsStuck({ blockers, projectNames, title, labels }: Props) {
  return (
    <section aria-labelledby="stuck-h">
      <h2 id="stuck-h" className="font-serif text-xl text-ink sm:text-2xl">{title}</h2>
      {blockers.length === 0 ? (
        <p className="mt-4 rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{labels.empty}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {blockers.map((b) => (
            <article key={b.id} className="rounded-(--radius-card) border border-coral/25 bg-card p-4 shadow-card">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-medium text-ink2">{projectNames[b.project_id] ?? ''}</p>
                <span className="whitespace-nowrap rounded-full bg-coral-soft px-2 py-0.5 text-xs text-coral">
                  {labels.stuckDays.replace('{n}', String(b.days_stuck))}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-snug text-ink">{b.what}</p>
              <p className="mt-2 text-xs text-ink3">
                <span className="font-medium text-ink2">{labels.blockedBy}:</span> {b.blocked_by}
              </p>
              {b.suggested_action && (
                <p className="mt-1 rounded-lg bg-apricot-soft px-2.5 py-1.5 text-xs text-ink">
                  <span className="font-medium">{labels.suggested}:</span> {b.suggested_action}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
