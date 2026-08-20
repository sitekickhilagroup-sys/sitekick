'use client';

import { useTransition } from 'react';
import { setDraftStatus } from '@/app/actions/drafts';
import type { Draft } from '@/lib/types';

interface Labels {
  approve: string; dismiss: string; copy: string; openMail: string; markSent: string;
  statusLabel: Record<string, string>;
}

export function DraftCard({ draft, labels }: { draft: Draft; labels: Labels }) {
  const [pending, start] = useTransition();
  const act = (status: 'approved' | 'dismissed' | 'sent') =>
    start(async () => { await setDraftStatus(draft.id, status); });

  const mailto = `mailto:${draft.to_email ?? ''}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;

  return (
    <article className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{draft.subject}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${
          draft.status === 'proposed' ? 'bg-apricot-soft text-apricot'
          : draft.status === 'approved' ? 'bg-sage-soft text-sage'
          : draft.status === 'sent' ? 'bg-mist-soft text-mist'
          : 'bg-inset text-ink3'
        }`}>
          {labels.statusLabel[draft.status] ?? draft.status}
        </span>
      </div>
      {draft.to_email && <p className="mt-0.5 text-xs text-ink3">→ {draft.to_email}</p>}
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-card2 p-3 text-sm leading-relaxed text-ink2">{draft.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {draft.status === 'proposed' && (
          <>
            <button type="button" disabled={pending} onClick={() => act('approved')}
              className="rounded-lg bg-sage px-3 py-1 text-xs text-white disabled:opacity-50">
              {labels.approve}
            </button>
            <button type="button" disabled={pending} onClick={() => act('dismissed')}
              className="rounded-lg border border-line px-3 py-1 text-xs text-ink2 disabled:opacity-50">
              {labels.dismiss}
            </button>
          </>
        )}
        {draft.status === 'approved' && (
          <>
            <a href={mailto} className="rounded-lg bg-mist px-3 py-1 text-xs text-white">{labels.openMail}</a>
            <button type="button"
              onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}
              className="rounded-lg border border-line px-3 py-1 text-xs text-ink2">
              {labels.copy}
            </button>
            <button type="button" disabled={pending} onClick={() => act('sent')}
              className="rounded-lg border border-sage-line px-3 py-1 text-xs text-sage disabled:opacity-50">
              {labels.markSent}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
