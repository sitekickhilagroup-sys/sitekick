import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';

// Route-specific header for the Invoices workspace (spec §2).
//
// The title must be centred on the viewport, not merely between the left and
// right clusters, so this is a three-column grid rather than a flex row with
// justify-between — those are not the same thing once the clusters differ in
// width, which they always do here.
//
// Same call as Data Inbox on the hidden utilities: nav, bell and sign-out go,
// language and theme stay, because the theme and direction are cookie-backed
// and a user who arrives in dark mode or Hebrew would otherwise be stuck.
export async function FinancialHeader({ sourceLabel }: { sourceLabel: string }) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);

  return (
    <header className="border-b border-line bg-sk-surface">
      <div className="mx-auto grid h-[60px] max-w-[1320px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-7">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 justify-self-start">
          <Logo size={22} />
          <span className="leading-tight">
            <span className="block text-[8px] font-bold uppercase tracking-[0.22em] text-sage">Hilla Group</span>
            <span className="mt-0.5 block text-[14px] font-[650] text-sk-ink">Sitekick</span>
          </span>
        </Link>
        <span className="whitespace-nowrap text-[13px] font-[650] text-sk-ink">{t('invoices.kicker')}</span>
        <div className="flex items-center gap-1.5 justify-self-end">
          {/* Derived from the data actually on screen — the spec forbids
              hardcoding a misleading source. */}
          <span className="hidden whitespace-nowrap text-[10px] text-sk-muted md:inline">{sourceLabel}</span>
          <LocaleToggle locale={locale} label={t('lang.toggle')} />
          <ThemeToggle theme={theme} label={t('theme.toggle')} />
        </div>
      </div>
    </header>
  );
}
