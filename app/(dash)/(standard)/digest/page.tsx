import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { laToday } from '@/lib/date';
import { GenerateButton } from './generate-button';
import type { Digest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DigestPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const { data } = await supabase.from('digests').select('*').order('for_date', { ascending: false }).limit(14);
  const digests = (data ?? []) as Digest[];
  const [latest, ...rest] = digests;
  // Noa's own QA report (comment d67d7331, item 3): a digest served days
  // after its own for_date, with nothing on the page saying so — she read a
  // 09/05 digest on 09/10 as if it were current. The cron can miss a day (or
  // several) for any number of reasons; the page's job is to say so, not to
  // guess why. daysOld === 0 covers both "generated today" and "generated
  // yesterday evening, read this morning before the 07:00 run" without a
  // separate special case.
  const daysOld = latest
    ? Math.max(0, Math.floor((Date.parse(laToday()) - Date.parse(latest.for_date.slice(0, 10))) / 86400000))
    : 0;

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink sm:text-3xl">{t('nav.digest')}</h1>
        <GenerateButton label={t('digest.generate')} />
      </div>
      {!latest && (
        <p className="rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{t('digest.empty')}</p>
      )}
      {latest && (
        <article className="rounded-(--radius-card) border border-line bg-card p-6 shadow-card">
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink3">
            {fmtDate(latest.for_date)}
            {daysOld > 1 && (
              <span role="alert" className="rounded-full bg-apricot-soft px-2 py-0.5 font-sans font-semibold text-apricot">
                {t('digest.stale').replace('{n}', String(daysOld))}
              </span>
            )}
          </p>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{latest.body_md}</div>
        </article>
      )}
      {rest.length > 0 && (
        <details className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
          <summary className="cursor-pointer text-sm text-ink2">{t('digest.archive')}</summary>
          <div className="mt-3 space-y-4">
            {rest.map((d) => (
              <article key={d.id} className="border-t border-line2 pt-3">
                <p className="font-mono text-xs text-ink3">{fmtDate(d.for_date)}</p>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink2">{d.body_md}</div>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
