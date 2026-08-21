'use client';

import { useState } from 'react';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export interface IntelligenceProps {
  timeLost: { project: string; text: string; days: number } | null;
  staleWait: { project: string; title: string; who: string; days: number } | null;
  consultants: { name: string; discipline: string | null; waitingCount: number; openUsd: number }[];
  budget: { project: string; paid: number; total: number }[];
  forecast: { project: string; next: string | null }[];
  labels: Record<string, string>;
}

// Her PORTFOLIO INTELLIGENCE panel: one card, four switchable lenses.
// Everything shown is derived from real records; partial coverage is stated,
// never hidden ("useful learning — not decorative metrics").
export function IntelligenceTabs({ timeLost, staleWait, consultants, budget, forecast, labels }: IntelligenceProps) {
  const tabs = [labels.tabTime, labels.tabBudget, labels.tabConsultants, labels.tabForecast];
  const [tab, setTab] = useState(tabs[0]);
  const maxUsd = Math.max(1, ...consultants.map((c) => c.openUsd));

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink3">{labels.kicker}</p>
          <h2 className="mt-1 font-serif text-xl text-ink sm:text-2xl">{labels.title}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={tab === x}
              onClick={() => setTab(x)}
              className={`min-h-11 cursor-pointer rounded-full border px-3 py-1 text-xs sm:min-h-0 ${
                tab === x
                  ? 'border-sage-line bg-sage-soft font-semibold text-sage'
                  : 'border-line bg-card text-ink2 hover:text-ink'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      {tab === labels.tabTime && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {timeLost && (
            <article className="rounded-[13px] border border-line bg-card2/50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-coral">{labels.timeLost}</p>
              <p className="mt-1 text-sm font-medium text-ink">{timeLost.project} · {timeLost.text}</p>
              <p className="mt-1 text-xs text-ink3">{labels.stuckDays.replace('{n}', `⁨${timeLost.days}⁩`)}</p>
            </article>
          )}
          {staleWait && (
            <article className="rounded-[13px] border border-line bg-card2/50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">{labels.staleWait}</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {staleWait.project ? `${staleWait.project} · ` : ''}{staleWait.title}
              </p>
              <p className="mt-1 text-xs text-ink3">
                {labels.waitingOn}: {staleWait.who} · {labels.days.replace('{n}', `⁨${staleWait.days}⁩`)}
              </p>
            </article>
          )}
          {!timeLost && !staleWait && <p className="text-sm text-ink3">{labels.empty}</p>}
        </div>
      )}

      {tab === labels.tabBudget && (
        <div className="mt-4">
          {/* Her .coverage-warning — honesty first. */}
          <div className="rounded-[11px] border border-apricot/30 bg-apricot-soft px-4 py-2.5 text-xs">
            <b className="text-apricot">{labels.budgetWarnT}</b>
            <span className="ms-2 text-ink2">{labels.budgetWarn}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {budget.map((b) => (
              <article key={b.project} className="rounded-[13px] border border-line bg-card2/50 p-4">
                <p className="text-sm font-semibold text-ink">{b.project}</p>
                <p className="mt-2 flex items-baseline justify-between gap-2 text-xs text-ink2">
                  {labels.costToDate} <b className="font-mono text-ink">{money(b.paid)}</b>
                </p>
                <p className="mt-1 flex items-baseline justify-between gap-2 text-xs text-ink2">
                  {labels.recordedTotal} <b className="font-mono text-ink">{money(b.total)}</b>
                </p>
                <p className="mt-2 text-[10px] text-ink3">{labels.coverage}</p>
              </article>
            ))}
            {budget.length === 0 && <p className="text-sm text-ink3">{labels.empty}</p>}
          </div>
        </div>
      )}

      {tab === labels.tabConsultants && (
        consultants.length === 0 ? <p className="mt-4 text-sm text-ink3">{labels.empty}</p> : (
          <ul className="mt-4 space-y-2">
            {consultants.map((c) => (
              <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_auto_1fr_90px]">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{c.name}</span>
                  {c.discipline && <span className="block truncate text-[11px] text-ink3">{c.discipline}</span>}
                </span>
                <span className={`justify-self-end whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] sm:justify-self-auto ${
                  c.waitingCount > 0 ? 'bg-mist-soft text-mist' : 'bg-card2 text-ink3'
                }`}>
                  {labels.waitingShort.replace('{n}', `⁨${c.waitingCount}⁩`)}
                </span>
                <span className="col-span-2 h-3 overflow-hidden rounded bg-inset sm:col-span-1">
                  <i className="block h-full rounded bg-chart1" style={{ width: `${Math.round((c.openUsd / maxUsd) * 100)}%` }} />
                </span>
                <span className="col-span-2 text-end font-mono text-xs text-ink sm:col-span-1">{money(c.openUsd)}</span>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === labels.tabForecast && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {forecast.map((f) => (
            <article key={f.project} className="rounded-[13px] border border-line bg-card2/50 p-4">
              <p className="text-sm font-semibold text-ink">{f.project}</p>
              <p className="mt-1 text-xs text-ink2">{f.next ?? labels.none}</p>
              <p className="mt-2 text-[10px] text-ink3">{labels.forecastConf}</p>
            </article>
          ))}
          {forecast.length === 0 && <p className="text-sm text-ink3">{labels.empty}</p>}
        </div>
      )}
    </section>
  );
}
