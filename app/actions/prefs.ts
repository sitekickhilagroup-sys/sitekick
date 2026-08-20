'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, type Locale } from '@/lib/i18n';

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { maxAge: YEAR, path: '/' });
}

export async function setTheme(theme: 'light' | 'dark') {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, { maxAge: YEAR, path: '/' });
}
