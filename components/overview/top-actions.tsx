import type { Action } from '@/lib/types';

interface Props {
  actions: Action[];
  title: string;
  subtitle: string;
  empty: string;
}

// Hero section: the client asked for this to be the biggest thing on the page.
export function TopActions({ actions, title, subtitle, empty }: Props) {
  return (
    <section aria-labelledby="top-actions-h">
      <h1 id="top-actions-h" className="font-serif text-3xl text-ink">{title}</h1>
      <p className="mt-1 text-sm text-ink3">{subtitle}</p>
      {actions.length === 0 ? (
        <p className="mt-6 rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{empty}</p>
      ) : (
        <ol className="mt-5 space-y-2">
          {actions.map((a, i) => (
            <li
              key={a.id}
              className="flex items-start gap-4 rounded-(--radius-card) border border-line bg-card p-4 shadow-card"
            >
              <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sage-soft font-serif text-sm text-sage">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium leading-snug text-ink">{a.title}</p>
                <p className="mt-0.5 text-xs text-ink3">
                  <span className="font-medium text-ink2">{a.project}</span>
                  {a.why ? <> · {a.why}</> : null}
                </p>
              </div>
              {a.kind === 'blocker' && (
                <span className="ms-auto rounded-full bg-coral-soft px-2 py-0.5 text-xs text-coral">⚠</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
