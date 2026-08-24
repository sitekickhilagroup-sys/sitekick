'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { decideProposal, undoProposalDecision, type ReviewDecision } from '@/app/actions/proposals';
import type { ChangeType, ProposalState } from '@/lib/types';

export interface ReviewRow {
  id: string;
  projectName: string | null;
  title: string;
  phase: string;
  substage: string;
  owner: string;
  due: string;
  confidence: string;          // High / Medium / Low, from the stored 0-1 score
  evidence: string;
  changeType: ChangeType;
  resultNote: string;
  matchScore: number;          // 0 when nothing matched
  matchReason: string;
  state: ProposalState;
  matched: null | {
    title: string; status: string; owner: string;
    phase: string; substage: string; due: string; latestUpdate: string;
  };
}

const FILTERS: { key: string; labelKey: string }[] = [
  { key: 'pending', labelKey: 'needs' },
  { key: 'not_sure', labelKey: 'unsure' },
  { key: 'accepted', labelKey: 'approved' },
  { key: 'ignored', labelKey: 'ignored' },
  { key: 'rejected', labelKey: 'wrong' },
  { key: 'all', labelKey: 'history' },
];

const TREATMENTS: ChangeType[] = [
  'new_task', 'update_existing', 'complete_existing', 'merge_duplicate',
  // The corrections doc asks for this and the drawer did not offer it: keep
  // both records and record the dependency between them.
  'keep_both_linked', 'keep_open', 'information_only',
];

// Her confidence chip: colour is the claim's strength, never the decision.
const confTone = (c: string) =>
  c === 'High' ? 'bg-sage-soft text-sage'
    : c === 'Medium' ? 'bg-apricot-soft text-apricot'
      : 'bg-inset text-ink3';

const stateTone = (s: ProposalState) =>
  s === 'accepted' || s === 'auto_applied' ? 'bg-sage-soft text-sage'
    : s === 'rejected' ? 'bg-coral-soft text-coral'
      : s === 'not_sure' ? 'bg-apricot-soft text-apricot'
        : s === 'ignored' ? 'bg-inset text-ink3'
          : 'bg-mist-soft text-mist';

export function ReviewBoard({ rows, labels }: { rows: ReviewRow[]; labels: Record<string, string> }) {
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [toast, setToast] = useState<{ text: string; undoId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  // Drawer edits live here so the buttons send what Noa actually sees.
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [treatment, setTreatment] = useState<ChangeType>('new_task');
  const [note, setNote] = useState('');

  const open = (row: ReviewRow) => {
    setSelected(row);
    setTitle(row.title);
    setOwner(row.owner);
    setDue(/^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : '');
    setTreatment(row.changeType);
    setNote(row.resultNote);
    setFailed(false);
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    for (const f of FILTERS) if (f.key !== 'all') map[f.key] = rows.filter((r) => r.state === f.key).length;
    return map;
  }, [rows]);

  const visible = useMemo(
    () => rows.filter((r) => filter === 'all' || r.state === filter),
    [rows, filter],
  );

  const decide = (decision: ReviewDecision, override?: { changeType?: ChangeType }) => {
    if (!selected) return;
    start(async () => {
      setFailed(false);
      const res = await decideProposal(selected.id, decision, {
        title, owner, due,
        changeType: override?.changeType ?? treatment,
        resultNote: note,
      });
      if ('error' in res) { setFailed(true); return; }
      setSelected(null);
      setToast({ text: labels[`done.${decision}`] ?? labels['done.approved'], undoId: res.undoId });
    });
  };

  const undo = (undoId: string) => start(async () => {
    const res = await undoProposalDecision(undoId);
    setToast({ text: 'error' in res ? labels.undoFailed : labels.undone, undoId: null });
  });

  return (
    <>
      <div className="mt-5 grid gap-3 lg:grid-cols-[186px_minmax(0,1fr)]">
        <aside className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs whitespace-nowrap ${
                filter === f.key
                  ? 'border-sage-line bg-sage-soft font-semibold text-sage'
                  : 'border-line bg-card text-ink2 hover:border-sage-line'
              }`}
            >
              <span>{labels[f.labelKey]}</span>
              <b className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold text-ink3">{counts[f.key] ?? 0}</b>
            </button>
          ))}
        </aside>

        <section className="rounded-(--radius-card) border border-line bg-card">
          {visible.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-serif text-lg text-ink">{labels.emptyTitle}</p>
              <p className="mt-1 text-xs text-ink3">{labels.emptySub}</p>
            </div>
          ) : (
            <ul>
              {visible.map((r) => (
                <li key={r.id} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    onClick={() => open(r)}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-3.5 text-start hover:bg-card2"
                  >
                    <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${confTone(r.confidence)}`}>
                      {r.matchScore ? `${r.matchScore}% ${labels.match}` : r.confidence}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] tracking-[0.08em] text-ink3 uppercase">
                        {[r.projectName ?? labels.general, r.phase].filter(Boolean).join(' · ')}
                      </span>
                      <strong className="mt-0.5 block text-sm font-medium text-ink">{r.title}</strong>
                      <span className="mt-1 block text-[11px] text-ink3">
                        {r.matched
                          ? <><b className="font-semibold text-apricot">{labels.possibleDup}</b> {r.matched.title} — {r.matched.status}</>
                          : labels.noMatch}
                      </span>
                    </span>
                    <span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${stateTone(r.state)}`}>
                      {labels[`state.${r.state}`] ?? r.state}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selected && (
        <>
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 cursor-default bg-ink/30"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={labels.kicker}
            onKeyDown={(e) => { if (e.key === 'Escape') setSelected(null); }}
            className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[560px] flex-col border-s border-line bg-card shadow-card"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.14em] text-ink3 uppercase">{labels.kicker}</p>
                <strong className="mt-0.5 block font-serif text-lg text-ink">{selected.projectName ?? labels.general}</strong>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={labels.close}
                className="min-h-11 min-w-11 cursor-pointer text-xl text-ink3 hover:text-ink"
              >
                ×
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {selected.matched && (
                <section className="rounded-(--radius-card) border border-line bg-apricot-soft/40 p-3">
                  <header className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold tracking-[0.1em] text-apricot uppercase">{labels.dupFound}</p>
                      <strong className="text-sm text-ink">{selected.matchScore}% {labels.likelyMatch}</strong>
                    </div>
                    <span className="text-[10px] text-ink3">{labels.reviewHere}</span>
                  </header>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <article className="rounded-xl border border-line bg-card p-3">
                      <p className="text-[9px] font-semibold tracking-[0.08em] text-ink3 uppercase">{labels.existing}</p>
                      <strong className="mt-1 block text-sm text-ink">{selected.matched.title}</strong>
                      <dl className="mt-2 space-y-1 text-[11px]">
                        {[
                          [labels.fStatus, selected.matched.status],
                          [labels.fOwner, selected.matched.owner],
                          [labels.fLocation, [selected.matched.phase, selected.matched.substage].filter(Boolean).join(' — ')],
                          [labels.fDue, selected.matched.due],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <dt className="text-ink3">{k}</dt>
                            <dd className="text-end text-ink2">{v || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                      {selected.matched.latestUpdate && (
                        <aside className="mt-2 border-t border-line pt-2">
                          <p className="text-[9px] font-semibold tracking-[0.08em] text-ink3 uppercase">{labels.latestUpdate}</p>
                          <p className="mt-1 text-[11px] text-ink2">{selected.matched.latestUpdate}</p>
                        </aside>
                      )}
                    </article>
                    <b className="text-center text-lg text-ink3">⇄</b>
                    <article className="rounded-xl border border-line bg-card p-3">
                      <p className="text-[9px] font-semibold tracking-[0.08em] text-ink3 uppercase">{labels.newInfo}</p>
                      <strong className="mt-1 block text-sm text-ink">{selected.title}</strong>
                      <dl className="mt-2 space-y-1 text-[11px]">
                        {[
                          [labels.fOwner, selected.owner],
                          [labels.fLocation, [selected.phase, selected.substage].filter(Boolean).join(' — ')],
                          [labels.fDue, selected.due],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <dt className="text-ink3">{k}</dt>
                            <dd className="text-end text-ink2">{v || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                      {selected.evidence && (
                        <aside className="mt-2 border-t border-line pt-2">
                          <p className="text-[9px] font-semibold tracking-[0.08em] text-ink3 uppercase">{labels.sourceSays}</p>
                          <p className="mt-1 text-[11px] text-ink2">{selected.evidence}</p>
                        </aside>
                      )}
                    </article>
                  </div>
                  {selected.matchReason && (
                    <footer className="mt-3 border-t border-line pt-2">
                      <p className="text-[9px] font-semibold tracking-[0.08em] text-ink3 uppercase">{labels.whySame}</p>
                      <p className="mt-1 text-[11px] text-ink2">{selected.matchReason}</p>
                    </footer>
                  )}
                </section>
              )}

              <section className="rounded-(--radius-card) border border-line bg-inset p-3">
                <p className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.treatment}</p>
                <p className="mt-1 text-[11px] text-ink3">{labels.treatmentSub}</p>
                <select
                  value={treatment}
                  onChange={(e) => setTreatment(e.target.value as ChangeType)}
                  aria-label={labels.treatment}
                  className="mt-2 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none"
                >
                  {TREATMENTS.map((t) => (
                    <option key={t} value={t}>{labels[`ct.${t}`]}</option>
                  ))}
                </select>
              </section>

              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fAction}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fPhase}</span>
                  <p className="mt-1 min-h-11 rounded-lg border border-line bg-inset px-3 py-2.5 text-sm text-ink2">{selected.phase || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fSubstage}</span>
                  <p className="mt-1 min-h-11 rounded-lg border border-line bg-inset px-3 py-2.5 text-sm text-ink2">{selected.substage || '—'}</p>
                </div>
                <label className="block">
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fOwner}</span>
                  <input
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fDue}</span>
                  <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fResult}</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder={labels.resultPh}
                  className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                />
              </label>
              {failed && <p role="alert" className="text-xs text-coral">{labels.error}</p>}
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
              {selected.state !== 'pending' ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => decide('pending')}
                  className="min-h-11 cursor-pointer rounded-[9px] border border-line px-4 py-2 text-sm text-ink2 disabled:opacity-50"
                >
                  {labels.restore}
                </button>
              ) : (
                <>
                  <button
                    type="button" disabled={pending} onClick={() => decide('rejected')}
                    className="min-h-11 cursor-pointer rounded-[9px] border border-line px-3 py-2 text-xs text-coral disabled:opacity-50"
                  >
                    {labels.wrongBtn}
                  </button>
                  <button
                    type="button" disabled={pending} onClick={() => decide('not_sure')}
                    className="min-h-11 cursor-pointer rounded-[9px] border border-line px-3 py-2 text-xs text-ink2 disabled:opacity-50"
                  >
                    {labels.unsure}
                  </button>
                  <button
                    type="button" disabled={pending} onClick={() => decide('ignored')}
                    className="min-h-11 cursor-pointer rounded-[9px] border border-line px-3 py-2 text-xs text-ink2 disabled:opacity-50"
                  >
                    {labels.ignored}
                  </button>
                  {selected.matched && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide('approved', { changeType: 'complete_existing' })}
                      className="min-h-11 cursor-pointer rounded-[9px] border border-sage-line px-3 py-2 text-xs text-sage disabled:opacity-50"
                    >
                      {labels.alreadyDone}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decide('approved')}
                    className="ms-auto min-h-11 cursor-pointer rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {labels.apply}
                  </button>
                </>
              )}
            </footer>
          </aside>
        </>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card"
        >
          <span className="flex-1 text-sm text-ink">{toast.text}</span>
          {toast.undoId && (
            <button
              type="button"
              disabled={pending}
              onClick={() => undo(toast.undoId as string)}
              className="min-h-11 cursor-pointer rounded-lg border border-sage-line px-3 py-1 text-xs text-sage disabled:opacity-50"
            >
              {labels.undo}
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label={labels.close}
            className="min-h-11 min-w-11 cursor-pointer text-ink3 hover:text-ink"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
