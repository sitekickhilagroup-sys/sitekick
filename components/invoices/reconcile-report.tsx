'use client';

import { fmtDate, moneyExact } from '@/lib/format';
import { useState, useTransition, type ReactNode } from 'react';
import {
  flagReconciledRowForVerification, parseReconciliationSource, undoFlagReconciledRowForVerification,
} from '@/app/actions/invoices';
import { INVOICE_ERRORS, isReconcileFileTooLarge } from '@/lib/invoice-rules';
import type { InvoiceRowRef, ReconcileReport as ReconcileReportData } from '@/lib/reconcile';
import { SavedChip } from '@/components/work/saved-chip';

export interface ReconcileReportLabels {
  kicker: string; intro: string;
  chooseFile: string; uploadHint: string; reading: string; done: string;
  tileSource: string; tileSystem: string; tileAdded: string; tileChanged: string;
  tileSuspected: string; tileOrphans: string;
  none: string; groupCount: string; number: string;
  changedPrefix: string;
  fieldAmount: string; fieldReceived: string; fieldPaidDate: string;
  fieldStatus: string; fieldEntity: string; fieldDescription: string;
  flagVerify: string; flagged: string; flaggedCount: string;
  /** Review round 2, minor 2 — a multi-row Flag Verify can land on a mix of
   *  outcomes; each gets its own honest phrase instead of one blended count. */
  alreadyFlaggedCount: string; flagFailedCount: string;
  /** Review round 2, finding 3 — shown on an Added/Orphans row that shares a
   *  vendor+amount+received_date with a row on the other list but couldn't
   *  be safely paired (ambiguous: more than one candidate on some side). */
  numberDriftWarning: string;
  recorded: string; undo: string; cancel: string;
  errorFileMissing: string; errorBadFileType: string; errorParseFailed: string;
  errorNotInvoiceSheet: string; errorNoMatch: string; errorNotFound: string;
  errorNothingToUndo: string; errorMigrationPending: string; errorSaveReason: string;
  /** C4 — the file is over next.config.ts's 2mb Server Action body limit. */
  errorTooLarge: string;
  /** I6 — "Sheet: {name}" template, filled in with report.sourceSheetName. */
  sourceSheet: string;
}

interface Props {
  labels: ReconcileReportLabels;
}

type UploadPhase = 'idle' | 'busy' | 'error';

interface FlagResult {
  flagged: number; alreadyFlagged: number; failed: number;
  undoIds: string[]; failureReason: string | null;
}

interface FlagState {
  pending?: boolean;
  result?: FlagResult;
  error?: string;
}

// Local identity for React keys and per-row UI state — NOT the server's own
// matching key (reconcileKey in lib/reconcile.ts, used server-side by
// flagReconciledRowForVerification). Rows that are genuinely identical on
// every InvoiceRowRef field intentionally share one entry here: the server
// resolves "Flag Verify" by the same key over ALL matching invoices, so a
// suspected-duplicate group whose rows render identically really is flagged
// together in one click — this mirrors that instead of fighting it.
function rowKey(row: InvoiceRowRef): string {
  return [row.vendor, row.invoice_no ?? '', row.amount_usd, row.received_date ?? ''].join('::');
}

function uploadErrorMessage(code: string, labels: ReconcileReportLabels): string {
  switch (code) {
    case INVOICE_ERRORS.reconcileFileMissing: return labels.errorFileMissing;
    case INVOICE_ERRORS.reconcileBadFileType: return labels.errorBadFileType;
    case INVOICE_ERRORS.reconcileParseFailed: return labels.errorParseFailed;
    case INVOICE_ERRORS.reconcileNotInvoiceSheet: return labels.errorNotInvoiceSheet;
    // C4: the specific, actionable case — file rejected before the Server
    // Action ever ran (next.config.ts's 2mb body limit).
    case INVOICE_ERRORS.reconcileTooLarge: return labels.errorTooLarge;
    default: return labels.errorSaveReason.replace('{reason}', `⁨${code}⁩`);
  }
}

// Review round 2, finding 1: flagInvoiceForVerification's own SELECT can now
// surface migrationPending (0017 not applied yet) instead of a misleading
// "invoice not found" — needs the same named message createInvoice's insert
// already shows elsewhere on this page.
function flagErrorMessage(code: string, labels: ReconcileReportLabels): string {
  switch (code) {
    case INVOICE_ERRORS.reconcileNoMatch: return labels.errorNoMatch;
    case INVOICE_ERRORS.notFound: return labels.errorNotFound;
    case INVOICE_ERRORS.nothingToUndo: return labels.errorNothingToUndo;
    case INVOICE_ERRORS.migrationPending: return labels.errorMigrationPending;
    default: return labels.errorSaveReason.replace('{reason}', `⁨${code}⁩`);
  }
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-line bg-sk-surface p-3 text-center shadow-card">
      <p className="font-mono text-[20px] font-[650] leading-none tabular-nums text-sk-ink">{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-sk-muted">{label}</p>
    </div>
  );
}

function RowLine({ row, labels }: { row: InvoiceRowRef; labels: ReconcileReportLabels }) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-[650] text-sk-ink">{row.vendor || '—'}</span>
        <span className="block text-[10px] text-sk-muted">
          {labels.number} {row.invoice_no ?? '—'}{row.received_date ? ` · ${fmtDate(row.received_date)}` : ''}
        </span>
      </span>
      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-sk-ink">{moneyExact(row.amount_usd)}</span>
    </span>
  );
}

/** Review round 2, finding 3 — sits right on the Added/Orphans row it
 *  applies to (not a separate list), because that row is exactly the one a
 *  human might otherwise act on by clicking Add Invoice / Flag Verify. */
function NumberDriftWarning({ labels }: { labels: ReconcileReportLabels }) {
  return (
    <p className="mt-0.5 text-[10px] font-semibold text-apricot">
      <span aria-hidden="true">⚠ </span>{labels.numberDriftWarning}
    </p>
  );
}

function FlagButton({
  labels, state, onFlag, onUndo, onDismiss,
}: {
  labels: ReconcileReportLabels; state: FlagState | undefined; onFlag: () => void; onUndo: () => void; onDismiss: () => void;
}) {
  if (state?.result) {
    const { flagged, alreadyFlagged, failed, undoIds, failureReason } = state.result;
    // Review round 2, minor 2: each real outcome gets its own honest phrase
    // instead of one blended "N flagged" that hides "some were already
    // flagged" or silently drops a partial failure.
    const parts: string[] = [];
    if (flagged > 0) parts.push(flagged > 1 ? labels.flaggedCount.replace('{n}', String(flagged)) : labels.flagged);
    if (alreadyFlagged > 0) parts.push(labels.alreadyFlaggedCount.replace('{n}', String(alreadyFlagged)));
    const message = parts.length > 0 ? parts.join(' · ') : labels.flagged;
    return (
      <span className="mt-1 flex flex-col items-start gap-1">
        <SavedChip
          message={message}
          // Sentinel only — a truthy value here just tells SavedChip to
          // render the Undo button at all; onUndo (below) always undoes the
          // FULL undoIds list from state, never just this one id (review
          // round 2, finding 2: a multi-row flag must be fully reversible).
          undoId={undoIds.length > 0 ? undoIds[0] : null}
          pending={!!state.pending}
          onUndo={onUndo}
          // Same as every other SavedChip use in this codebase (add-invoice.tsx,
          // link-editor.tsx): dismiss only clears the local confirmation, it
          // never undoes the write — the row stays flagged in the database,
          // this just lets "Flag Verify" show again instead of the chip
          // sitting there forever for the rest of the session.
          onDismiss={onDismiss}
          labels={{ recorded: labels.recorded, undo: labels.undo, cancel: labels.cancel }}
        />
        {failed > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span role="alert" className="text-[10px] font-semibold text-coral">
              {labels.flagFailedCount.replace('{n}', String(failed))}
              {failureReason ? `: ${flagErrorMessage(failureReason, labels)}` : ''}
            </span>
            <button
              type="button"
              onClick={onFlag}
              className="min-h-11 shrink-0 rounded-full border border-coral/40 px-2 py-0.5 text-[10px] font-semibold text-coral hover:opacity-80 sm:min-h-0"
            >
              {labels.flagVerify}
            </button>
          </span>
        )}
        {state.error && <span role="alert" className="text-[10px] font-semibold text-coral">{flagErrorMessage(state.error, labels)}</span>}
      </span>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={state?.pending}
        onClick={onFlag}
        className="min-h-11 shrink-0 rounded-full border border-apricot/40 px-2.5 py-0.5 text-[10px] font-semibold text-apricot hover:bg-apricot-soft disabled:opacity-50 sm:min-h-0"
      >
        {labels.flagVerify}
      </button>
      {state?.error && <span role="alert" className="text-[10px] font-semibold text-coral">{flagErrorMessage(state.error, labels)}</span>}
    </span>
  );
}

function Section({ title, count, none, children }: { title: string; count: number; none: string; children: ReactNode }) {
  return (
    <details className="rounded-[15px] border border-line bg-sk-surface shadow-card">
      <summary className="min-h-11 cursor-pointer list-none px-4 py-2.5 text-[11px] font-[650] text-sk-ink sm:min-h-0">
        {title} <span className="text-sk-muted">({count})</span>
      </summary>
      <div className="border-t border-line px-4 py-2">
        {count === 0 ? <p className="py-3 text-center text-[11px] text-ink3">{none}</p> : children}
      </div>
    </details>
  );
}

/**
 * E6 — reconciliation report: upload the source tracker, diff it against the
 * system in memory, render what a human needs to adjudicate the drift.
 * Read-only besides one action: "Flag Verify" sets needs_verification=true
 * on a system invoice a person explicitly clicks — nothing here ever
 * applies, merges or deletes a row.
 *
 * Wired into app/(dash)/(focused)/invoices/page.tsx as a demoted third tab
 * (?tab=reconciliation), alongside the existing `david` link — it renders
 * INSTEAD of the invoices table/filter bar/vendor pills, not alongside them,
 * because there is no `invoices.tab==='reconciliation'` population to filter
 * on (unlike `david`, which is a real, separately-tracked workbook tab) —
 * see page.tsx's own comment on rowsTab for why Payment Summary had to stop
 * depending on that column, which this tab never starts depending on.
 */
export function ReconcileReport({ labels }: Props) {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [fileName, setFileName] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [report, setReport] = useState<ReconcileReportData | null>(null);
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  const [, start] = useTransition();

  const upload = (file: File) => start(async () => {
    setPhase('busy');
    setFileName(file.name);
    setErrorCode(null);
    // C4: a file over next.config.ts's 2mb Server Action body limit never
    // reaches parseReconciliationSource at all — Next.js rejects the request
    // before the action's function body runs, so there is no `{ error }`
    // shape to read a reason from. Checking the size up front, before
    // spending a round trip on a rejection, gets the specific message
    // immediately instead of however the framework happens to fail.
    if (isReconcileFileTooLarge(file.size)) {
      setPhase('error');
      setErrorCode(INVOICE_ERRORS.reconcileTooLarge);
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await parseReconciliationSource(fd);
      if ('error' in res) { setPhase('error'); setErrorCode(res.error); return; }
      setPhase('idle');
      setReport(res.report);
      setFlags({});
    } catch (e) {
      // C4: no try/catch here before meant a Server Action rejection (the
      // one case the size pre-check above doesn't already catch — e.g. a
      // network failure, or the framework's own body-limit edge cases) left
      // `phase` stuck at 'busy' forever: an invented progress state that
      // never resolves, and a silent failure at the same time. Always land
      // back in a real, retryable state, with whatever the runtime told us.
      setPhase('error');
      setErrorCode(e instanceof Error ? e.message : String(e));
    }
  });

  const flag = (row: InvoiceRowRef) => {
    const key = rowKey(row);
    setFlags((f) => ({ ...f, [key]: { pending: true } }));
    start(async () => {
      const res = await flagReconciledRowForVerification(row);
      if ('error' in res) { setFlags((f) => ({ ...f, [key]: { error: res.error } })); return; }
      setFlags((f) => ({
        ...f,
        [key]: {
          result: {
            flagged: res.flagged, alreadyFlagged: res.alreadyFlagged, failed: res.failed,
            undoIds: res.undoIds, failureReason: res.failureReason,
          },
        },
      }));
    });
  };

  // Undoes every id this row's flag click produced — a suspected-duplicate
  // group can flag more than one invoice from one click, so undo has to
  // reverse all of them, not just one (review round 2, finding 2).
  const undoFlag = (row: InvoiceRowRef) => {
    const key = rowKey(row);
    const undoIds = flags[key]?.result?.undoIds ?? [];
    if (undoIds.length === 0) return;
    setFlags((f) => ({ ...f, [key]: { ...f[key], pending: true } }));
    start(async () => {
      const res = await undoFlagReconciledRowForVerification(undoIds);
      if ('error' in res) { setFlags((f) => ({ ...f, [key]: { ...f[key], pending: false, error: res.error } })); return; }
      if (res.failed > 0) {
        // Partial undo: some rows reverted, some didn't — leave the
        // confirmation up (it's still accurate for what remains flagged)
        // rather than clearing it as though everything undid cleanly.
        setFlags((f) => ({ ...f, [key]: { ...f[key], pending: false, error: res.failureReason ?? undefined } }));
        return;
      }
      setFlags((f) => { const next = { ...f }; delete next[key]; return next; });
    });
  };

  // Clears the local confirmation only — the row stays flagged server-side.
  // Re-clicking "Flag Verify" afterwards just hits
  // flagInvoiceForVerification's own already-flagged no-op branch.
  const dismissFlag = (row: InvoiceRowRef) => {
    const key = rowKey(row);
    setFlags((f) => { const next = { ...f }; delete next[key]; return next; });
  };

  const suspectedRowCount = report ? report.suspectedDuplicates.reduce((n, g) => n + g.length, 0) : 0;
  // Value-keyed, not reference-keyed: `report` crosses a server action's
  // serialization boundary, so possibleInvoiceNoDrift's entries aren't
  // guaranteed to be the SAME object instances as the ones in
  // orphans/added even when they describe the same row.
  const driftKeys = new Set((report?.possibleInvoiceNoDrift ?? []).map(rowKey));

  return (
    <div className="space-y-4">
      <section className="rounded-[15px] border border-line bg-sk-surface p-5 shadow-card">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sk-muted">{labels.kicker}</p>
        <p className="mt-1 text-xs text-ink2">{labels.intro}</p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="min-h-11 inline-flex cursor-pointer items-center rounded-[8px] bg-sage px-3 py-1.5 text-[11px] font-[650] leading-none text-white hover:opacity-90 sm:min-h-0">
            {labels.chooseFile}
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={phase === 'busy'}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
            />
          </label>
          <span className="font-mono text-[9px] text-sk-muted">{labels.uploadHint}</span>

          {/* No percentage: parseReconciliationSource is a single server-
              action call with no multipart progress signal to report from —
              same reasoning app/(dash)/(focused)/upload/dropzone.tsx
              documents for its own upload control. */}
          <span role="status" className="block max-w-full truncate text-[10px]">
            {phase === 'busy' && <span className="text-sk-muted">{labels.reading} {fileName}</span>}
            {phase === 'idle' && report && (
              <span className="text-sk-green">
                ✓ {labels.done} · {fileName}
                {/* I6: which sheet was actually compared — parseWorkbook
                    picks the FIRST sheet whose header matches (lib/parse/
                    xlsx.ts), so an archive sheet ordered ahead of the live
                    one would otherwise silently be what this report is
                    based on, with no way for the reader to tell. */}
                {' · '}{labels.sourceSheet.replace('{name}', report.sourceSheetName)}
              </span>
            )}
            {phase === 'error' && errorCode && <span className="text-coral">✗ {uploadErrorMessage(errorCode, labels)}</span>}
          </span>
        </div>
      </section>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={labels.tileSource} value={report.source} />
            <Tile label={labels.tileSystem} value={report.system} />
            <Tile label={labels.tileAdded} value={report.added.length} />
            <Tile label={labels.tileChanged} value={report.changed.length} />
            <Tile label={labels.tileSuspected} value={suspectedRowCount} />
            <Tile label={labels.tileOrphans} value={report.orphans.length} />
          </div>

          <Section title={labels.tileAdded} count={report.added.length} none={labels.none}>
            <ul className="divide-y divide-line2">
              {report.added.map((row) => (
                <li key={rowKey(row)} className="py-2">
                  <RowLine row={row} labels={labels} />
                  {driftKeys.has(rowKey(row)) && <NumberDriftWarning labels={labels} />}
                  <FlagButton labels={labels} state={flags[rowKey(row)]} onFlag={() => flag(row)} onUndo={() => undoFlag(row)} onDismiss={() => dismissFlag(row)} />
                </li>
              ))}
            </ul>
          </Section>

          <Section title={labels.tileChanged} count={report.changed.length} none={labels.none}>
            <ul className="divide-y divide-line2">
              {report.changed.map(({ ref: row, fields }) => {
                const fieldLabel: Record<string, string> = {
                  amount_usd: labels.fieldAmount, received_date: labels.fieldReceived, paid_date: labels.fieldPaidDate,
                  status: labels.fieldStatus, entity: labels.fieldEntity, description: labels.fieldDescription,
                };
                return (
                  <li key={rowKey(row)} className="py-2">
                    <RowLine row={row} labels={labels} />
                    <p className="mt-0.5 text-[10px] text-sk-muted">
                      {labels.changedPrefix} {fields.map((f) => fieldLabel[f] ?? f).join(', ')}
                    </p>
                    <FlagButton labels={labels} state={flags[rowKey(row)]} onFlag={() => flag(row)} onUndo={() => undoFlag(row)} onDismiss={() => dismissFlag(row)} />
                  </li>
                );
              })}
            </ul>
          </Section>

          {/* Header count matches the tile above (total rows across every
              group, review round 2 minor 1) — the per-group row count still
              shows inside, via labels.groupCount, so nothing is lost, but
              "Suspected duplicates" never shows two different numbers under
              the same label on one screen. */}
          <Section title={labels.tileSuspected} count={suspectedRowCount} none={labels.none}>
            <ul className="space-y-3">
              {report.suspectedDuplicates.map((group, i) => (
                // Index keys: group order is stable for the life of one
                // report, and rows within a group can render identically
                // (same vendor/invoice_no/amount/received_date), so i/j is
                // the only thing guaranteed to disambiguate React's own
                // list — the flags state lookup below intentionally keys on
                // the row itself instead (see rowKey's own doc comment).
                <li key={i} className="rounded-lg border border-line2 p-2">
                  <p className="text-[10px] text-sk-muted">{labels.groupCount.replace('{n}', String(group.length))}</p>
                  <ul className="divide-y divide-line2">
                    {group.map((row, j) => (
                      <li key={`${i}-${j}`} className="py-2">
                        <RowLine row={row} labels={labels} />
                        <FlagButton labels={labels} state={flags[rowKey(row)]} onFlag={() => flag(row)} onUndo={() => undoFlag(row)} onDismiss={() => dismissFlag(row)} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={labels.tileOrphans} count={report.orphans.length} none={labels.none}>
            <ul className="divide-y divide-line2">
              {report.orphans.map((row) => (
                <li key={rowKey(row)} className="py-2">
                  <RowLine row={row} labels={labels} />
                  {driftKeys.has(rowKey(row)) && <NumberDriftWarning labels={labels} />}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
