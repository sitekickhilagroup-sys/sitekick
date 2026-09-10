'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { autoTriagePending, decideProposal, undoProposalDecision, type ReviewDecision } from '@/app/actions/proposals';
import type { ChangeType, ProposalState, ProposalType } from '@/lib/types';
import { NEEDS_MATCH, selectableTasksFor, treatmentsFor, updateFieldsPreview } from '@/lib/review-treatments';
import { titleSimilarity } from '@/lib/dedup';
import { fmtDate } from '@/lib/format';
import { draftKey, isDraftStale, parseDraft, type Draft } from '@/lib/inbox-draft';

export interface ReviewRow {
  id: string;
  type: ProposalType;
  projectId: string | null;
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
  /** The agent's matched task id (null when it matched nothing) — seeds the
   *  drawer's "attach to existing task" select so the human can keep or change it. */
  targetTaskId: string | null;
  matched: null | {
    title: string; status: string; owner: string;
    phase: string; substage: string; due: string; latestUpdate: string;
  };
}

/** One open task the drawer can attach a proposal to (Section 2). */
export interface OpenTaskOption {
  id: string;
  title: string;
  projectId: string | null;
  phase: string;
  substage: string;
  substageTemplateId: string | null;
}

const FILTERS: { key: string; labelKey: string }[] = [
  { key: 'pending', labelKey: 'needs' },
  { key: 'not_sure', labelKey: 'unsure' },
  { key: 'accepted', labelKey: 'approved' },
  // Auto-triage outcomes get their own shelf — what the system did on its
  // own must stay inspectable (and undoable via Restore), never buried.
  { key: 'auto_applied', labelKey: 'auto' },
  { key: 'ignored', labelKey: 'ignored' },
  { key: 'rejected', labelKey: 'wrong' },
  { key: 'all', labelKey: 'history' },
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

export function ReviewBoard({ rows, projects, openTasks, phases, substages, labels }: {
  rows: ReviewRow[];
  /** Active projects for the drawer's attribution select. */
  projects: { id: string; name: string }[];
  /** Every open task — the drawer filters these to the chosen project for the
   *  "attach to existing task" select (Section 2). */
  openTasks: OpenTaskOption[];
  /** The 5 canonical phases (for the editable Phase filter). */
  phases: { key: string; label: string }[];
  /** Sub-stage library (the editable Sub-stage select filters to the phase). */
  substages: { id: string; phase_key: string; name: string }[];
  labels: Record<string, string>;
}) {
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [toast, setToast] = useState<{ text: string; undoId: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Bulk selection (pending filter only) — clearing 100+ rows one drawer at
  // a time is exactly the pain this screen was drowning in.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Drawer edits live here so the buttons send what Noa actually sees.
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [treatment, setTreatment] = useState<ChangeType>('new_task');
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState('');
  // Section 2: the human's target-task pick ('' = none/create new). Seeded from
  // the agent's match so keeping it unchanged behaves exactly as before.
  const [targetTaskId, setTargetTaskId] = useState('');
  // Editable Sub-stage (Phase is its filter, not stored) — sets the task's
  // sub-stage on Apply.
  const [substageId, setSubstageId] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const phaseKeyOfSubstage = (id: string) => substages.find((s) => s.id === id)?.phase_key ?? '';

  // Draft persistence (lib/inbox-draft.ts): 'restored' shows a small "your
  // earlier notes are back" banner with a Discard option; 'stale' shows why
  // an unsaved draft was found but NOT applied (the item moved on since).
  const [draftNotice, setDraftNotice] = useState<'restored' | 'stale' | null>(null);
  const skipNextDraftSaveRef = useRef(false);

  const seedFromRow = (row: ReviewRow) => {
    const seed = row.targetTaskId ? openTasks.find((tk) => tk.id === row.targetTaskId) : undefined;
    // When a task is attached, the title field starts from THAT task's title,
    // not the email-extracted one — so Apply preserves the work name unless Noa
    // deliberately edits it (brief §1: no silent rename).
    setTitle(seed?.title ?? row.title);
    setOwner(row.owner);
    setDue(/^\d{4}-\d{2}-\d{2}$/.test(row.due) ? row.due : '');
    const allowed = treatmentsFor(row.type, !!row.targetTaskId);
    setTreatment(allowed.includes(row.changeType) ? row.changeType : 'new_task');
    setNote(row.resultNote);
    setProjectId(row.projectId ?? '');
    setTargetTaskId(row.targetTaskId ?? '');
    setSubstageId(seed?.substageTemplateId ?? '');
    setPhaseFilter(seed?.substageTemplateId ? phaseKeyOfSubstage(seed.substageTemplateId) : '');
  };

  const open = (row: ReviewRow) => {
    setSelected(row);
    setFailure(null);
    setDraftNotice(null);

    let draft: Draft | null = null;
    try {
      const raw = window.localStorage.getItem(draftKey(row.id));
      draft = raw ? parseDraft(raw) : null;
    } catch { /* localStorage unavailable (private window, blocked) — no draft, fall through to a fresh seed */ }

    const rowSnapshot = { state: row.state, targetTaskId: row.targetTaskId, title: row.title };
    if (draft && isDraftStale(draft.snapshot, rowSnapshot)) {
      // The item moved on since this draft was saved (decided elsewhere,
      // re-matched) — restoring it blind could paper over that real change,
      // so it's discarded rather than silently applied.
      try { window.localStorage.removeItem(draftKey(row.id)); } catch { /* best-effort cleanup */ }
      draft = null;
      setDraftNotice('stale');
    }

    // The seed below re-fires the auto-save effect immediately (every field
    // it sets is a dependency) — for a restored draft that's a harmless
    // re-save of the same data, but skip it once so a fresh row-seed on an
    // item with NO draft doesn't manufacture one purely from opening it.
    skipNextDraftSaveRef.current = !draft;

    if (draft) {
      setTitle(draft.fields.title);
      setOwner(draft.fields.owner);
      setDue(draft.fields.due);
      const allowed = treatmentsFor(row.type, !!draft.fields.targetTaskId);
      setTreatment(allowed.includes(draft.fields.treatment) ? draft.fields.treatment : 'new_task');
      setNote(draft.fields.note);
      setProjectId(draft.fields.projectId);
      setTargetTaskId(draft.fields.targetTaskId);
      setSubstageId(draft.fields.substageId);
      setPhaseFilter(draft.fields.phaseFilter);
      setDraftNotice('restored');
    } else {
      seedFromRow(row);
    }
  };

  const discardDraft = () => {
    if (!selected) return;
    try { window.localStorage.removeItem(draftKey(selected.id)); } catch { /* best-effort */ }
    skipNextDraftSaveRef.current = true;
    seedFromRow(selected);
    setDraftNotice(null);
  };

  // Auto-persists the drawer's in-progress edits so closing and reopening —
  // even after a full reload, not just switching to another item and back —
  // doesn't discard them. Debounced so a fast typist doesn't spam
  // localStorage on every keystroke.
  useEffect(() => {
    if (!selected) return;
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return; }
    const timer = window.setTimeout(() => {
      const payload: Draft = {
        fields: { title, owner, due, treatment, note, projectId, targetTaskId, substageId, phaseFilter },
        snapshot: { state: selected.state, targetTaskId: selected.targetTaskId, title: selected.title },
        savedAt: new Date().toISOString(),
      };
      try { window.localStorage.setItem(draftKey(selected.id), JSON.stringify(payload)); } catch { /* best-effort */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [selected, title, owner, due, treatment, note, projectId, targetTaskId, substageId, phaseFilter]);

  // Open tasks in the project the item is filed under, sorted most-likely-match
  // first (same similarity measure as the dedup engine) — so the right task is
  // at the top instead of buried in a long list. Changing Project re-filters.
  const targetChoices = useMemo(() => {
    const filtered = selectableTasksFor(openTasks, projectId || null);
    const q = selected?.title ?? '';
    if (!q) return filtered;
    return [...filtered].sort((a, b) => titleSimilarity(q, b.title) - titleSimilarity(q, a.title));
  }, [openTasks, projectId, selected]);

  // When a task is attached, the Phase/Sub-stage boxes should show THAT task's
  // location (confirming the match), not the proposal's empty one.
  // Editable Sub-stage options — filtered to the chosen Phase, but always keep
  // the current value visible even if it falls outside the filter.
  const substageChoices = substages.filter((s) => s.phase_key === phaseFilter);
  const currentSubstage = substages.find((s) => s.id === substageId);
  const substageSelectOptions = currentSubstage && !substageChoices.some((s) => s.id === currentSubstage.id)
    ? [currentSubstage, ...substageChoices] : substageChoices;

  // "What will change" before Apply: the exact fields this update lands on the
  // chosen task — diffed against that task's current values so a Sub-stage/Phase
  // move is shown (brief §1) and an unchanged title is not staged as a rename.
  const attachedTask = targetTaskId ? openTasks.find((tk) => tk.id === targetTaskId) : undefined;
  const substageChanged = !!attachedTask && (substageId || '') !== (attachedTask.substageTemplateId || '');
  const chosenSubstageLabel = substageId ? (substages.find((s) => s.id === substageId)?.name ?? null) : null;
  const chosenPhaseKey = substageId ? phaseKeyOfSubstage(substageId) : '';
  const chosenPhaseLabel = chosenPhaseKey ? (phases.find((p) => p.key === chosenPhaseKey)?.label ?? null) : null;
  const previewFields = updateFieldsPreview(treatment, { title, owner, due, note }, {
    title: attachedTask?.title ?? selected?.matched?.title ?? null,
    substage: substageChanged
      ? { changed: true, substageLabel: chosenSubstageLabel, phaseLabel: chosenPhaseLabel }
      : undefined,
  });
  const targetTitle = attachedTask?.title ?? selected?.matched?.title ?? '';
  const fieldLabel = (f: string) =>
    f === 'title' ? labels.pvTitle : f === 'owner' ? labels.fOwner
      : f === 'due' ? labels.fDue : f === 'note' ? labels.pvNote
        : f === 'substage' ? labels.fSubstage : f === 'phase' ? labels.fPhase
          : labels.pvStatusDone;

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
      setFailure(null);
      const res = await decideProposal(selected.id, decision, {
        title, owner, due,
        changeType: override?.changeType ?? treatment,
        resultNote: note,
        projectId,
        targetTaskId: targetTaskId || null,
        substageTemplateId: substageId || null,
      });
      if ('error' in res) { setFailure(res.error); return; }
      // The edits just landed for real — any unsaved draft for this item is
      // superseded, not "still in progress" anymore.
      try { window.localStorage.removeItem(draftKey(selected.id)); } catch { /* best-effort */ }
      setSelected(null);
      setToast({ text: labels[`done.${decision}`] ?? labels['done.approved'], undoId: res.undoId });
    });
  };

  const undo = (undoId: string) => start(async () => {
    const res = await undoProposalDecision(undoId);
    setToast({ text: 'error' in res ? labels.undoFailed : labels.undone, undoId: null });
  });

  // Bulk decide: each row keeps its own stored treatment/state — no drawer
  // edits ride along, so what applies is exactly what the list showed.
  const bulkDecide = (decision: ReviewDecision) => {
    const ids = [...checked];
    if (!ids.length) return;
    start(async () => {
      let ok = 0;
      for (const id of ids) {
        const res = await decideProposal(id, decision, {});
        if (!('error' in res)) {
          ok++;
          // A bulk-decided item never goes through the drawer, but it could
          // still be carrying a draft from an earlier visit — that draft is
          // now moot.
          try { window.localStorage.removeItem(draftKey(id)); } catch { /* best-effort */ }
        }
      }
      setChecked(new Set());
      setToast({ text: `${labels[`done.${decision}`] ?? ''} · ${ok}/${ids.length}`, undoId: null });
    });
  };

  const triageNow = () => start(async () => {
    const res = await autoTriagePending();
    if ('error' in res) { setToast({ text: labels.error, undoId: null }); return; }
    setToast({
      text: labels.triageDone
        .replace('{applied}', String(res.applied))
        .replace('{ignored}', String(res.ignored))
        .replace('{kept}', String(res.kept)),
      undoId: null,
    });
  });

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
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
          {filter === 'pending' && visible.length > 0 && (
            // Bulk bar: select-all, one-click clears, and the auto-triage
            // sweep — the queue must be dismissable in minutes, not sessions.
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-inset/60 px-3.5 py-2.5">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-ink2">
                <input
                  type="checkbox"
                  checked={checked.size > 0 && checked.size === visible.length}
                  onChange={() => setChecked(checked.size === visible.length ? new Set() : new Set(visible.map((r) => r.id)))}
                  className="h-4 w-4 accent-(--color-sage)"
                />
                {labels.selectAll}
              </label>
              {checked.size > 0 && (
                <>
                  <span className="text-xs font-semibold text-ink">{labels.selectedN.replace('{n}', String(checked.size))}</span>
                  <button
                    type="button" disabled={pending} onClick={() => bulkDecide('approved')}
                    className="min-h-11 cursor-pointer rounded-[9px] bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {labels.bulkApprove}
                  </button>
                  <button
                    type="button" disabled={pending} onClick={() => bulkDecide('ignored')}
                    className="min-h-11 cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs text-ink2 disabled:opacity-50"
                  >
                    {labels.bulkIgnore}
                  </button>
                </>
              )}
              <button
                type="button" disabled={pending} onClick={triageNow}
                className="ms-auto min-h-11 cursor-pointer rounded-[9px] border border-sage-line bg-sage-soft px-3 py-1.5 text-xs font-semibold text-sage disabled:opacity-50"
              >
                {labels.triageNow}
              </button>
            </div>
          )}
          {visible.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-serif text-lg text-ink">{labels.emptyTitle}</p>
              <p className="mt-1 text-xs text-ink3">{labels.emptySub}</p>
            </div>
          ) : (
            <ul>
              {visible.map((r) => (
                <li key={r.id} className="flex items-stretch border-t border-line first:border-t-0">
                  {filter === 'pending' && (
                    <label className="flex cursor-pointer items-center ps-3.5">
                      <input
                        type="checkbox"
                        checked={checked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={r.title}
                        className="h-4 w-4 accent-(--color-sage)"
                      />
                    </label>
                  )}
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
            className="fixed inset-0 z-40 cursor-default bg-ink/30 motion-safe:animate-sk-fade"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={labels.kicker}
            onKeyDown={(e) => { if (e.key === 'Escape') setSelected(null); }}
            className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[560px] flex-col border-s border-line bg-card shadow-card motion-safe:animate-sk-slide-end"
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
              {draftNotice === 'restored' && (
                <section role="status" className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-sage-line bg-sage-soft/40 p-3">
                  <p className="text-[11px] text-ink2">{labels.draftRestored}</p>
                  <button type="button" onClick={discardDraft}
                    className="min-h-11 shrink-0 cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-[11px] text-ink2">
                    {labels.draftDiscard}
                  </button>
                </section>
              )}
              {draftNotice === 'stale' && (
                <section role="alert" className="rounded-(--radius-card) border border-line bg-apricot-soft/40 p-3">
                  <p className="text-[11px] text-ink2">{labels.draftStale}</p>
                </section>
              )}
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
                          [labels.fDue, fmtDate(selected.matched.due)],
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
                          [labels.fDue, fmtDate(selected.due)],
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

              {/* SOURCE SAYS in the normal path too (Noa's report §1: the
                  original quote was only visible on the duplicate screen, so a
                  plain approval showed no basis). The matched panel above already
                  carries its own source, so this shows only when there's no match. */}
              {!selected.matched && selected.evidence && (
                <section className="rounded-(--radius-card) border border-line bg-inset p-3">
                  <p className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.sourceSays}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink2">{selected.evidence}</p>
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
                  {treatmentsFor(selected.type, !!targetTaskId).map((t) => (
                    <option key={t} value={t}>{labels[`ct.${t}`]}</option>
                  ))}
                </select>
                {treatment === 'apply_as_stated'
                  ? <p className="mt-1.5 text-[10px] text-ink3">{labels[`effect.${selected.type}`] ?? ''}</p>
                  : !targetTaskId && <p className="mt-1.5 text-[10px] text-ink3">{labels.noMatch}</p>}
              </section>

              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fAction}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fProject}</span>
                <select
                  value={projectId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setProjectId(pid);
                    // A target task from the old project no longer belongs here —
                    // drop it rather than let the server reject the mismatch.
                    if (targetTaskId && !openTasks.some((tk) => tk.id === targetTaskId && (tk.projectId ?? '') === pid)) {
                      setTargetTaskId('');
                      if ((NEEDS_MATCH as string[]).includes(treatment)) setTreatment('new_task');
                    }
                  }}
                  className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                >
                  <option value="">{labels.general}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {/* The learning hook, said out loud: filing an unattributed
                    item teaches the system where this vendor/subject lives. */}
                {!selected.projectId && (
                  <span className="mt-1 block text-[10px] text-ink3">{labels.projectLearnHint}</span>
                )}
              </label>

              {/* Section 2: attach this update to an existing task so it doesn't
                  become a duplicate — usable even when the agent matched nothing.
                  Picking one flips the treatment to "update existing". */}
              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.attachTask}</span>
                <select
                  value={targetTaskId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTargetTaskId(id);
                    // Seed Sub-stage AND title from the task being attached, so
                    // the fields start from that task's real values — attaching
                    // must not stage a rename to the email's title. Detaching
                    // returns to the proposal's own title.
                    const picked = id ? openTasks.find((tk) => tk.id === id) : undefined;
                    setTitle(picked?.title ?? selected.title);
                    setSubstageId(picked?.substageTemplateId ?? '');
                    setPhaseFilter(picked?.substageTemplateId ? phaseKeyOfSubstage(picked.substageTemplateId) : '');
                    if (id && (treatment === 'new_task' || treatment === 'information_only')) {
                      setTreatment(selected.type === 'task_done' ? 'complete_existing' : 'update_existing');
                    } else if (!id && (NEEDS_MATCH as string[]).includes(treatment)) {
                      setTreatment('new_task');
                    }
                  }}
                  className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                >
                  <option value="">{labels.attachNone}</option>
                  {targetChoices.map((tk) => (
                    <option key={tk.id} value={tk.id}>{tk.substage ? `${tk.title} — ${tk.substage}` : tk.title}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-ink3">
                  {targetTaskId ? labels.attachChosen : labels.attachHint}
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fPhase}</span>
                  <select
                    value={phaseFilter}
                    onChange={(e) => {
                      const ph = e.target.value;
                      setPhaseFilter(ph);
                      // Moving Phase invalidates a sub-stage from the old phase.
                      // Clear it so a stale value (Noa's report: "Loan application"
                      // lingering under Plan Check) can't stay selected as if valid
                      // — she re-picks under the new phase (brief §1).
                      if (ph && substageId && phaseKeyOfSubstage(substageId) !== ph) setSubstageId('');
                    }}
                    className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                  >
                    <option value="">—</option>
                    {phases.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-ink3 uppercase">{labels.fSubstage}</span>
                  <select
                    value={substageId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSubstageId(id);
                      if (id) setPhaseFilter(phaseKeyOfSubstage(id));
                    }}
                    className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-sage"
                  >
                    <option value="">—</option>
                    {substageSelectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
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

              {/* Section 2: before Apply, show which task is updated and exactly
                  which fields change (the note is added, not overwritten). */}
              {targetTaskId && previewFields.length > 0 && (
                <section className="rounded-(--radius-card) border border-sage-line bg-sage-soft/40 p-3">
                  <p className="text-[10px] font-semibold tracking-[0.1em] text-sage uppercase">
                    {labels.pvIntro.replace('{task}', targetTitle)}
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {previewFields.map((f) => (
                      <li key={f.field} className="text-[11px] text-ink2">
                        <b className="font-semibold text-ink">{fieldLabel(f.field)}</b>
                        {f.field === 'status' ? '' : f.field === 'note' ? `: ${f.value.slice(0, 80)}` : ` → ${f.value}`}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {failure && <p role="alert" className="text-xs text-coral">{labels.errorReason.replace('{reason}', failure)}</p>}
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
