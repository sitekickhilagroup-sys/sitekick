import en from './en.json';
import he from './he.json';

export type Locale = 'en' | 'he';
export const LOCALES: Locale[] = ['en', 'he'];
export const LOCALE_COOKIE = 'sk-locale';
export const THEME_COOKIE = 'sk-theme';

const dictionaries: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  he: he as Record<string, string>,
};

export function getT(locale: Locale) {
  const dict = dictionaries[locale] ?? dictionaries.en;
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = dict[key] ?? dictionaries.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

export function dictionaryKeys(locale: Locale): string[] {
  return Object.keys(dictionaries[locale]);
}
