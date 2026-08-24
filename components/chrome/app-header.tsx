import Link from 'next/link';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/app/actions/auth';
import { Logo } from '@/components/logo';
import { MobileNav, NavLinks } from '@/components/nav-links';
import { NotificationBell } from '@/components/inbox/notification-bell';

// The standard global header. Extracted from the (dash) layout so the
// (standard) and (focused) route groups can each decide whether to render it —
// Data Inbox, Invoices and Weekly Review get route-specific headers of their
// own, and More pages must keep this one exactly as it is.
export async function AppHeader() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);

  // Her top bar shows the open-task count on My Work — head count only.
  const supabase = await supabaseServer();
  const { count: openCount } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  // Spec §א: only the five core work areas stay primary; everything else
  // lives under "More" so the top nav never crowds or clips.
  // Order mirrors her updated UI reference (Data Inbox is primary there).
  const links = [
    { href: '/', label: t('nav.overview') },
    { href: '/work', label: t('nav.work'), badge: openCount ?? undefined },
    { href: '/projects', label: t('nav.process') },
    { href: '/upload', label: t('nav.data_inbox') },
    { href: '/invoices', label: t('nav.invoices') },
    { href: '/weekly', label: t('nav.weekly') },
  ];
  const moreLinks = [
    { href: '/inbox', label: t('nav.inbox') },
    { href: '/drafts', label: t('nav.drafts') },
    { href: '/digest', label: t('nav.digest') },
    { href: '/directory', label: t('nav.directory') },
    { href: '/settings', label: t('nav.settings') },
    { href: '/guide', label: t('nav.guide') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      {/* Spec §1: taller, cleaner header. Contents are unchanged — More pages
          keep every utility, only the proportions move. */}
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:gap-8">
        {/* Both marks: our Sitekick stones + the real Hilla Group logo
            (asset from her demo), with her HILLA GROUP/Sitekick lockup. */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={26} />
          <span className="leading-tight">
            <span className="block text-[8px] font-bold uppercase tracking-[0.22em] text-sage">Hilla Group</span>
            <span className="mt-0.5 block font-serif text-base font-semibold text-ink">Sitekick</span>
          </span>
          {/* Square mark (450×444) — small on tablet, near full header
              height on desktop, where there is room for it to read. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hilla-group-logo.png"
            alt="Hilla Group"
            className="ms-1 hidden h-8 w-auto sm:block lg:h-10"
          />
        </Link>
        <NavLinks links={links} more={moreLinks} moreLabel={t('nav.more')} />
        <div className="ms-auto flex items-center gap-1 lg:ms-0 lg:gap-2">
          <NotificationBell labels={{
            aria: t('bell.aria'), title: t('bell.title'), waiting: t('bell.waiting'),
            newSuggestion: t('bell.new'), dup: t('bell.dup'), dupShort: t('bell.dup_short'),
            already: t('bell.already'), maybeNew: t('bell.maybe_new'), empty: t('bell.empty'),
            later: t('bell.later'), notRelevant: t('bell.not_relevant'), reviewNow: t('bell.review_now'),
            openReview: t('bell.open_review'), general: t('common.general'), close: t('common.close'),
          }} />
          <LocaleToggle locale={locale} label={t('lang.toggle')} />
          <ThemeToggle theme={theme} label={t('theme.toggle')} />
          <form action={signOut} className="hidden lg:block">
            <button type="submit" className="rounded-full px-3 py-1 text-xs text-ink3 transition-colors hover:text-ink">
              {t('nav.signout')}
            </button>
          </form>
          <MobileNav links={links} more={moreLinks} menuLabel={t('nav.menu')}>
            <form action={signOut}>
              <button type="submit" className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm text-ink2 hover:bg-card2 hover:text-ink">
                {t('nav.signout')}
              </button>
            </form>
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
