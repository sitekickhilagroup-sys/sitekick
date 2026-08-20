import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { supabaseServer } from '@/lib/supabase/server';
import { DraftCard } from './draft-card';
import type { Draft } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DraftsPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const supabase = await supabaseServer();
  const { data } = await supabase.from('drafts').select('*').order('created_at', { ascending: false });
  const drafts = (data ?? []) as Draft[];
  const active = drafts.filter((d) => d.status === 'proposed' || d.status === 'approved');
  const past = drafts.filter((d) => d.status === 'sent' || d.status === 'dismissed');

  const labels = {
    approve: t('drafts.approve'),
    dismiss: t('drafts.dismiss'),
    copy: t('drafts.copy'),
    openMail: t('drafts.open_mail'),
    markSent: t('drafts.mark_sent'),
    statusLabel: {
      proposed: t('drafts.proposed'),
      approved: t('drafts.approved'),
      sent: t('drafts.sent'),
      dismissed: t('drafts.dismiss'),
    },
  };

  return (
    <div className="space-y-4 pb-16">
      <h1 className="font-serif text-3xl text-ink">{t('drafts.title')}</h1>
      {active.length === 0 && (
        <p className="rounded-(--radius-card) border border-line bg-card p-5 text-sm text-ink2">{t('drafts.empty')}</p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {active.map((d) => <DraftCard key={d.id} draft={d} labels={labels} />)}
      </div>
      {past.length > 0 && (
        <div className="grid gap-3 opacity-60 lg:grid-cols-2">
          {past.map((d) => <DraftCard key={d.id} draft={d} labels={labels} />)}
        </div>
      )}
    </div>
  );
}
