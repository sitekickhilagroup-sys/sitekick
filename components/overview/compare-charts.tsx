import type { Task } from '@/lib/types';

interface Props {
  openMoney: { project: string; open_usd: number }[];
  tasks: Task[];
  projectNames: Record<string, string>;
  title: string;
  moneyLabel: string;
  loadLabel: string;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Item 5: comparison charts live at the bottom. CSS bars, no chart lib.
export function CompareCharts({ openMoney, tasks, projectNames, title, moneyLabel, loadLabel }: Props) {
  const maxMoney = Math.max(1, ...openMoney.map((m) => m.open_usd));

  const load = new Map<string, { open: number; waiting: number }>();
  for (const t of tasks) {
    if (t.status !== 'open') continue;
    const name = (t.project_id ? projectNames[t.project_id] : null) ?? 'All';
    const row = load.get(name) ?? { open: 0, waiting: 0 };
    row.open++;
    if (t.waiting_for) row.waiting++;
    load.set(name, row);
  }
  const loadRows = [...load.entries()].sort((a, b) => b[1].open - a[1].open);
  const maxLoad = Math.max(1, ...loadRows.map(([, r]) => r.open));

  return (
    <section aria-labelledby="compare-h">
      <h2 id="compare-h" className="font-serif text-2xl text-ink">{title}</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
          <h3 className="text-sm font-medium text-ink2">{moneyLabel}</h3>
          <div className="mt-3 space-y-2">
            {openMoney.map((m) => (
              <div key={m.project} className="grid grid-cols-[130px_1fr_90px] items-center gap-2 text-xs">
                <span className="truncate text-ink2">{m.project}</span>
                <div className="h-4 overflow-hidden rounded bg-inset">
                  <i className="block h-full rounded bg-chart1" style={{ width: `${Math.round((m.open_usd / maxMoney) * 100)}%` }} />
                </div>
                <span className="text-end font-mono text-ink">{money(m.open_usd)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
          <h3 className="text-sm font-medium text-ink2">{loadLabel}</h3>
          <div className="mt-3 space-y-2">
            {loadRows.map(([name, r]) => (
              <div key={name} className="grid grid-cols-[130px_1fr_60px] items-center gap-2 text-xs">
                <span className="truncate text-ink2">{name}</span>
                <div className="flex h-4 overflow-hidden rounded bg-inset">
                  <i className="block h-full bg-chart2" style={{ width: `${Math.round((r.waiting / maxLoad) * 100)}%` }} />
                  <i className="block h-full bg-mist" style={{ width: `${Math.round(((r.open - r.waiting) / maxLoad) * 100)}%` }} />
                </div>
                <span className="text-end font-mono text-ink">{r.waiting}/{r.open}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
