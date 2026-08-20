import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-(--radius-card) border border-line bg-card p-8 shadow-card">
        <h1 className="font-serif text-2xl text-ink">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-ink3">{t('app.tagline')}</p>
        <LoginForm
          labels={{
            email: t('login.email'),
            password: t('login.password'),
            submit: t('login.submit'),
            error: t('login.error'),
          }}
        />
      </div>
    </main>
  );
}
