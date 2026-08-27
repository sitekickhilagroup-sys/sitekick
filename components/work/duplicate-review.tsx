'use client';

import { useState, useTransition } from 'react';
import { mergeTasks, undoMerge } from '@/app/actions/tasks';
import { saveRelationship } from '@/app/actions/relationships';
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
  allReviewed: string;
  keep: string;
  project: string;
  owner: string;
  waiting: string;
  due: string;
  lastTouched: string;
  /** "\"{survivor}\" stays open. \"{loser}\" folds into it…" */
  consequence: string;
  merge: string;
  notDuplicate: string;
  leave: string;
  reason: string;
  /** SavedChip's message after a successful merge. */
  mergedMsg: string;
  /** SavedChip's message after a successful "Not a duplicate". */
  notDuplicateMsg: string;
  recorded: string;
  undo: string;
  cancel: string;
  errorSelf: string;
  errorNotFound: string;
  errorAlreadyMerged: string;
  errorMasterMerged: string;
  errorNotMerged: string;
  /** Fallback for any error the five above don't name — "Couldn't save: {reason}". */
  errorReason: string;
}

interface Props {
  pairs: DupPairView[];
  labels: DuplicateReviewLabels;
}

/**
 * The duplicate-review list. Collapsed, this is the exact same amber banner
 * that used to link out to `/work?view=all` — now it toggles a list of
 * side-by-side comparisons open in place instead, one card per detected
 * pair, each with its own Merge / Not a duplicate / Leave it decision.
 *
 * "Leave it" and the two success outcomes below all just remove that one
 * card from view for the rest of this visit (`hidden`) — nothing here
 * decrements the banner's own `{n}` count, which stays the server-computed
 * truth (matching every other count on this page) and catches up on the
 * next load, once revalidatePath's fresher data includes the write.
 */
export function DuplicateReview({ pairs, labels }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  if (pairs.length === 0) return null;

  const keyOf = (p: DupPairView) => `${p.a.id}:${p.b.id}`;
  const visible = pairs.filter((p) => !hidden.has(keyOf(p)));
  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-(--radius-card) border border-apricot/40 bg-apricot-soft px-4 py-2.5 text-start text-sm text-apricot hover:underline"
      >
        <span className="flex-1">{labels.warning.replace('{n}', String(pairs.length))}</span>
        <span aria-hidden="true" className={`inline-block shrink-0 transition-transform ${expanded ? 'rotate-90' : ''} rtl:-scale-x-100`}>›</span>
      </button>

      {expanded && (
        <div className="space-y-3 rounded-(--radius-card) border border-line bg-card p-3">
          <p className="text-[11px] leading-relaxed text-ink3">{labels.hint}</p>
          {visible.length === 0 ? (
            <p className="text-sm text-ink2">{labels.allReviewed}</p>
          ) : (
            visible.map((pair) => (
              <DupPairCard key={keyOf(pair)} pair={pair} labels={labels} onHide={() => hide(keyOf(pair))} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const errorMessage = (labels: DuplicateReviewLabels, code: string): string => {
  switch (code) {
    case 'cannot merge a task into itself': return labels.errorSelf;
    case 'task not found': return labels.errorNotFound;
    case 'already merged': return labels.errorAlreadyMerged;
    case 'master is itself merged': return labels.errorMasterMerged;
    case 'not merged': return labels.errorNotMerged;
    // Anything else (an uncommon saveRelationship rejection, or a raw
    // Postgres message) still reaches Noa, behind a translated lead-in,
    // instead of disappearing into one generic "couldn't save". FSI/PDI
    // (⁨…⁩) bidi-isolate the untranslated text the same way
    // link-editor.tsx already isolates dynamic values inside Hebrew text.
    default: return labels.errorReason.replace('{reason}', `⁨${code}⁩`);
  }
};

function DupPairCard({ pair, labels, onHide }: { pair: DupPairView; labels: DuplicateReviewLabels; onHide: () => void }) {
  const { a, b } = pair;
  const [survivorId, setSurvivorId] = useState(() => pickDefaultMaster(a, b));
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Set on a successful Merge or Not-a-duplicate. Unlike VerbMenu/LinkEditor,
  // dismissing this never reverts to the idle comparison card — the write
  // already changed what these two rows mean (one is merged away, or the
  // pair is now marked told-apart), so showing the same comparison again
  // would be stale at best, wrong at worst. Dismiss instead calls onHide,
  // same as a resolved card just going away.
  const [outcome, setOutcome] = useState<{ message: string; undoId: string | null } | null>(null);

  const survivor = survivorId === a.id ? a : b;
  const loser = survivorId === a.id ? b : a;

  const merge = () => start(async () => {
    setError(null);
    const res = await mergeTasks(survivor.id, loser.id);
    if ('error' in res) { setError(res.error); return; }
    setOutcome({
      message: labels.mergedMsg.replace('{loser}', loser.title).replace('{survivor}', survivor.title),
      // SavedChip only cares whether this is truthy — the real undo call
      // below closes over `loser.id` directly, not this value.
      undoId: loser.id,
    });
  });

  const undo = () => start(async () => {
    setError(null);
    const res = await undoMerge(loser.id);
    if ('error' in res) { setError(res.error); return; }
    // Undo reversed the write, but the two rows are still exactly the
    // duplicate pair they were before Merge — back to the same comparison,
    // not away, so she can act on it again without a page reload.
    setOutcome(null);
  });

  const notDuplicate = () => start(async () => {
    setError(null);
    const res = await saveRelationship(a.id, b.id, 'unrelated', reason);
    if (res?.error) { setError(res.error); return; }
    setOutcome({ message: labels.notDuplicateMsg, undoId: null });
  });

  if (outcome) {
    return (
      <div className="rounded-xl border border-line bg-card2 p-3">
        <SavedChip
          message={outcome.message}
          undoId={outcome.undoId}
          pending={pending}
          onUndo={undo}
          onDismiss={onHide}
          labels={{ recorded: labels.recorded, undo: labels.undo, cancel: labels.cancel }}
        />
        {error && <p role="alert" className="mt-1.5 text-[11px] font-semibold text-coral">{errorMessage(labels, error)}</p>}
      </div>
    );
  }

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

      {/* The consequence, spelled out before she can commit — which title
          keeps going and which one folds in, in words, not just a radio
          state — and said to be reversible, since "merge" reads as
          permanent-sounding otherwise. */}
      <p className="mt-2.5 rounded-lg bg-sk-surface-soft px-2.5 py-2 text-[11px] leading-relaxed text-ink2">
        {labels.consequence.replace('{survivor}', survivor.title).replace('{loser}', loser.title)}
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
