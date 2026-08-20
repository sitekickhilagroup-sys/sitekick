import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import type { Task, Vendor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DirectoryPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const [vendorsQ, tasksQ] = await Promise.all([
    supabase.from('vendors').select('*').order('name'),
    supabase.from('tasks').select('waiting_for,status').eq('status', 'open'),
  ]);
  const vendors = (vendorsQ.data ?? []) as Vendor[];
  const tasks = (tasksQ.data ?? []) as Pick<Task, 'waiting_for' | 'status'>[];

  const openCount = (name: string) =>
    tasks.filter((x) => x.waiting_for && name.toLowerCase().includes(x.waiting_for.toLowerCase())).length;

  return (
    <div className="space-y-4 pb-16">
      <h1 className="font-serif text-3xl text-ink">{t('nav.directory')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <article key={v.id} className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: v.hue ?? 'var(--sage)' }} aria-hidden />
              <h3 className="truncate text-sm font-semibold text-ink">{v.name}</h3>
              {openCount(v.name) > 0 && (
                <span className="ms-auto whitespace-nowrap rounded-full bg-apricot-soft px-2 py-0.5 text-[11px] text-apricot">
                  {t('directory.open_items').replace('{n}', String(openCount(v.name)))}
                </span>
              )}
            </div>
            {v.discipline && <p className="mt-1 text-xs text-ink2">{v.discipline}</p>}
            {v.notes && <p className="mt-0.5 text-xs text-ink3">{v.notes}</p>}
            <div className="mt-2 space-y-0.5 text-xs text-ink2">
              {v.contact_name && <p>{v.contact_name}</p>}
              {v.email && <a className="block text-chart1" href={`mailto:${v.email}`}>{v.email}</a>}
              {v.phone && <p className="font-mono">{v.phone}</p>}
            </div>
            {v.status && <p className="mt-2 inline-block rounded-full bg-inset px-2 py-0.5 text-[11px] text-ink3">{v.status}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}
