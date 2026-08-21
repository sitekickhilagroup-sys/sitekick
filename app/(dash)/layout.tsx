import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/app/actions/auth';
import { Logo } from '@/components/logo';
import { MobileNav, NavLinks } from '@/components/nav-links';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);

  const links = [
    { href: '/', label: t('nav.overview') },
    { href: '/work', label: t('nav.work') },
    { href: '/weekly', label: t('nav.weekly') },
    { href: '/inbox', label: t('nav.inbox') },
    { href: '/invoices', label: t('nav.invoices') },
    { href: '/drafts', label: t('nav.drafts') },
    { href: '/digest', label: t('nav.digest') },
    { href: '/directory', label: t('nav.directory') },
    { href: '/upload', label: t('nav.upload') },
    { href: '/settings', label: t('nav.settings') },
    { href: '/guide', label: t('nav.guide') },
  ];

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:shadow-card"
      >
        {t('nav.skip')}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 lg:gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Logo size={26} />
            <span className="font-serif text-lg font-semibold text-ink">Sitekick</span>
            <span className="hidden text-xs text-ink3 xl:inline">{t('app.tagline')}</span>
          </Link>
          <NavLinks links={links} />
          <div className="ms-auto flex items-center gap-1 lg:ms-0 lg:gap-2">
            <LocaleToggle locale={locale} label={t('lang.toggle')} />
            <ThemeToggle theme={theme} label={t('theme.toggle')} />
            <form action={signOut} className="hidden lg:block">
              <button type="submit" className="rounded-full px-3 py-1 text-xs text-ink3 transition-colors hover:text-ink">
                {t('nav.signout')}
              </button>
            </form>
            <MobileNav links={links} menuLabel={t('nav.menu')}>
              <form action={signOut}>
                <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm text-ink2 hover:bg-card2 hover:text-ink">
                  {t('nav.signout')}
                </button>
              </form>
            </MobileNav>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1400px] px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
