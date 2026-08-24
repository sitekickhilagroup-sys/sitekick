import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { WeeklyModeToggle } from '@/components/weekly/mode-toggle';

// Route-specific header for Weekly Review (spec §2): brand on the leading
// edge, the Sunday/Monday segmented control on the trailing edge.
//
// Same call as the other two focused pages on hidden utilities — nav, bell and
// sign-out go; language and theme stay, since both are cookie-backed and there
// is no other way out of dark mode or Hebrew from this page.
export async function WeeklyHeader() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);

  return (
    <header className="border-b border-line bg-sk-surface">
      <div className="mx-auto flex h-[60px] max-w-[1040px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={22} />
          <span className="leading-tight">
            <span className="block text-[8px] font-bold uppercase tracking-[0.22em] text-sage">Hilla Group</span>
            <span className="mt-0.5 block text-[14px] font-[650] text-sk-ink">Sitekick</span>
          </span>
        </Link>
        <div className="ms-auto flex items-center gap-2">
          <WeeklyModeToggle draftLabel={t('weekly.mode_draft')} presentLabel={t('weekly.mode_present')} />
          <LocaleToggle locale={locale} label={t('lang.toggle')} />
          <ThemeToggle theme={theme} label={t('theme.toggle')} />
        </div>
      </div>
    </header>
  );
}
