'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions/prefs';
import type { Locale } from '@/lib/i18n';

export function LocaleToggle({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        await setLocale(locale === 'en' ? 'he' : 'en');
        router.refresh();
      })}
      className="min-h-11 cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2 shadow-card transition-colors hover:text-ink sm:min-h-0"
    >
      {label}
    </button>
  );
}
