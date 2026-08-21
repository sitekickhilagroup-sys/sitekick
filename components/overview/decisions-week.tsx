'use client';

import { useState } from 'react';
import type { Decision } from '@/lib/types';

interface Props {
  decisions: Decision[];
  projectNames: Record<string, string>;
  title: string;
  empty: string;
}

// Item 7: compact title rows grouped by project, click expands detail.
export function DecisionsWeek({ decisions, projectNames, title, empty }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = new Map<string, Decision[]>();
  for (const d of decisions) {
    const key = d.project_id ? (projectNames[d.project_id] ?? '') : '';
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <section aria-labelledby="decisions-h">
      <h2 id="decisions-h" className="font-serif text-xl text-ink sm:text-2xl">{title}</h2>
      {decisions.length === 0 ? (
        <p className="mt-4 rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{empty}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {ordered.map(([project, items]) => (
            <div key={project || '_'}>
              {project && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink2">{project}</p>}
              <ul className="divide-y divide-line2 rounded-(--radius-card) border border-line bg-card shadow-card">
                {items.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setOpen((m) => ({ ...m, [d.id]: !m[d.id] }))}
                      aria-expanded={!!open[d.id]}
                      className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-4 py-2.5 text-start hover:bg-card2 sm:min-h-0"
                    >
                      <span aria-hidden="true" className={`mt-1 inline-block text-xs text-ink3 transition-transform rtl:-scale-x-100 ${open[d.id] ? 'rotate-90 rtl:rotate-90' : ''}`}>▸</span>
                      <span className="text-sm leading-snug text-ink">{d.title}</span>
                    </button>
                    {open[d.id] && d.detail && (
                      <p className="border-t border-line2 bg-card2 px-11 py-2 text-xs text-ink3">{d.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
