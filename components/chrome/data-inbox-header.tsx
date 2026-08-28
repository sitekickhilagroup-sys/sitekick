import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { requireUser } from '@/lib/auth';

// Route-specific header for Data Inbox (spec §2-§3). Deliberately not
// NavLinks: that component's active state is the pale-green pill, and this
// spec asks for a plain bold dark-green link instead.
//
// The spec also lists the notification bell, language, theme and sign-out
// under "hidden global utilities". Bell and sign-out are hidden here — both
// stay one click away on any other route. Language and theme stay, because
// unlike the reference this app persists a dark theme and an RTL locale in
// cookies: drop the controls and a user who arrives here in dark mode or in
// Hebrew has no way out from this page.
export async function DataInboxHeader() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);
  const user = await requireUser();

  const links = [
    { href: '/', label: t('nav.overview'), active: false },
    { href: '/upload', label: t('nav.data_inbox'), active: true },
    { href: '/invoices', label: t('nav.invoices'), active: false },
    { href: '/weekly', label: t('nav.weekly'), active: false },
  ];

  // The spec's banner copy claims no private storage is connected. That is
  // false here — uploads land in a real Supabase Storage bucket and every
  // branch writes live `documents` rows — and the spec itself forbids
  // presenting a false claim, so the banner only appears when an environment
  // actually labels itself.
  const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL;

  return (
    <>
      {envLabel && (
        <div className="bg-sk-green-dark px-4 py-1.5 text-center text-[8px] font-[500] uppercase tracking-[0.04em] text-white">
          {envLabel}
        </div>
      )}
      <header className="border-b border-line bg-sk-surface">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center gap-4 px-4 sm:px-7">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Logo size={24} />
            <span className="leading-tight">
              <span className="block text-[8px] font-bold uppercase tracking-[0.22em] text-sage">Hilla Group</span>
              <span className="mt-0.5 block text-[14px] font-[650] text-sk-ink">Sitekick</span>
            </span>
          </Link>
          <nav aria-label={t('nav.menu')} className="mx-auto hidden items-center gap-6 sm:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.active ? 'page' : undefined}
                className={`whitespace-nowrap text-[13px] ${
                  l.active ? 'font-[650] text-sk-green' : 'font-[450] text-sk-muted hover:text-sk-ink'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1.5 sm:ms-0">
            {/* The reference's "Reference mode" pill would be untrue here, so
                this states the page's real mode: a private, signed-in intake. */}
            {user.email && (
              <span className="hidden whitespace-nowrap rounded-full border border-sage-line px-2.5 py-1 text-[10px] text-sk-green md:inline">
                <bdi>{user.email}</bdi>
              </span>
            )}
            <LocaleToggle locale={locale} label={t('lang.toggle')} />
            <ThemeToggle theme={theme} label={t('theme.toggle')} />
          </div>
        </div>
      </header>
    </>
  );
}
