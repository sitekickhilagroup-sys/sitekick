import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';

// Common shell for the (standard) and (focused) route groups. proxy.ts is the
// primary auth gate, but its matcher excludes image extensions — so a dynamic
// segment like /projects/<id>.png slips past it with no session check. This
// requireUser() at the single shared ancestor of every dash route is the
// structural backstop: it doesn't depend on AppHeader (whose requireUser()
// exists to fetch an avatar, not as a gate) or on any page remembering to check.
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireUser();
  } catch {
    redirect('/login');
  }
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:shadow-card"
      >
        {t('nav.skip')}
      </a>
      {children}
    </div>
  );
}
