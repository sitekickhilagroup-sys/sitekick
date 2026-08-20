import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/app/actions/auth';
import { Logo } from '@/components/logo';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);

  const links = [
    { href: '/', label: t('nav.overview') },
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
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="font-serif text-lg font-semibold text-ink">Sitekick</span>
            <span className="hidden text-xs text-ink3 sm:inline">{t('app.tagline')}</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="whitespace-nowrap rounded-full px-3 py-1 text-ink2 transition-colors hover:bg-card2 hover:text-ink"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LocaleToggle locale={locale} label={t('lang.toggle')} />
            <ThemeToggle theme={theme} label={t('theme.toggle')} />
            <form action={signOut}>
              <button type="submit" className="rounded-full px-3 py-1 text-xs text-ink3 transition-colors hover:text-ink">
                {t('nav.signout')}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
