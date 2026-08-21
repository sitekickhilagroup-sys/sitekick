'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setTheme } from '@/app/actions/prefs';

export function ThemeToggle({ theme, label }: { theme: 'light' | 'dark'; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={theme === 'dark'}
      disabled={pending}
      onClick={() => start(async () => {
        await setTheme(next);
        router.refresh();
      })}
      className="min-h-11 min-w-11 cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-xs text-ink2 shadow-card transition-colors hover:text-ink sm:min-h-0 sm:min-w-0"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
