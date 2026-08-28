import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
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
          <p className="font-mono text-xs text-ink3">{fmtDate(latest.for_date)}</p>
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
