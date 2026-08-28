'use client';

import { useState, useTransition } from 'react';
import { createAppUser, deleteAppUser, type AppUser } from '@/app/actions/users';
import { fmtDate } from '@/lib/format';

export interface UserLabels {
  email: string; add: string; remove: string; confirmRemove: string;
  lastSeen: string; never: string; tempPass: string; copy: string;
}

export function UsersCard({ users, meId, labels }: { users: AppUser[]; meId: string; labels: UserLabels }) {
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line2 rounded-lg border border-line">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-ink">{u.email}</span>
            {u.id === meId && <span className="rounded-full bg-sage-soft px-2 py-0.5 text-[10px] text-sage">you</span>}
            <span className="ms-auto text-xs text-ink3">
              {labels.lastSeen}: {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : labels.never}
            </span>
            {u.id !== meId && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`${labels.confirmRemove} ${u.email}?`)) return;
                  start(async () => {
                    const r = await deleteAppUser(u.id);
                    if (r.error) setError(r.error);
                  });
                }}
                className="min-h-11 cursor-pointer rounded-full border border-line px-2 py-0.5 text-[11px] text-coral hover:bg-coral-soft disabled:opacity-50 sm:min-h-0"
              >
                {labels.remove}
              </button>
            )}
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-end gap-2"
        action={(fd) => start(async () => {
          setError('');
          setCreated(null);
          const r = await createAppUser(fd);
          if (r.error) setError(r.error);
          else if (r.email && r.password) setCreated({ email: r.email, password: r.password });
        })}
      >
        <label className="text-xs text-ink2">
          {labels.email}
          <input name="email" type="email" required placeholder="name@company.com"
            className="ms-1 min-h-11 w-64 max-w-full rounded-lg border border-line bg-card2 px-2 py-1.5 text-sm text-ink sm:min-h-0" />
        </label>
        <button type="submit" disabled={pending} aria-busy={pending}
          className="min-h-11 cursor-pointer rounded-lg bg-sage px-4 py-1.5 text-sm text-white disabled:opacity-60 sm:min-h-0">
          + {labels.add}
        </button>
      </form>

      {created && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sage-soft px-3 py-2 text-sm text-ink">
          <span>{labels.tempPass} <b>{created.email}</b>:</span>
          <code className="rounded bg-card px-2 py-0.5 font-mono">{created.password}</code>
          <button type="button"
            onClick={() => navigator.clipboard.writeText(`${created.email} / ${created.password}`).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => setCopied(false),
            )}
            className="min-h-11 cursor-pointer rounded-full border border-sage-line px-2 py-0.5 text-[11px] text-sage hover:bg-card sm:min-h-0">
            {labels.copy}{copied && <span aria-hidden="true" className="ms-1">✓</span>}
          </button>
          {copied && <span role="status" className="sr-only">{labels.copy} ✓</span>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-coral">{error}</p>}
    </div>
  );
}
