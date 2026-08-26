'use client';

interface Props {
  /** Per-action sub-message, e.g. "Completed recorded. Check whether the
   *  sub-stage can now advance." */
  message: string;
  /** Audit-log row id from logActivity — null means the write happened but
   *  isn't reversible (shouldn't occur today, but the chip still degrades
   *  gracefully: no Undo button, dismiss still works). */
  undoId: string | null;
  onUndo: () => void;
  onDismiss: () => void;
  /** Needs `recorded`, `undo`, `cancel` — the same bag every caller already
   *  builds for VerbMenu. */
  labels: Record<string, string>;
  /** Disables Undo while a transition (the undo call itself, or another
   *  action from the same caller) is in flight. */
  pending?: boolean;
}

/**
 * "Update recorded · Undo" result chip for any audited task write. Started as
 * VerbMenu's own result state; lifted out here so TaskEditor (and C4's
 * process-page reuses) show the exact same outcome instead of a near-duplicate.
 * Pure display — the caller owns the mutation, the pending flag, and clearing
 * its own result state on dismiss/undo.
 */
export function SavedChip({ message, undoId, onUndo, onDismiss, labels, pending }: Props) {
  return (
    <span role="status" className="inline-flex max-w-72 items-start gap-2 rounded-lg bg-sage-soft px-2.5 py-1.5 text-start">
      <span className="min-w-0">
        <strong className="block text-[11px] font-semibold text-sage">{labels.recorded}</strong>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-ink2">{message}</span>
      </span>
      {undoId && (
        <button type="button" disabled={pending} onClick={onUndo}
          className="min-h-11 shrink-0 rounded-full border border-sage-line px-2 py-0.5 text-[10px] font-semibold text-sage disabled:opacity-50 sm:min-h-0">
          {labels.undo}
        </button>
      )}
      <button type="button" onClick={onDismiss} aria-label={labels.cancel}
        className="min-h-11 shrink-0 text-[11px] text-ink3 hover:text-ink sm:min-h-0">✕</button>
    </span>
  );
}
