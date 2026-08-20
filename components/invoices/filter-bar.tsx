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
  labels: { all: string; project: string; entity: string; vendor: string; status: string; from: string; to: string };
}

// Item 3b: filter by project, entity, vendor, status, date.
export function FilterBar({ options, labels }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/invoices?${next.toString()}`);
  };

  const select = (key: string, label: string, values: { value: string; label: string }[]) => (
    <label className="flex items-center gap-1.5 text-xs text-ink2">
      {label}
      <select
        value={params.get(key) ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink"
      >
        <option value="">{labels.all}</option>
        {values.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-line bg-card p-3 shadow-card">
      {select('project', labels.project, options.projects.map((p) => ({ value: p, label: p })))}
      {select('entity', labels.entity, options.entities.map((e) => ({ value: e, label: e })))}
      {select('vendor', labels.vendor, options.vendors.map((v) => ({ value: v, label: v })))}
      {select('status', labels.status, options.statuses)}
      <label className="flex items-center gap-1.5 text-xs text-ink2">
        {labels.from}
        <input type="date" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink2">
        {labels.to}
        <input type="date" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink" />
      </label>
    </div>
  );
}
