'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProjectView } from '@/lib/queries';
import { RequirementsPane, type RailLabels } from './requirements-pane';

interface Props {
  projects: ProjectView[];
  substages: Record<string, string[]>;
  title: string;
  labels: RailLabels & { expand: string; collapse: string };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

// "Where every project stands" — collapsible (item 4b), stones clickable
// (item 4a): past stage shows what completed, future shows what's required.
export function ProjectRails({ projects, substages, title, labels }: Props) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const [openRails, setOpenRails] = useState<Record<string, boolean>>({});
  const [selectedStage, setSelectedStage] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Record<string, 'work' | 'time'>>({});

  return (
    <section aria-labelledby="rails-h">
      <button
        type="button"
        onClick={() => setSectionOpen((v) => !v)}
        aria-expanded={sectionOpen}
        className="flex w-full items-center justify-between gap-3"
      >
        <h2 id="rails-h" className="font-serif text-xl text-ink sm:text-2xl">{title}</h2>
        <span className="rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2">
          {sectionOpen ? labels.collapse : labels.expand}
        </span>
      </button>

      {sectionOpen && (
        <div className="mt-4 space-y-4">
          {projects.map((p) => {
            const current = p.stages.find((s) => s.status === 'current');
            const shownKey = selectedStage[p.id] ?? current?.stage_key;
            const shown = p.stages.find((s) => s.stage_key === shownKey) ?? current;
            const relation = !shown ? 'current'
              : shown.status === 'done' ? 'past'
              : shown.status === 'current' ? 'current'
              : shown.also_active ? 'also_active'
              : 'future';
            const isOpen = openRails[p.id] ?? false;
            const activeTab = tab[p.id] ?? 'work';
            const doneCount = (shown?.requirements ?? []).filter((r) => r.state === 'done').length;
            const totalCount = shown?.requirements.length ?? 0;
            const rail = current ? substages[current.stage_key] : undefined;
            const sub = current?.substage ?? '';
            const at = rail && sub
              ? rail.findIndex((s) => norm(s) === norm(sub) || norm(sub).includes(norm(s)) || norm(s).includes(norm(sub)))
              : -1;
            const riskStage = p.stages.find((s) => s.risk && s.slip_days > 0);

            return (
              <article key={p.id} className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">
                    <Link href={'/projects/' + p.id} className="hover:underline">{p.name}</Link>
                  </h3>
                  {p.city_case && (
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                      p.city_on_hold ? 'bg-coral-soft text-coral' : 'bg-inset text-ink3'
                    }`}>
                      {p.city_case}{p.city_on_hold ? ` · ${labels.onHold}` : ''}
                    </span>
                  )}
                  <span className="ms-auto text-xs">
                    {riskStage ? (
                      <span className="rounded-full bg-coral-soft px-2 py-0.5 text-coral">
                        ⚠ {labels.slip.replace('{n}', String(riskStage.slip_days))}
                      </span>
                    ) : (
                      <span className="rounded-full bg-sage-soft px-2 py-0.5 text-sage">{labels.onTrack}</span>
                    )}
                  </span>
                </div>

                <div className="mt-3 flex items-center overflow-x-auto pb-1">
                  {p.stages.map((s, i) => {
                    const cls = s.status === 'done'
                      ? 'bg-sage-soft text-sage border-sage-line'
                      : s.status === 'current'
                        ? 'bg-sage text-white border-sage'
                        : s.risk
                          ? 'bg-coral-soft text-coral border-coral/40'
                          // Client feedback (Noa #4): parallel stages must BOTH look active,
                          // not just the current one — color also_active like done.
                          : s.also_active
                            ? 'bg-sage-soft text-sage border-sage-line'
                            : 'bg-card2 text-ink3 border-line';
                    const sel = s.stage_key === shown?.stage_key;
                    return (
                      <span key={s.id} className="flex flex-none items-center">
                        {i > 0 && <span className={`stone-tie ${s.status === 'done' || s.status === 'current' ? 'done' : ''}`} />}
                        <button
                          type="button"
                          onClick={() => {
                            // Second click on the open stage closes the pane (client ask).
                            if (isOpen && sel) {
                              setOpenRails((m) => ({ ...m, [p.id]: false }));
                              return;
                            }
                            setSelectedStage((m) => ({ ...m, [p.id]: s.stage_key }));
                            setOpenRails((m) => ({ ...m, [p.id]: true }));
                          }}
                          aria-expanded={isOpen && sel}
                          className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-transform active:scale-[0.97] ${cls} ${sel ? 'ring-2 ring-mist ring-offset-1 ring-offset-card' : ''}`}
                        >
                          {s.label}
                          {s.also_active && s.status !== 'current' ? ' ◦' : ''}
                          {s.risk && s.slip_days > 0 ? ` +${s.slip_days}d` : ''}
                        </button>
                      </span>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setOpenRails((m) => ({ ...m, [p.id]: !isOpen }))}
                  aria-expanded={isOpen}
                  className="mt-2 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-start text-sm text-ink2 hover:text-ink sm:min-h-0"
                >
                  <span aria-hidden="true" className={`inline-block transition-transform rtl:-scale-x-100 ${isOpen ? 'rotate-90 rtl:rotate-90' : ''}`}>▸</span>
                  <span className="font-medium text-ink">
                    {current?.label ?? ''}
                    {current?.substage ? <em className="font-normal text-ink2"> · {current.substage}</em> : null}
                  </span>
                  <span className="ms-auto text-xs text-ink3">
                    {labels.progress
                      .replace('{done}', String(doneCount))
                      .replace('{total}', String(totalCount))
                      .replace('{open}', String(totalCount - doneCount))}
                    {' '}
                    {current?.confirmed
                      ? <span className="text-sage">· {labels.confirmed}</span>
                      : <span className="text-apricot">· {labels.estimated}</span>}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-2 border-t border-line2 pt-3">
                    <div className="flex gap-1">
                      {(['work', 'time'] as const).map((tb) => (
                        <button
                          key={tb}
                          type="button"
                          onClick={() => setTab((m) => ({ ...m, [p.id]: tb }))}
                          className={`min-h-11 rounded-full px-3 py-1 text-xs sm:min-h-0 ${
                            activeTab === tb ? 'bg-ink text-bg' : 'bg-card2 text-ink3 hover:text-ink'
                          }`}
                        >
                          {tb === 'work' ? labels.whatWeOwe : labels.timeline}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3">
                      {activeTab === 'work' ? (
                        <RequirementsPane
                          requirements={shown?.requirements ?? []}
                          relation={relation}
                          labels={labels}
                        />
                      ) : (
                        <div>
                          {rail && rail.length > 0 && (
                            <p className="mb-3 flex flex-wrap gap-x-1 gap-y-1 text-xs">
                              {rail.map((s, i) => (
                                <span key={s} className={
                                  at >= 0 && i < at ? 'text-sage'
                                  : i === at ? 'rounded bg-sage-soft px-1.5 py-0.5 font-medium text-sage'
                                  : 'text-ink3'
                                }>
                                  {s}{i < rail.length - 1 && <span aria-hidden="true" className="inline-block rtl:-scale-x-100"> ›</span>}
                                </span>
                              ))}
                            </p>
                          )}
                          <div className="space-y-1">
                            {p.events.map((e) => (
                              <div key={e.id} className={`grid grid-cols-[90px_1fr] gap-2 rounded px-2 py-1 text-sm ${
                                e.kind === 'history' ? 'text-ink2' : 'text-ink'
                              }`}>
                                <span className="font-mono text-xs text-ink3">{e.event_date ?? '·'}</span>
                                <span>
                                  {e.step}
                                  {e.src && <span className="text-xs text-ink3"> · {e.src}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
