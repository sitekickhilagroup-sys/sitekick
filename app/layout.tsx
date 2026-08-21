import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { LOCALE_COOKIE, THEME_COOKIE, dirFor, type Locale } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sitekick',
  description: 'Hilla Group development operations',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const theme = store.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
