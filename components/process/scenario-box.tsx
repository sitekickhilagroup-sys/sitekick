'use client';

import { useState, useTransition } from 'react';
import { setSubstageDecision } from '@/app/actions/process';
import type { SubstageDecision } from '@/lib/types';

const EMPTY = { label: '', options: ['', ''], results: ['', ''] };

/**
 * Her .scenario-box: the conditional rule behind a sub-stage, shown as
 * outcomes you can try. Picking an option only reveals what would follow —
 * project state never moves because someone explored a scenario.
 */
export function ScenarioBox({
  projectId, substageId, decision, labels,
}: {
  projectId: string;
  substageId: string | null;
  decision: SubstageDecision | null;
  labels: Record<string, string>;
}) {
  const [picked, setPicked] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ label: string; options: string[]; results: string[] }>(
    decision ? { label: decision.label, options: [...decision.options], results: [...decision.results] } : EMPTY,
  );
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const save = (value: typeof draft | null) => start(async () => {
    if (!substageId) return;
    setFailed(false);
    const res = await setSubstageDecision(projectId, substageId, value);
    if (res?.error) { setFailed(true); return; }
    setEditing(false);
    setPicked(0);
  });

  const setPair = (i: number, key: 'options' | 'results', v: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].map((x, j) => (j === i ? v : x)) }));

  if (!substageId) return null;

  if (editing) {
    return (
      <section className="mt-4 rounded-[13px] border border-line bg-apricot-soft/30 p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-apricot">{labels.editKicker}</p>
        <input
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder={labels.labelPh}
          aria-label={labels.labelPh}
          className="mt-2 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
        />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <input
              value={draft.options[i] ?? ''}
              onChange={(e) => setPair(i, 'options', e.target.value)}
              placeholder={`${labels.optionPh} ${i + 1}`}
              aria-label={`${labels.optionPh} ${i + 1}`}
              className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
            />
            <input
              value={draft.results[i] ?? ''}
              onChange={(e) => setPair(i, 'results', e.target.value)}
              placeholder={labels.resultPh}
              aria-label={labels.resultPh}
              className="min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
            />
          </div>
        ))}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button" disabled={pending} onClick={() => save(draft)}
            className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
          >
            {labels.save}
          </button>
          <button
            type="button" onClick={() => setEditing(false)}
            className="min-h-11 cursor-pointer px-2 text-sm text-ink3 hover:text-ink sm:min-h-0"
          >
            {labels.cancel}
          </button>
          {decision && (
            <button
              type="button" disabled={pending} onClick={() => save(null)}
              className="ms-auto min-h-11 cursor-pointer text-xs text-coral disabled:opacity-50 sm:min-h-0"
            >
              {labels.remove}
            </button>
          )}
          {failed && <span role="alert" className="text-xs text-coral">{labels.error}</span>}
        </div>
      </section>
    );
  }

  if (!decision) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(EMPTY); setEditing(true); }}
        className="mt-4 min-h-11 cursor-pointer rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-ink3 hover:border-apricot hover:text-apricot sm:min-h-0"
      >
        + {labels.add}
      </button>
    );
  }

  const safeIndex = Math.min(picked, decision.options.length - 1);

  return (
    <section className="mt-4 rounded-[13px] border border-line bg-apricot-soft/30 p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-apricot">{decision.label}</p>
        <span className="text-[10px] text-ink3">{labels.tryEach}</span>
      </div>
      <div
        role="tablist"
        aria-label={decision.label}
        className="mt-2.5 grid gap-1 rounded-lg bg-card2 p-1"
        style={{ gridTemplateColumns: `repeat(${decision.options.length}, minmax(0, 1fr))` }}
      >
        {decision.options.map((option, i) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={safeIndex === i}
            onClick={() => setPicked(i)}
            className={`min-h-11 cursor-pointer rounded-md px-2 py-1.5 text-[11px] sm:min-h-0 ${
              safeIndex === i ? 'bg-card font-semibold text-ink shadow-card' : 'text-ink3 hover:text-ink'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <div className={`mt-2.5 border-s-[3px] bg-card px-3 py-2.5 ${safeIndex === 0 ? 'border-sage' : 'border-coral'}`}>
        <strong className="block text-xs text-ink">{decision.options[safeIndex]}</strong>
        <p className="mt-1 text-[11px] leading-relaxed text-ink2">
          {decision.results[safeIndex] || labels.noResult}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setDraft({
            label: decision.label,
            options: [...decision.options, '', ''].slice(0, 3),
            results: [...decision.results, '', ''].slice(0, 3),
          });
          setEditing(true);
        }}
        className="mt-2 min-h-11 cursor-pointer text-[11px] text-ink3 hover:text-ink sm:min-h-0"
      >
        {labels.edit}
      </button>
    </section>
  );
}
