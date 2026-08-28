'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { decideProposal, pendingProposalFeed, type FeedItem } from '@/app/actions/proposals';

const SEEN_KEY = 'sitekick-last-preview';

/**
 * Her notification centre: a quiet bell that only speaks when the agent needs a
 * decision. The first time a new suggestion appears it opens a preview naming
 * the possible duplicate, so Noa can judge "new or already tracked?" without
 * leaving the screen she is on.
 */
export function NotificationBell({ labels }: { labels: Record<string, string> }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<FeedItem | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    try {
      const next = await pendingProposalFeed();
      setItems(next);
      const first = next[0];
      if (first && window.localStorage.getItem(SEEN_KEY) !== first.id) {
        setPreview(first);
        window.localStorage.setItem(SEEN_KEY, first.id);
      }
    } catch {
      // A failed poll is not news — keep the last known state.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ignore = (item: FeedItem) => start(async () => {
    await decideProposal(item.id, 'ignored');
    setPreview(null);
    setOpen(false);
    await load();
  });

  const latest = items[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setPreview(null); }}
        aria-label={labels.aria.replace('{n}', String(items.length))}
        aria-expanded={open}
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink3 hover:text-ink sm:min-h-9 sm:min-w-9"
      >
        <span aria-hidden="true" className="text-base">🔔</span>
        {items.length > 0 && (
          <b className="absolute end-0.5 top-0.5 rounded-full bg-coral px-1.5 py-px text-[9px] font-bold text-white">
            {items.length}
          </b>
        )}
      </button>

      {preview && (
        <aside
          role="status"
          className="fixed inset-x-3 top-16 z-50 origin-top rounded-(--radius-card) border border-line bg-card p-4 shadow-card motion-safe:animate-sk-pop sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-80"
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label={labels.close}
            className="float-end min-h-11 min-w-11 text-ink3 hover:text-ink sm:min-h-0 sm:min-w-0"
          >
            ×
          </button>
          <small className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sage">{labels.newSuggestion}</small>
          <strong className="mt-1 block text-xs text-ink3">{preview.projectName ?? labels.general}</strong>
          <h3 className="mt-1 font-serif text-base text-ink">{preview.title}</h3>
          {preview.matchedTitle ? (
            <p className="mt-2 rounded-lg bg-apricot-soft px-2.5 py-2 text-[11px] text-ink2">
              <b className="font-semibold text-apricot">{labels.dup.replace('{n}', String(preview.matchScore))}</b>
              <span className="mt-1 block">
                {labels.already} {preview.matchedTitle}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-ink2">{labels.maybeNew}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href="/inbox"
              onClick={() => setPreview(null)}
              className="min-h-11 rounded-[9px] bg-sage px-3 py-2 text-xs font-semibold text-white sm:min-h-0"
            >
              {labels.reviewNow}
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={() => ignore(preview)}
              className="min-h-11 rounded-[9px] border border-line px-3 py-2 text-xs text-ink2 disabled:opacity-50 sm:min-h-0"
            >
              {labels.notRelevant}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-11 px-2 text-xs text-ink3 hover:text-ink sm:min-h-0"
            >
              {labels.later}
            </button>
          </div>
        </aside>
      )}

      {open && (
        <aside className="fixed inset-x-3 top-16 z-50 origin-top rounded-(--radius-card) border border-line bg-card p-4 shadow-card motion-safe:animate-sk-pop sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-2 sm:w-72">
          <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
            <strong className="font-serif text-sm text-ink">{labels.title}</strong>
            <span className="text-[10px] text-ink3">{labels.waiting.replace('{n}', String(items.length))}</span>
          </header>
          {latest ? (
            <div className="mt-2">
              <small className="text-[10px] text-ink3">{latest.projectName ?? labels.general}</small>
              <b className="mt-0.5 block text-xs font-medium text-ink">{latest.title}</b>
              {latest.matchedTitle && (
                <p className="mt-1 text-[10px] text-apricot">{labels.dupShort} {latest.matchedTitle}</p>
              )}
              <Link
                href="/inbox"
                onClick={() => setOpen(false)}
                className="mt-2 inline-block min-h-11 text-xs font-semibold text-sage sm:min-h-0"
              >
                {labels.openReview}
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-ink3">{labels.empty}</p>
          )}
        </aside>
      )}
    </div>
  );
}
