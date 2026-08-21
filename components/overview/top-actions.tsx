import type { Action } from '@/lib/types';
import { ActionRow } from './action-row';

interface Props {
  actions: Action[];
  title: string;
  subtitle: string;
  empty: string;
  rowLabels: {
    markDone: string; dismiss: string; waiting: string; editWaiting: string;
    fromSource: string; cancel: string; errorSave: string; all: string;
    whyCritical: string; whyDue: string; unlocksN: string; stuckDays: string; blockedBy: string;
  };
}

// Hero section: the client asked for this to be the biggest thing on the page.
// Every row shows its source and can be completed / dismissed in place.
export function TopActions({ actions, title, subtitle, empty, rowLabels }: Props) {
  return (
    <section aria-labelledby="top-actions-h">
      <h1 id="top-actions-h" className="font-serif text-2xl text-ink sm:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-ink3">{subtitle}</p>
      {actions.length === 0 ? (
        <p className="mt-6 rounded-(--radius-card) border border-line bg-card p-6 text-ink2">{empty}</p>
      ) : (
        <ol className="mt-5 space-y-2">
          {actions.map((a, i) => (
            <ActionRow key={a.id} action={a} index={i} labels={rowLabels} />
          ))}
        </ol>
      )}
    </section>
  );
}
