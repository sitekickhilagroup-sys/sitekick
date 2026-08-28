import Link from 'next/link';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { LOCALE_COOKIE, THEME_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { signOut } from '@/app/actions/auth';
import { MobileNav, NavLinks } from '@/components/nav-links';
import { NotificationBell } from '@/components/inbox/notification-bell';
import { requireUser } from '@/lib/auth';
import { getProfile } from '@/lib/profile';
import { presetOf } from '@/lib/avatar-presets';
import { PresetAvatar } from '@/components/profile/preset-avatar';

// The one global header, rendered by both the (standard) and (focused) group
// layouts — every page shares the same navigation (navigation-consistency).
// More pages must keep this header exactly as it is.
export async function AppHeader() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const t = getT(locale);
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const avatarPreset = presetOf(profile?.avatar);
  const avatarUrl = !avatarPreset && profile?.avatar && !profile.avatar.startsWith('preset:') ? profile.avatar : null;
  const initial = (profile?.display_name ?? user.email ?? '?').slice(0, 1).toUpperCase();

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
    { href: '/profile', label: t('nav.profile') },
    { href: '/settings', label: t('nav.settings') },
    { href: '/guide', label: t('nav.guide') },
  ];

  return (
    <header className="sk-edge sticky top-0 z-40 bg-bg/85 backdrop-blur-md backdrop-saturate-150 reduce-transparency:bg-bg reduce-transparency:backdrop-filter-none">
      {/* Spec §1: taller, cleaner header. Contents are unchanged — More pages
          keep every utility, only the proportions move. */}
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:gap-8">
        {/* Dor's approved lockup: the real H mark, then HILLA GROUP over
            SITEKICK in sage. Live text + CSS-masked mark (not the demo's
            white-box PNG) so it stays crisp and follows both themes. */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span aria-hidden className="hilla-mark h-8" />
          <span className="leading-none">
            <span className="block text-[15px] font-bold uppercase tracking-[0.05em] text-ink">Hilla Group</span>
            <span className="mt-1 block text-[8px] font-bold uppercase tracking-[0.3em] text-sage">Sitekick</span>
          </span>
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
          {/* Profile: avatar chip → /profile (password, avatar, AI name, own
              log). Hidden on phones — the cluster would overflow 360px-wide
              viewports — where the mobile menu's Profile link covers it. */}
          <Link
            href="/profile"
            aria-label={t('nav.profile')}
            title={profile?.display_name ?? user.email ?? undefined}
            className="hidden h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line transition-shadow hover:ring-sage sm:grid"
          >
            {avatarPreset ? (
              <PresetAvatar preset={avatarPreset} size={32} />
            ) : avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden="true" className="grid h-full w-full place-items-center bg-sage text-[13px] font-[650] text-white">
                {initial}
              </span>
            )}
          </Link>
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
