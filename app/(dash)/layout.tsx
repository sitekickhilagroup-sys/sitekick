import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';

// Common shell for the (standard) and (focused) route groups. Auth is enforced
// in proxy.ts by pathname, not here, so route grouping cannot affect it.
// The header and <main id="main"> live in the group layouts — the three focused
// pages replace the header with their own during the redesign, and a layout at
// this level would reach every route including the protected More section.
export default async function DashLayout({ children }: { children: React.ReactNode }) {
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
