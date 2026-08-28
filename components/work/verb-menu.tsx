'use client';

import { useRef, useState, useTransition } from 'react';
import { applyWorkVerb, undoWorkVerb } from '@/app/actions/work';
import type { WorkVerb } from '@/lib/work-verbs';
import type { Task } from '@/lib/types';
import { SavedChip } from './saved-chip';
import { TaskEditor, type TaskEditorOptions } from './task-editor';

const NEEDS_TEXT: WorkVerb[] = ['waiting', 'note'];
const NEEDS_DATE: WorkVerb[] = ['delayed', 'scheduled'];
const VERBS: WorkVerb[] = ['completed', 'sent_email', 'waiting', 'delayed', 'scheduled', 'not_applicable', 'note'];
// Noa round 3, critical #2: these close the record (status done / dropped) —
// they arm on first press and only run on an explicit second press, so a
// double-click that lands on the menu can never close a task silently.
const NEEDS_CONFIRM: WorkVerb[] = ['completed', 'not_applicable'];
/** Clicks this soon after the menu opened are the tail of the SAME physical
 *  double-click that opened it (the desktop menu opens under the cursor, so
 *  the second click used to land straight on Completed). */
const OPEN_GUARD_MS = 350;

interface Props {
  taskId: string;
  labels: Record<string, string>;
  /** Full task record + option lists for the 8th "Edit details…" item
   *  (A6). Both are optional and only make sense together — a caller that
   *  omits them (the process page's connected-actions rows, which only carry
   *  a narrower ExplorerTask) keeps the original 7-verb menu unchanged. */
  task?: Task;
  editorOptions?: TaskEditorOptions;
}

export function VerbMenu({ taskId, labels, task, editorOptions }: Props) {
  const [open, setOpen] = useState(false);
  const [askInput, setAskInput] = useState<WorkVerb | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);
  // Armed record-closing verb awaiting its second, explicit press.
  const [armedVerb, setArmedVerb] = useState<WorkVerb | null>(null);
  const openedAt = useRef(0);
  // What the update meant, in Noa's words, plus the audit row that reverses it.
  const [result, setResult] = useState<{ message: string; undoId: string | null } | null>(null);
  const [pending, start] = useTransition();

  const run = (verb: WorkVerb, input: string | null) => start(async () => {
    setFailed(false);
    const res = await applyWorkVerb(taskId, verb, input);
    if ('error' in res) { setFailed(true); setArmedVerb(null); return; }
    setOpen(false); setAskInput(null); setDraft(''); setArmedVerb(null);
    // C3: the primary write always succeeded here — a weekly-sync hiccup
    // (res.syncWarning) rides along on the same "recorded" chip instead of
    // becoming a separate failure state, so it's visible without implying
    // this update itself failed.
    const base = labels[`msg.${verb}`] ?? labels.recorded;
    const message = res.syncWarning && labels.syncWarning ? `${base} ${labels.syncWarning}` : base;
    setResult({ message, undoId: res.undoId });
  });

  const undo = () => start(async () => {
    if (!result?.undoId) { setResult(null); return; }
    const res = await undoWorkVerb(result.undoId);
    if ('error' in res) { setFailed(true); return; }
    setResult(null);
  });

  if (result) {
    return (
      <SavedChip message={result.message} undoId={result.undoId} pending={pending}
        onUndo={undo} onDismiss={() => setResult(null)} labels={labels} />
    );
  }

  if (askInput) {
    return (
      <span className="inline-flex items-center gap-1">
        <input autoFocus aria-label={labels[askInput]} value={draft}
          type={NEEDS_DATE.includes(askInput) ? 'date' : 'text'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(askInput, draft); if (e.key === 'Escape') setAskInput(null); }}
          className={`min-h-11 w-32 rounded-lg border bg-card px-2 py-0.5 text-xs text-ink sm:min-h-0 ${failed ? 'border-coral' : 'border-mist'}`} />
        <button type="button" disabled={pending} onClick={() => run(askInput, draft)} aria-label={labels[askInput]}
          className="min-h-11 rounded-full bg-sage px-2.5 py-0.5 text-[11px] text-white disabled:opacity-50 sm:min-h-7"><span aria-hidden="true">✓</span></button>
        <button type="button" onClick={() => setAskInput(null)} aria-label={labels.cancel}
          className="min-h-11 rounded-full bg-inset px-2.5 py-0.5 text-[11px] text-ink3 sm:min-h-7"><span aria-hidden="true">✕</span></button>
        {failed && <span role="alert" className="text-[10px] font-semibold text-coral">{labels.errorSave}</span>}
      </span>
    );
  }

  return (
    // The single positioned anchor for both overlays below (the open menu
    // AND TaskEditor) — the trigger button stays rendered as a real, sized
    // box the whole time an overlay is open, so `sm:end-0 sm:top-full` always
    // resolves against it instead of a collapsed zero-size element (which
    // both hid the button and mis-positioned the popover).
    <span className="relative inline-block" onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setEditingDetails(false); setArmedVerb(null); } }}>
      <button type="button"
        onClick={() => { openedAt.current = Date.now(); setArmedVerb(null); setOpen((v) => !v); }}
        aria-expanded={open} aria-haspopup="menu"
        className="min-h-11 rounded-[6px] bg-sage px-2.5 py-1 text-[9px] font-[650] leading-none text-white hover:opacity-90 sm:min-h-0">
        {labels.update}
      </button>
      {open && (
        <>
          <span aria-hidden="true" onClick={() => { setOpen(false); setArmedVerb(null); }} className="fixed inset-0 z-20 bg-ink/40 motion-safe:animate-sk-fade sm:bg-transparent" />
          <span role="menu" className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-card motion-safe:animate-sk-rise sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:w-44 sm:origin-top sm:rounded-lg sm:border sm:p-1 sm:motion-safe:animate-sk-pop">
            <span aria-hidden="true" className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-line sm:hidden" />
            {VERBS.map((v) => {
              const armed = armedVerb === v;
              return (
                <button key={v} type="button" role="menuitem" disabled={pending}
                  onClick={() => {
                    // Tail of the double-click that opened the menu — ignore.
                    if (Date.now() - openedAt.current < OPEN_GUARD_MS) return;
                    if (NEEDS_TEXT.includes(v) || NEEDS_DATE.includes(v)) { setAskInput(v); return; }
                    if (NEEDS_CONFIRM.includes(v) && !armed) { setArmedVerb(v); return; }
                    run(v, null);
                  }}
                  className={`min-h-11 rounded px-2 py-1.5 text-start text-xs disabled:opacity-50 sm:min-h-0 ${
                    armed
                      ? 'bg-sk-green-soft font-[650] text-sk-green ring-1 ring-sage-line'
                      : 'text-ink2 hover:bg-card2 hover:text-ink'
                  }`}>
                  {armed ? (labels[`confirm.${v}`] ?? labels[v]) : labels[v]}
                </button>
              );
            })}
            {task && editorOptions && (
              <>
                <span aria-hidden="true" className="my-1 h-px bg-line2 sm:my-0.5" />
                <button type="button" role="menuitem" disabled={pending}
                  onClick={() => { setOpen(false); setEditingDetails(true); }}
                  className="min-h-11 rounded px-2 py-1.5 text-start text-xs text-ink2 hover:bg-card2 hover:text-ink disabled:opacity-50 sm:min-h-0">
                  {labels.editDetails}
                </button>
              </>
            )}
          </span>
        </>
      )}
      {editingDetails && task && editorOptions && (
        <TaskEditor task={task} options={editorOptions} labels={labels} onClose={() => setEditingDetails(false)} />
      )}
    </span>
  );
}
