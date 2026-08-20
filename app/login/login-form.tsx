'use client';

import { useState, useTransition } from 'react';
import { signIn } from '@/app/actions/auth';

interface Labels { email: string; password: string; submit: string; error: string }

export function LoginForm({ labels }: { labels: Labels }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-6 space-y-4"
      action={(fd) => start(async () => {
        setError(null);
        const result = await signIn(fd);
        if (result?.error) setError(labels.error);
      })}
    >
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm text-ink2">{labels.email}</label>
        <input
          id="email" name="email" type="email" required autoComplete="email"
          className="w-full rounded-lg border border-line bg-card2 px-3 py-2 text-ink outline-none focus:border-mist"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm text-ink2">{labels.password}</label>
        <input
          id="password" name="password" type="password" required autoComplete="current-password"
          className="w-full rounded-lg border border-line bg-card2 px-3 py-2 text-ink outline-none focus:border-mist"
        />
      </div>
      {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-lg bg-sage px-4 py-2 font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? '…' : labels.submit}
      </button>
    </form>
  );
}
