'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export interface FilterOptions {
  projects: string[];
  entities: string[];
  vendors: string[];
  statuses: { value: string; label: string }[];
}

interface Props {
  options: FilterOptions;
  labels: {
    all: string; project: string; entity: string; vendor: string; status: string;
    from: string; to: string; advanced: string; active: string; reset: string;
  };
}

/** The six filters this bar owns. `tab` is deliberately not among them: a
 *  reset must not knock the user out of the view they are in. */
const KEYS = ['project', 'entity', 'vendor', 'status', 'from', 'to'] as const;

// Spec §9: collapsed by default with a count of active filters and a reset.
// The filtering logic and URL persistence are untouched.
export function FilterBar({ options, labels }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const activeCount = KEYS.filter((k) => params.get(k)).length;

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/invoices?${next.toString()}`);
  };

  const reset = () => {
    const next = new URLSearchParams(params.toString());
    for (const k of KEYS) next.delete(k);
    router.replace(`/invoices?${next.toString()}`);
  };

  const select = (key: string, label: string, values: { value: string; label: string }[]) => (
    <label className="flex items-center gap-1.5 text-[10px] text-sk-muted">
      {label}
      <select
        value={params.get(key) ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="min-h-11 cursor-pointer rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[10px] text-sk-ink sm:min-h-0"
      >
        <option value="">{labels.all}</option>
        {values.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </label>
  );

  return (
    <details open={activeCount > 0} className="rounded-[15px] border border-line bg-sk-surface p-3 shadow-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[10px] font-[650] text-sk-ink sm:min-h-0">
        {labels.advanced}
        {activeCount > 0 && (
          <span className="rounded-[6px] bg-sk-green-soft px-2 py-0.5 text-[9px] font-[650] text-sk-green">
            {labels.active.replace('{n}', `⁨${activeCount}⁩`)}
          </span>
        )}
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {select('project', labels.project, options.projects.map((p) => ({ value: p, label: p })))}
        {select('entity', labels.entity, options.entities.map((e) => ({ value: e, label: e })))}
        {select('vendor', labels.vendor, options.vendors.map((v) => ({ value: v, label: v })))}
        {select('status', labels.status, options.statuses)}
        <label className="flex items-center gap-1.5 text-[10px] text-sk-muted">
          {labels.from}
          <input type="date" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)}
            className="min-h-11 rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[10px] text-sk-ink sm:min-h-0" />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-sk-muted">
          {labels.to}
          <input type="date" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)}
            className="min-h-11 rounded-[8px] border border-line bg-sk-surface px-2 py-1 text-[10px] text-sk-ink sm:min-h-0" />
        </label>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={reset}
            className="min-h-11 cursor-pointer rounded-[8px] border border-sage-line px-3 py-1 text-[10px] font-[650] text-sk-green hover:bg-sk-green-soft sm:min-h-0"
          >
            {labels.reset}
          </button>
        )}
      </div>
    </details>
  );
}
