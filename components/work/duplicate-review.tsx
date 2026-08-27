'use client';

import { useState, useTransition } from 'react';
import { mergeTasks, undoMerge } from '@/app/actions/tasks';
import { markPairNotDuplicate } from '@/app/actions/relationships';
import { pickDefaultMaster } from '@/lib/merge';
import { SavedChip } from './saved-chip';

/** One side of a detected pair, reduced to exactly what Noa needs to tell the
 *  two apart — title, project (already resolved to a display name or
 *  "General"), owner, waiting-on, due and when it was last touched. Field
 *  names mirror `Task` where they map 1:1 so `pickDefaultMaster` (built
 *  against `Task`) accepts this shape directly with no adapting. */
export interface DupPairSide {
  id: string;
  title: string;
  project_id: string | null;
  /** Pre-resolved so this component never needs the full projects list. */
  projectName: string;
  owner: string | null;
  waiting_for: string | null;
  due: string | null;
  last_touched: string;
}

export interface DupPairView {
  a: DupPairSide;
  b: DupPairSide;
}

export interface DuplicateReviewLabels {
  /** The collapsed banner's own text — "{n} possible duplicate pairs…". */
  warning: string;
  hint: string;
  keep: string;
  project: string;
  owner: string;
  waiting: string;
  due: string;
  lastTouched: string;
  /** "\"{survivor}\" stays open. \"{loser}\" folds into it…" */
  consequence: string;
  /** Shown next to Not a duplicate, before the click — the asymmetry a
   *  review caught: the reversible action (Merge) explained itself, the
   *  permanent one (Not a duplicate) said nothing. */
  notDuplicateConsequence: string;
  merge: string;
  notDuplicate: string;
  leave: string;
  reason: string;
  /** SavedChip's message after a successful merge. */
  mergedMsg: string;
  /** SavedChip's message after a successful "Not a duplicate". */
  notDuplicateMsg: string;
  recorded: string;
  /** Specific to undoing a merge — deliberately NOT the shared, generic
   *  "work.undo" ("ביטול"), which SavedChip's own dismiss (✕) already uses
   *  via `cancel`. Two controls reading the same word on the highest-stakes
   *  chip in the app is exactly the kind of ambiguity a mis-click here can't
   *  afford. */
  undoMerge: string;
  cancel: string;
  errorSelf: string;
  errorNotFound: string;
  errorAlreadyMerged: string;
  errorMasterMerged: string;
  errorNotMerged: string;
  /** "already recorded" from markPairNotDuplicate — {type} interpolated
   *  with the relationship's own translated type label (relTypeLabels). */
  errorConflict: string;
  /** RelationshipType -> translated label (rel.type.*), reused here only to
   *  fill {type} in errorConflict. */
  relTypeLabels: Record<string, string>;
  /** Fallback for any error the five literal-matched ones above don't name —
   *  "Couldn't save: {reason}". */
  errorReason: string;
}

interface Props {
  pairs: DupPairView[];
  labels: DuplicateReviewLabels;
}

/** What a resolved pair leaves behind once DupPairCard hands off to
 *  ResolvedPairCard — just enough to show the outcome and (for a merge)
 *  drive Undo, independent of whichever `DupPairSide` data produced it. */
interface ResolvedOutcome {
  message: string;
  undoId: string | null;
  /** The id undoMerge needs — set only for a merge outcome. Null for
   *  "not a duplicate" (nothing to undo from here). */
  loserTaskId: string | null;
}

/**
 * The duplicate-review list. Collapsed, this is the exact same amber banner
 * that used to link out to `/work?view=all` — now it toggles a list of
 * side-by-side comparisons open in place instead, one card per detected
 * pair, each with its own Merge / Not a duplicate / Leave it decision.
 *
 * Resolved outcomes live HERE (`settled`), not inside each pair's own card,
 * and this component is mounted unconditionally by work/page.tsx (no
 * `dupPairs.length > 0 &&` gate) rather than being removed from the tree
 * once the server reports zero pairs. Both of those are load-bearing:
 * mergeTasks/undoMerge/markPairNotDuplicate all call revalidatePath('/work'),
 * which re-runs this page's `status = 'open'` query and can shrink (or
 * empty) the `pairs` prop within the very same transition that produced an
 * outcome — sometimes before a per-card state update would ever have
 * painted. undoMerge has exactly one call site in this app: the chip a few
 * lines below. Losing it before it renders is losing the only way back onto
 * the screen for a merged task — no list anywhere shows `status = 'merged'`
 * rows, so recovery would otherwise require a developer with database
 * access. Once a key enters `settled` it stays excluded from the live list
 * for the rest of this visit, however `pairs` changes afterward.
 */
export function DuplicateReview({ pairs, labels }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [settled, setSettled] = useState<ReadonlyMap<string, ResolvedOutcome | null>>(new Map());

  const keyOf = (p: DupPairView) => `${p.a.id}:${p.b.id}`;
  // Leave it and a dismissed chip both settle to `null` (rendered as
  // nothing); a successful Merge or Not-a-duplicate settles to a real
  // outcome (rendered as SavedChip). Either way the key is permanently out
  // of `awaiting` for the rest of this visit.
  const settle = (key: string, outcome: ResolvedOutcome | null) =>
    setSettled((prev) => new Map(prev).set(key, outcome));

  const awaiting = pairs.filter((p) => !settled.has(keyOf(p)));
  const resolved = [...settled.entries()].filter(
    (e): e is [string, ResolvedOutcome] => e[1] !== null,
  );

  if (awaiting.length === 0 && resolved.length === 0) return null;

  // The panel stays visible whenever there's a chip to show, even if
  // `expanded` itself is false or `awaiting` has emptied out — collapsing
  // the "possible duplicates" toggle must never take an unacknowledged
  // outcome (and a merge's only Undo control) down with it.
  const showPanel = expanded || resolved.length > 0;

  return (
    <div className="space-y-2">
      {awaiting.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center gap-2 rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-start text-sm text-apricot hover:underline"
        >
          <span className="flex-1">{labels.warning.replace('{n}', String(awaiting.length))}</span>
          <span aria-hidden="true" className={`inline-block shrink-0 transition-transform ${expanded ? 'rotate-90' : ''} rtl:-scale-x-100`}>›</span>
        </button>
      )}

      {showPanel && (
        <div className="space-y-3 rounded-(--radius-card) border border-line bg-card p-3">
          {awaiting.length > 0 && <p className="text-[11px] leading-relaxed text-ink3">{labels.hint}</p>}
          {resolved.map(([key, outcome]) => (
            <ResolvedPairCard key={key} outcome={outcome} labels={labels} onDismiss={() => settle(key, null)} />
          ))}
          {awaiting.map((pair) => (
            <DupPairCard
              key={keyOf(pair)}
              pair={pair}
              labels={labels}
              onResolved={(outcome) => settle(keyOf(pair), outcome)}
              onHide={() => settle(keyOf(pair), null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Errors both cards can hit, named — `detail` carries the conflicting
 *  relationship's type for the one error that needs it interpolated. */
interface CardError {
  code: string;
  detail?: string;
}

const errorMessage = (labels: DuplicateReviewLabels, err: CardError): string => {
  if (err.code === 'already recorded' && err.detail) {
    const typeLabel = labels.relTypeLabels[err.detail] ?? err.detail;
    return labels.errorConflict.replace('{type}', typeLabel);
  }
  switch (err.code) {
    case 'cannot merge a task into itself': return labels.errorSelf;
    case 'task not found': return labels.errorNotFound;
    case 'already merged': return labels.errorAlreadyMerged;
    case 'master is itself merged': return labels.errorMasterMerged;
    case 'not merged': return labels.errorNotMerged;
    // Anything else (an uncommon saveRelationship rejection, or a raw
    // Postgres message) still reaches Noa, behind a translated lead-in,
    // instead of disappearing into one generic "couldn't save". FSI/PDI
    // (⁨…⁩) bidi-isolate the untranslated text the same way this codebase
    // isolates any other dynamic value embedded in Hebrew text.
    default: return labels.errorReason.replace('{reason}', `⁨${err.code}⁩`);
  }
};

/** The post-decision confirmation: SavedChip plus, for a merge, the one and
 *  only Undo control that exists anywhere for a merged task (see
 *  DuplicateReview's own doc comment for why this lives at this level). */
function ResolvedPairCard({ outcome, labels, onDismiss }: {
  outcome: ResolvedOutcome; labels: DuplicateReviewLabels; onDismiss: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<CardError | null>(null);

  const undo = () => start(async () => {
    if (!outcome.loserTaskId) { onDismiss(); return; }
    setError(null);
    const res = await undoMerge(outcome.loserTaskId);
    if ('error' in res) { setError({ code: res.error }); return; }
    onDismiss();
  });

  return (
    <div className="rounded-xl border border-line bg-card2 p-3">
      <SavedChip
        message={outcome.message}
        undoId={outcome.undoId}
        pending={pending}
        onUndo={undo}
        onDismiss={onDismiss}
        labels={{ recorded: labels.recorded, undo: labels.undoMerge, cancel: labels.cancel }}
      />
      {error && <p role="alert" className="mt-1.5 text-[11px] font-semibold text-coral">{errorMessage(labels, error)}</p>}
    </div>
  );
}

function DupPairCard({ pair, labels, onResolved, onHide }: {
  pair: DupPairView;
  labels: DuplicateReviewLabels;
  onResolved: (outcome: ResolvedOutcome) => void;
  onHide: () => void;
}) {
  const { a, b } = pair;
  const [survivorId, setSurvivorId] = useState(() => pickDefaultMaster(a, b));
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<CardError | null>(null);

  const survivor = survivorId === a.id ? a : b;
  const loser = survivorId === a.id ? b : a;

  const merge = () => start(async () => {
    setError(null);
    const res = await mergeTasks(survivor.id, loser.id);
    if ('error' in res) { setError({ code: res.error }); return; }
    onResolved({
      // Real titles end in neutrals ("Submit Site Plan – 8/14") — isolated
      // so the closing quote can't strand on the wrong side inside Hebrew
      // text, and so it stays unambiguous which title merged into which.
      message: labels.mergedMsg.replace('{loser}', `⁨${loser.title}⁩`).replace('{survivor}', `⁨${survivor.title}⁩`),
      undoId: loser.id,
      loserTaskId: loser.id,
    });
  });

  const notDuplicate = () => start(async () => {
    setError(null);
    const res = await markPairNotDuplicate(a.id, b.id, reason);
    if ('error' in res) { setError({ code: res.error, detail: res.conflictType }); return; }
    onResolved({ message: labels.notDuplicateMsg, undoId: null, loserTaskId: null });
  });

  return (
    <div className="rounded-xl border border-line bg-card2 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {[a, b].map((side) => {
          const selected = side.id === survivorId;
          return (
            <label
              key={side.id}
              className={`block min-h-11 cursor-pointer rounded-lg border p-2.5 ${selected ? 'border-sage-line bg-sage-soft' : 'border-line bg-card hover:border-line2'}`}
            >
              <span className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`survivor-${a.id}-${b.id}`}
                  checked={selected}
                  onChange={() => setSurvivorId(side.id)}
                  className="h-3.5 w-3.5 accent-sage"
                />
                <span className={`text-[9px] font-bold uppercase tracking-[0.08em] ${selected ? 'text-sage' : 'text-ink3'}`}>
                  {labels.keep}
                </span>
              </span>
              {/* No truncate/line-clamp here — near-identical titles differing
                  only at the end are exactly what this view exists to show. */}
              <p className="mt-1.5 whitespace-normal break-words text-sm font-medium leading-snug text-ink">{side.title}</p>
              <dl className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-ink3">
                <div><dt className="inline font-medium text-ink2">{labels.project}: </dt><dd className="inline">{side.projectName}</dd></div>
                <div><dt className="inline font-medium text-ink2">{labels.owner}: </dt><dd className="inline">{side.owner ?? '—'}</dd></div>
                <div><dt className="inline font-medium text-ink2">{labels.waiting}: </dt><dd className="inline">{side.waiting_for ?? '—'}</dd></div>
                <div><dt className="inline font-medium text-ink2">{labels.due}: </dt><dd className="inline">{side.due ?? '—'}</dd></div>
                <div><dt className="inline font-medium text-ink2">{labels.lastTouched}: </dt><dd className="inline">{side.last_touched}</dd></div>
              </dl>
            </label>
          );
        })}
      </div>

      {/* The consequence of each action, spelled out before she can commit
          to either — which title keeps going and which one folds in (and
          that it's reversible), and separately that "Not a duplicate" is
          the lasting decision of the two, with nothing to undo from here. */}
      <p className="mt-2.5 rounded-lg bg-sk-surface-soft px-2.5 py-2 text-[11px] leading-relaxed text-ink2">
        {labels.consequence.replace('{survivor}', `⁨${survivor.title}⁩`).replace('{loser}', `⁨${loser.title}⁩`)}
      </p>
      <p className="mt-1.5 rounded-lg bg-sk-surface-soft px-2.5 py-2 text-[11px] leading-relaxed text-ink2">
        {labels.notDuplicateConsequence}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={merge}
          className="min-h-11 rounded-full bg-sage px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:min-h-8">
          {labels.merge}
        </button>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={pending} onClick={notDuplicate}
            className="min-h-11 rounded-full border border-line px-3 py-1.5 text-xs text-ink2 hover:bg-card disabled:opacity-50 sm:min-h-8">
            {labels.notDuplicate}
          </button>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') notDuplicate(); }}
            placeholder={labels.reason}
            aria-label={labels.reason}
            className="min-h-11 w-32 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-ink outline-none focus:border-sage sm:min-h-8 sm:w-40"
          />
        </span>
        <button type="button" disabled={pending} onClick={onHide}
          className="min-h-11 rounded-full bg-inset px-3 py-1.5 text-xs text-ink3 hover:text-ink2 disabled:opacity-50 sm:min-h-8">
          {labels.leave}
        </button>
      </div>

      {error && <p role="alert" className="mt-1.5 text-[11px] font-semibold text-coral">{errorMessage(labels, error)}</p>}
    </div>
  );
}
