'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { retargetComment, promoteHistoricalNote, correctCommentIntent } from '@/app/actions/comments';
import { INTENTS, type CommentIntent } from '@/lib/comment-intent';
import type { NoteSource, NoteState } from '@/lib/notes-center';

export interface NotesCenterRow {
  id: string;
  source: NoteSource;
  body: string;
  createdAt: string;
  /** The task a historical item came from (null for a real comment). */
  sourceTaskId: string | null;
  /** Where it currently lives, as a display label (task/project/blocker name),
   *  or null when nothing is set yet. */
  currentLabel: string | null;
  suggestedIntent: CommentIntent;
  intent: CommentIntent;
  state: NoteState;
  candidates: { kind: 'task' | 'project' | 'blocker'; id: string; label: string; score: number; why: string }[];
  ambiguous: boolean;
  clarifyingQuestion: string | null;
}

const FILTERS: { key: 'needs_review' | 'associated' | 'general' | 'all'; labelKey: string }[] = [
  { key: 'needs_review', labelKey: 'filterNeedsReview' },
  { key: 'associated', labelKey: 'filterAssociated' },
  { key: 'general', labelKey: 'filterGeneral' },
  { key: 'all', labelKey: 'filterAll' },
];

export function NotesCenterBoard({ rows, counts, taskOptions, projectOptions, blockerOptions, labels }: {
  rows: NotesCenterRow[];
  counts: Record<'needs_review' | 'associated' | 'general' | 'all', number>;
  taskOptions: { id: string; label: string }[];
  projectOptions: { id: string; label: string }[];
  blockerOptions: { id: string; label: string }[];
  labels: Record<string, string>;
}) {
  const [filter, setFilter] = useState<'needs_review' | 'associated' | 'general' | 'all'>('needs_review');
  const [selected, setSelected] = useState<NotesCenterRow | null>(null);
  const [intent, setIntent] = useState<CommentIntent>('fact');
  const [targetKind, setTargetKind] = useState<'task' | 'project' | 'blocker' | 'general'>('general');
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(
    () => filter === 'all' ? rows : rows.filter((r) => r.state === filter),
    [rows, filter],
  );

  const open = (row: NotesCenterRow) => {
    setSelected(row);
    setIntent(row.intent);
    setSearch('');
    // Seed the target from the top candidate when nothing is set yet — a
    // clear existing association is offered as the default, never re-asked
    // without reason (Noa's report §2).
    const top = row.candidates[0];
    if (row.currentLabel && row.candidates.length === 0) {
      setTargetKind('general');
      setTargetId('');
    } else if (top && top.score >= 60) {
      setTargetKind(top.kind);
      setTargetId(top.id);
    } else {
      setTargetKind('general');
      setTargetId('');
    }
  };

  const searchPool = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as { kind: 'task' | 'project' | 'blocker'; id: string; label: string }[];
    const pools: { kind: 'task' | 'project' | 'blocker'; id: string; label: string }[] = [
      ...taskOptions.map((o) => ({ kind: 'task' as const, id: o.id, label: o.label })),
      ...projectOptions.map((o) => ({ kind: 'project' as const, id: o.id, label: o.label })),
      ...blockerOptions.map((o) => ({ kind: 'blocker' as const, id: o.id, label: o.label })),
    ];
    return pools.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [search, taskOptions, projectOptions, blockerOptions]);

  const save = (forceGeneral = false) => {
    if (!selected) return;
    const kind = forceGeneral ? 'general' : targetKind;
    const id = forceGeneral ? null : (kind === 'general' ? null : targetId);
    if (!forceGeneral && kind !== 'general' && !id) { setToast(labels.error); return; }
    start(async () => {
      if (selected.source === 'assistant') {
        // Two independent writes for a real comment row: the association
        // (retargetComment) and, if the "We read this as…" select was
        // changed from what it already was, the reinterpretation
        // (correctCommentIntent) — retargetComment has no intent field at
        // all, so this was previously silently discarded: the preview text
        // below the select ("Fact → Preference") would show, Save would
        // report success, and the intent would never actually change.
        const res = await retargetComment(selected.id, kind, id);
        if ('error' in res) { setToast(`${labels.error}: ${res.error}`); return; }
        if (intent !== selected.intent) {
          const intentRes = await correctCommentIntent(selected.id, intent);
          if ('error' in intentRes) { setToast(`${labels.error}: ${intentRes.error}`); return; }
        }
      } else {
        const res = await promoteHistoricalNote({
          taskId: selected.sourceTaskId as string, body: selected.body, intent, entityType: kind, entityId: id,
        });
        if ('error' in res) { setToast(`${labels.error}: ${res.error}`); return; }
      }
      setToast(labels.saved);
      setSelected(null);
    });
  };

  const fieldLabel = (kind: string) =>
    kind === 'task' ? labels.linkTask : kind === 'project' ? labels.linkProject
      : kind === 'blocker' ? labels.linkBlocker : labels.linkGeneral;

  return (
    <>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
              filter === f.key ? 'border-sage-line bg-sage-soft font-semibold text-sage' : 'border-line bg-card text-ink2 hover:border-sage-line'
            }`}
          >
            {labels[f.labelKey]}
            <b className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold text-ink3">{counts[f.key]}</b>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink3">{labels.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {visible.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => open(row)}
                className="w-full rounded-(--radius-card) border border-line bg-card p-3.5 text-start hover:bg-card2"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] tracking-[0.08em] text-ink3 uppercase">
                      {row.source === 'assistant' ? labels.sourceAssistant : labels.sourceHistorical}
                      {row.currentLabel ? ` · ${row.currentLabel}` : ''}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-ink">{row.body}</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-inset px-2 py-1 text-[10px] font-semibold text-ink3">
                    {labels[`intent.${row.intent}`]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <>
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-40 cursor-default bg-ink/30 motion-safe:animate-sk-fade"
          />
          <aside
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[520px] flex-col border-s border-line bg-card shadow-card motion-safe:animate-sk-slide-end"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-ink3 uppercase">
                {selected.source === 'assistant' ? labels.sourceAssistant : labels.sourceHistorical}
              </p>
              <button type="button" onClick={() => setSelected(null)} aria-label={labels.close}
                className="min-h-11 min-w-11 text-xl text-ink3 hover:text-ink">×</button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <section className="rounded-(--radius-card) border border-line bg-inset p-3">
                <p className="text-sm text-ink">{selected.body}</p>
                {selected.currentLabel && (
                  selected.sourceTaskId ? (
                    <Link
                      href={`/work?view=all&task=${selected.sourceTaskId}#task-${selected.sourceTaskId}`}
                      className="mt-2 inline-block text-[11px] font-medium text-sage hover:underline"
                    >
                      {labels.openTask} → {selected.currentLabel}
                    </Link>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink3">{labels.current}: {selected.currentLabel}</p>
                  )
                )}
                {selected.source === 'historical_attributed' && (
                  <p className="mt-2 text-[10px] text-apricot">{labels.historicalWarning}</p>
                )}
              </section>

              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.weRead}</span>
                <select
                  value={intent}
                  onChange={(e) => setIntent(e.target.value as CommentIntent)}
                  className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                >
                  {INTENTS.map((i) => <option key={i} value={i}>{labels[`intent.${i}`]}</option>)}
                </select>
                {selected.suggestedIntent !== intent && (
                  <span className="mt-1 block text-[10px] text-ink3">
                    ({labels[`intent.${selected.suggestedIntent}`]} → {labels[`intent.${intent}`]})
                  </span>
                )}
              </label>

              <section>
                <p className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.whereBelongs}</p>
                {selected.clarifyingQuestion && (
                  <p className="mt-1.5 rounded-lg border border-apricot/40 bg-apricot-soft/40 p-2 text-[11px] text-ink2">
                    {labels.ambiguousIntro}
                  </p>
                )}
                {selected.candidates.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {selected.candidates.map((c) => (
                      <li key={`${c.kind}:${c.id}`}>
                        <button
                          type="button"
                          onClick={() => { setTargetKind(c.kind); setTargetId(c.id); }}
                          className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm ${
                            targetKind === c.kind && targetId === c.id
                              ? 'border-sage-line bg-sage-soft text-sage'
                              : 'border-line bg-card text-ink2 hover:border-sage-line'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <b className="me-1.5 text-[9px] font-semibold tracking-[0.06em] text-ink3 uppercase">{fieldLabel(c.kind)}</b>
                            {c.label}
                          </span>
                          <span className="shrink-0 text-[10px] text-ink3">{c.score}%</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[11px] text-ink3">{labels.noCandidates}</p>
                )}

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={labels.searchPlaceholder}
                  className="mt-2 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                />
                {searchPool.length > 0 && (
                  <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-line">
                    {searchPool.map((o) => (
                      <li key={`${o.kind}:${o.id}`}>
                        <button
                          type="button"
                          onClick={() => { setTargetKind(o.kind); setTargetId(o.id); setSearch(''); }}
                          className="flex min-h-11 w-full items-center gap-2 border-b border-line px-3 py-2 text-start text-sm text-ink2 last:border-b-0 hover:bg-card2"
                        >
                          <b className="text-[9px] font-semibold tracking-[0.06em] text-ink3 uppercase">{fieldLabel(o.kind)}</b>
                          {o.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {targetKind !== 'general' && targetId && (
                  <p className="mt-1.5 text-[11px] text-sage">
                    {fieldLabel(targetKind)}: {
                      (targetKind === 'task' ? taskOptions : targetKind === 'project' ? projectOptions : blockerOptions)
                        .find((o) => o.id === targetId)?.label ?? targetId
                    }
                  </p>
                )}
              </section>

              <section className="rounded-(--radius-card) border border-line bg-inset p-3">
                <p className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.whatHappens}</p>
                <p className="mt-1 text-[11px] text-ink2">{labels.whatHappensBody}</p>
              </section>
              {toast && <p className="text-xs text-ink2">{toast}</p>}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
              <button type="button" disabled={pending} onClick={() => setSelected(null)}
                className="min-h-11 rounded-[9px] border border-line px-3 py-2 text-xs text-ink2 disabled:opacity-50">
                {labels.skip}
              </button>
              <button type="button" disabled={pending} onClick={() => save(true)}
                className="min-h-11 rounded-[9px] border border-line px-3 py-2 text-xs text-ink2 disabled:opacity-50">
                {labels.markGeneral}
              </button>
              <button type="button" disabled={pending} onClick={() => save(false)}
                className="ms-auto min-h-11 rounded-[9px] bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {labels.save}
              </button>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}
