// Demo Safety Gate — deterministic, free, no-API preflight triage for
// uploaded documents. Runs entirely on data already in hand (kind, raw_text,
// storage_path, and the projects list) — no download, no model call, no
// cost. This is FILTERING, not a business decision: it never decides what a
// document means, only whether there's enough deterministic signal to place
// it in one of three buckets a human then chooses from. Needs no migration —
// every signal is derived live from existing `documents` columns.
import type { DocKind } from './types.ts';
import { matchingProjectIds, type ProjectMatchCandidate } from './project-match.ts';

export const MIN_TEXT_CHARS = 20;
// A single communication beyond this is a genuine outlier for this system —
// not a hard block (nothing here is), just a signal that a human should
// look before spending demo budget on it.
export const PREFLIGHT_MAX_CHARS = 60_000;

export type PreflightGroup = 'do_not_process' | 'needs_selection' | 'candidate';

export type PreflightReason =
  | 'duplicate' | 'no_extractable_text' | 'too_large'
  | 'project_ambiguous' | 'source_ambiguous' | 'no_project_signal'
  | 'project_identified';

/** Cross-document duplicate detection (Demo Safety Gate hardening, Rotem,
 *  2026-09-13, round 2). A TRUE duplicate normally never reaches this at all
 *  — ingestDocument's own external_id/content_hash dedup returns the
 *  existing row instead of inserting a second one. This exists as a
 *  defensive layer for content that slipped past that (e.g. data ingested
 *  before every email path set content_hash) — within the batch of
 *  documents actually being rendered, any two sharing a non-null
 *  content_hash are flagged; the OLDEST (by received_at) is "the original,"
 *  every newer one is marked a duplicate of it. This must be applied BEFORE
 *  classifyPreflight (it overrides every other signal — a duplicate is
 *  never a candidate, however clean its project match looks).
 */
export function findBatchDuplicates<T extends { id: string; content_hash: string | null }>(
  docsNewestFirst: T[],
): Map<string, string> {
  const duplicateOf = new Map<string, string>();
  const originalIdByHash = new Map<string, string>();
  // Walk oldest-first (the input is newest-first) so the first doc seen for
  // a given hash is genuinely the earliest — "the original."
  for (const doc of [...docsNewestFirst].reverse()) {
    if (!doc.content_hash) continue;
    const existingOriginal = originalIdByHash.get(doc.content_hash);
    if (existingOriginal) duplicateOf.set(doc.id, existingOriginal);
    else originalIdByHash.set(doc.content_hash, doc.id);
  }
  return duplicateOf;
}

export interface PreflightDocInput {
  kind: DocKind;
  raw_text: string | null;
  storage_path: string | null;
}

export interface PreflightSignals {
  hasText: boolean;
  isTooLarge: boolean;
  matchedProjectIds: string[];
  /** Only meaningful for email — other kinds have no comparable concept and
   *  are always "known" (there's nothing to be ambiguous about). */
  senderKnown: boolean;
}

export interface PreflightClassification {
  group: PreflightGroup;
  reasons: PreflightReason[];
}

export interface PreflightResult extends PreflightClassification {
  matchedProjectIds: string[];
  sender: string | null;
}

/** Claude reads PDFs natively, scans included — pdf-parse finding no text
 *  layer would NOT mean Claude can't read it, so invoice_pdf is never
 *  blocked on this signal (see lib/pdf.ts's own comment: parse-invoice hands
 *  the raw PDF to Claude, not through pdfToText). An .mp4 "recording" is
 *  stored under kind='transcript' with a storage_path and no raw_text —
 *  store+link only, never transcribed, so it never has text to process. */
export function computeHasText(doc: PreflightDocInput): boolean {
  if (doc.kind === 'invoice_pdf') return true;
  if (doc.kind === 'transcript' && !doc.raw_text && doc.storage_path) return false;
  return (doc.raw_text?.trim().length ?? 0) >= MIN_TEXT_CHARS;
}

export function computeIsTooLarge(doc: PreflightDocInput): boolean {
  return (doc.raw_text?.length ?? 0) > PREFLIGHT_MAX_CHARS;
}

const FROM_LINE = /^from:\s*(.+)$/im;
/** Emails built by lib/parse/eml.ts and lib/parse/emails-jsonl.ts always
 *  begin "From: ...\nTo: ...\nDate: ...\nSubject: ..." — a deterministic
 *  header line, not a model read. */
export function senderFromRawText(rawText: string | null): string | null {
  if (!rawText) return null;
  const m = FROM_LINE.exec(rawText);
  return m ? m[1].trim() : null;
}

/** Pure classification from already-computed signals — the actual filtering
 *  rule, independent of how the signals were derived (so it's testable with
 *  hand-built inputs, not just real documents). */
export function classifyPreflight(signals: PreflightSignals): PreflightClassification {
  if (!signals.hasText) return { group: 'do_not_process', reasons: ['no_extractable_text'] };
  if (signals.isTooLarge) return { group: 'do_not_process', reasons: ['too_large'] };

  const reasons: PreflightReason[] = [];
  if (signals.matchedProjectIds.length >= 2) reasons.push('project_ambiguous');
  if (!signals.senderKnown) reasons.push('source_ambiguous');
  if (reasons.length) return { group: 'needs_selection', reasons };

  if (signals.matchedProjectIds.length === 1) return { group: 'candidate', reasons: ['project_identified'] };
  // Zero project matches, nothing else flagged: honest — there is genuinely
  // no deterministic signal either way, so this stays a human decision
  // rather than a confident "candidate" on a tight demo budget.
  return { group: 'needs_selection', reasons: ['no_project_signal'] };
}

/** End-to-end: derive signals from a document row + the projects list, then
 *  classify. Zero DB access, zero model calls — safe to run for every row on
 *  every Data Inbox render. */
export function runPreflight(doc: PreflightDocInput, projects: ProjectMatchCandidate[]): PreflightResult {
  const hasText = computeHasText(doc);
  const isTooLarge = computeIsTooLarge(doc);
  const matchedProjectIds = doc.raw_text ? matchingProjectIds(doc.raw_text, projects) : [];
  const sender = senderFromRawText(doc.raw_text);
  const senderKnown = doc.kind !== 'email' || !!sender;
  const classification = classifyPreflight({ hasText, isTooLarge, matchedProjectIds, senderKnown });
  return { ...classification, matchedProjectIds, sender };
}
