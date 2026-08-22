'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { processPastedUpdate } from '@/app/actions/process-text';

/**
 * Her "paste one project update" processor. The text goes through the same
 * reconciliation the mailbox will use: identify the project, compare against
 * open tasks, then either attach evidence or raise a reviewable proposal.
 */
export function PasteUpdate({ labels }: { labels: Record<string, string> }) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad'; review: boolean } | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    setOutcome(null);
    const res = await processPastedUpdate(text);
    if ('error' in res) {
      setOutcome({
        text: res.error === 'multi_project'
          ? labels.errMulti.replace('{names}', res.detail ?? '')
          : labels[`err.${res.error}`] ?? labels['err.save'],
        tone: 'bad',
        review: false,
      });
      return;
    }
    setText('');
    if (res.kind === 'auto') {
      setOutcome({ text: labels.resAuto.replace('{task}', res.taskTitle), tone: 'ok', review: false });
    } else if (res.kind === 'match') {
      setOutcome({
        text: labels.resMatch.replace('{n}', String(res.score)).replace('{task}', res.taskTitle),
        tone: 'warn',
        review: true,
      });
    } else {
      setOutcome({ text: labels.resNew.replace('{title}', res.title), tone: 'warn', review: true });
    }
  });

  const tone = outcome?.tone === 'ok' ? 'bg-sage-soft text-sage'
    : outcome?.tone === 'warn' ? 'bg-apricot-soft text-apricot'
      : 'bg-coral-soft text-coral';

  return (
    <section className="rounded-(--radius-card) border border-line bg-card p-4 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sage">{labels.kicker}</p>
      <h2 className="mt-1 font-serif text-lg text-ink">{labels.title}</h2>
      <p className="mt-1 max-w-2xl text-xs text-ink2">{labels.sub}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={labels.ph}
        aria-label={labels.title}
        className="mt-3 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || text.trim().length < 12}
          onClick={submit}
          className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:min-h-0"
        >
          {pending ? labels.working : labels.btn}
        </button>
        {outcome && (
          <span role="status" className={`rounded-lg px-2.5 py-1.5 text-[11px] ${tone}`}>
            {outcome.text}
            {outcome.review && (
              <Link href="/inbox" className="ms-2 font-semibold underline">{labels.openReview}</Link>
            )}
          </span>
        )}
      </div>
    </section>
  );
}
