import { cookies } from 'next/headers';
import { LOCALE_COOKIE, getT, type Locale } from '@/lib/i18n';
import { requireUser } from '@/lib/auth';
import { getProfile } from '@/lib/profile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { IdentityForm, PasswordForm } from '@/components/profile/profile-forms';

export const dynamic = 'force-dynamic';

interface LogRow {
  id: string;
  entity_type: string;
  action: string;
  created_at: string;
  after_json: Record<string, unknown> | null;
}

// A log row's human hook: the title/number the action touched, when the
// snapshot carried one. Kept short — the table stays scannable.
function logDetail(row: LogRow): string | null {
  const a = row.after_json;
  if (!a) return null;
  const detail = a.title ?? a.number ?? a.display_name ?? a.name ?? null;
  return typeof detail === 'string' && detail ? detail.slice(0, 80) : null;
}

export default async function ProfilePage() {
  const store = await cookies();
  const locale = (store.get(LOCALE_COOKIE)?.value === 'he' ? 'he' : 'en') as Locale;
  const t = getT(locale);
  const user = await requireUser();
  const admin = supabaseAdmin();

  const [profile, authUserQ, logQ] = await Promise.all([
    getProfile(user.id),
    admin.auth.admin.getUserById(user.id),
    admin.from('activity_log')
      .select('id,entity_type,action,created_at,after_json')
      .eq('actor', user.email ?? user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  const memberSince = authUserQ.data.user?.created_at?.slice(0, 10) ?? null;
  const log = (logQ.data ?? []) as LogRow[];

  const initial = (profile?.display_name ?? user.email ?? '?').slice(0, 1).toUpperCase();

  const identityLabels = {
    displayName: t('profile.display_name'),
    displayNamePh: t('profile.display_name_ph'),
    displayNameHint: t('profile.display_name_hint'),
    choosePreset: t('profile.choose_preset'),
    uploadPhoto: t('profile.upload_photo'),
    uploadHint: t('profile.upload_hint'),
    save: t('common.save'),
    saved: t('profile.saved'),
    errSave: t('profile.error_save'),
    errSaveGeneric: t('common.error_save'),
    errTooLarge: t('profile.error_too_large'),
    errBadType: t('profile.error_bad_type'),
  };
  const passwordLabels = {
    currentPw: t('profile.current_pw'),
    newPw: t('profile.new_pw'),
    confirmPw: t('profile.confirm_pw'),
    changePw: t('profile.change_pw'),
    pwChanged: t('profile.pw_changed'),
    pwHint: t('profile.pw_hint'),
    errPwShort: t('profile.error_pw_short'),
    errPwMismatch: t('profile.error_pw_mismatch'),
    errPwWrong: t('profile.error_pw_wrong'),
    errSave: t('profile.error_save'),
    errSaveGeneric: t('common.error_save'),
    errTooLarge: t('profile.error_too_large'),
    errBadType: t('profile.error_bad_type'),
  };

  return (
    <div className="sk-page mx-auto max-w-[880px] space-y-4">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{t('profile.kicker')}</p>
        <h1 className="mt-1 text-[clamp(26px,2.6vw,30px)] font-[650] leading-[1.1] tracking-[-0.035em] text-sk-ink">
          {t('profile.title')}
        </h1>
        <p className="mt-1.5 text-[11px] leading-[1.5] text-sk-muted">
          <bdi>{user.email}</bdi>
          {memberSince && <> · {t('profile.member_since').replace('{date}', `⁨${memberSince}⁩`)}</>}
        </p>
      </div>

      <section aria-labelledby="identity-h" className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
        <h2 id="identity-h" className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">
          {t('profile.identity')}
        </h2>
        <div className="mt-3.5">
          <IdentityForm
            displayName={profile?.display_name ?? ''}
            avatar={profile?.avatar ?? null}
            initial={initial}
            labels={identityLabels}
          />
        </div>
      </section>

      <section aria-labelledby="security-h" className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
        <h2 id="security-h" className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">
          {t('profile.security')}
        </h2>
        <div className="mt-3.5">
          <PasswordForm labels={passwordLabels} />
        </div>
      </section>

      <section aria-labelledby="activity-h" className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
        <h2 id="activity-h" className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">
          {t('profile.activity')}
        </h2>
        <p className="mt-1 text-[10px] leading-[1.5] text-sk-muted">{t('profile.activity_sub')}</p>
        {log.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-sk-muted">{t('profile.activity_empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line2">
            {log.map((row) => {
              const detail = logDetail(row);
              return (
                <li key={row.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5">
                  <span className="rounded-[6px] bg-sk-surface-soft px-1.5 py-0.5 font-mono text-[9px] uppercase text-sk-muted">
                    {row.entity_type}
                  </span>
                  <span className="min-w-0 truncate text-[11px] text-sk-ink">
                    <span className="font-mono text-[10px]">{row.action}</span>
                    {detail && <span className="text-sk-muted"> · <bdi>{detail}</bdi></span>}
                  </span>
                  <span className="font-mono text-[9px] text-sk-muted">
                    <bdi>{row.created_at.slice(0, 16).replace('T', ' ')}</bdi>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
