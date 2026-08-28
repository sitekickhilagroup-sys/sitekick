'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveProfile, uploadAvatar, changePassword } from '@/app/actions/profile';
import { PRESET_KEYS, presetOf } from '@/lib/avatar-presets';
import { PresetAvatar } from './preset-avatar';

type Labels = Record<string, string>;

// The named, deterministic errors the profile actions can return, mapped to
// translated strings; anything else is interpolated into errorSave.
function actionError(code: string, labels: Labels): string {
  const known: Record<string, string | undefined> = {
    pw_short: labels.errPwShort,
    pw_mismatch: labels.errPwMismatch,
    pw_wrong: labels.errPwWrong,
    too_large: labels.errTooLarge,
    bad_type: labels.errBadType,
    no_file: labels.errBadType,
    invalid_preset: labels.errSaveGeneric,
    no_email: labels.errSaveGeneric,
  };
  return known[code] ?? labels.errSave.replace('{reason}', code);
}

function AvatarCircle({ avatar, initial, size }: { avatar: string | null; initial: string; size: number }) {
  const preset = presetOf(avatar);
  if (preset) return <PresetAvatar preset={preset} size={size} />;
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatar}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  // No avatar chosen yet — neutral initial circle.
  return (
    <span
      aria-hidden="true"
      className="grid place-items-center rounded-full bg-sage font-[650] text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}

export function IdentityForm({
  displayName,
  avatar,
  initial,
  labels,
}: {
  displayName: string;
  avatar: string | null;
  initial: string;
  labels: Labels;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(displayName);
  const [preset, setPreset] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shownAvatar = preset ? `preset:${preset}` : avatar;
  const shownInitial = (name.trim() || initial).slice(0, 1).toUpperCase();

  const save = () => start(async () => {
    setMessage(null);
    const fd = new FormData();
    fd.set('display_name', name);
    if (preset) fd.set('avatar_preset', preset);
    const res = await saveProfile(fd);
    if ('error' in res) { setMessage({ ok: false, text: actionError(res.error, labels) }); return; }
    setMessage({ ok: true, text: labels.saved });
    setPreset(null);
    router.refresh();
  });

  const upload = (file: File | null) => {
    if (!file) return;
    start(async () => {
      setMessage(null);
      const fd = new FormData();
      fd.set('file', file);
      const res = await uploadAvatar(fd);
      if (fileRef.current) fileRef.current.value = '';
      if ('error' in res) { setMessage({ ok: false, text: actionError(res.error, labels) }); return; }
      setPreset(null);
      setMessage({ ok: true, text: labels.saved });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <AvatarCircle avatar={shownAvatar} initial={shownInitial} size={64} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-[650] text-sk-ink">{name.trim() || initial}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className="mt-1 min-h-11 cursor-pointer rounded-[8px] bg-sk-surface-soft px-3 py-1.5 text-[11px] font-[650] text-sk-ink hover:bg-card2 disabled:opacity-50 sm:min-h-0"
          >
            {labels.uploadPhoto}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-[10px] text-sk-muted">{labels.uploadHint}</p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-[650] uppercase tracking-[0.08em] text-sk-muted">{labels.choosePreset}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_KEYS.map((key) => {
            const selected = preset === key || (!preset && presetOf(avatar) === key);
            return (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={selected}
                onClick={() => setPreset(key)}
                className={`cursor-pointer rounded-full leading-none transition-transform hover:scale-105 ${
                  selected ? 'ring-2 ring-sk-green ring-offset-2 ring-offset-card' : ''
                }`}
              >
                <PresetAvatar preset={key} size={44} />
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="profile-name" className="block text-[10px] font-[650] uppercase tracking-[0.08em] text-sk-muted">
          {labels.displayName}
        </label>
        <input
          id="profile-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.displayNamePh}
          className="mt-1.5 w-full max-w-sm rounded-[8px] border border-line bg-sk-surface px-3 py-2 text-[13px] text-sk-ink outline-none focus:border-sage"
        />
        <p className="mt-1 text-[10px] leading-[1.5] text-sk-muted">{labels.displayNameHint}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={save}
          className="min-h-11 cursor-pointer rounded-[8px] bg-sage px-4 py-2 text-[12px] font-[650] text-white hover:opacity-90 disabled:opacity-50 sm:min-h-0"
        >
          {labels.save}
        </button>
        {message && (
          <span role={message.ok ? 'status' : 'alert'} className={`text-[11px] ${message.ok ? 'text-sk-green' : 'text-coral'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function PasswordForm({ labels }: { labels: Labels }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (fd: FormData) => start(async () => {
    setMessage(null);
    const res = await changePassword(fd);
    if ('error' in res) { setMessage({ ok: false, text: actionError(res.error, labels) }); return; }
    formRef.current?.reset();
    setMessage({ ok: true, text: labels.pwChanged });
  });

  const field = (id: string, name: string, label: string, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="block text-[10px] font-[650] uppercase tracking-[0.08em] text-sk-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="password"
        required
        autoComplete={autoComplete}
        className="mt-1.5 w-full max-w-sm rounded-[8px] border border-line bg-sk-surface px-3 py-2 text-[13px] text-sk-ink outline-none focus:border-sage"
      />
    </div>
  );

  return (
    <form ref={formRef} action={submit} className="space-y-3.5">
      {field('pw-current', 'current_password', labels.currentPw, 'current-password')}
      {field('pw-new', 'new_password', labels.newPw, 'new-password')}
      {field('pw-confirm', 'confirm_password', labels.confirmPw, 'new-password')}
      <p className="text-[10px] leading-[1.5] text-sk-muted">{labels.pwHint}</p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="min-h-11 cursor-pointer rounded-[8px] bg-sage px-4 py-2 text-[12px] font-[650] text-white hover:opacity-90 disabled:opacity-50 sm:min-h-0"
        >
          {labels.changePw}
        </button>
        {message && (
          <span role={message.ok ? 'status' : 'alert'} className={`text-[11px] ${message.ok ? 'text-sk-green' : 'text-coral'}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
