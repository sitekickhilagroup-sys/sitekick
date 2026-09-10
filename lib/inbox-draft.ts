// Draft persistence for the Inbox review drawer (components/inbox/review-board.tsx).
// Today `open(row)` always re-seeds every field from the row — closing the
// drawer (even just switching to another item and back, no reload needed)
// silently discards whatever the user had typed. This keeps that in-progress
// edit in localStorage, keyed per proposal, and detects when it's no longer
// safe to trust: if the underlying proposal moved on (decided elsewhere,
// re-matched to a different task) while the draft sat unsaved, restoring it
// blind could paper over a real change — so a stale draft is never silently
// applied.
import type { ChangeType, ProposalState } from './types';

export interface DraftFields {
  title: string;
  owner: string;
  due: string;
  treatment: ChangeType;
  note: string;
  projectId: string;
  targetTaskId: string;
  substageId: string;
  phaseFilter: string;
}

/** The row fields a draft is checked against at reopen time. */
export interface DraftSnapshot {
  state: ProposalState;
  targetTaskId: string | null;
  title: string;
}

export interface Draft {
  fields: DraftFields;
  snapshot: DraftSnapshot;
  savedAt: string;
}

export function draftKey(proposalId: string): string {
  return `sk:inbox-draft:${proposalId}`;
}

/** True when the row has moved on since the draft was saved — the draft's
 *  edits were made against a version of this item that no longer exists. */
export function isDraftStale(snapshot: DraftSnapshot, row: DraftSnapshot): boolean {
  return snapshot.state !== row.state
    || snapshot.targetTaskId !== row.targetTaskId
    || snapshot.title !== row.title;
}

const isDraftFields = (f: unknown): f is DraftFields => {
  if (!f || typeof f !== 'object') return false;
  const r = f as Record<string, unknown>;
  return typeof r.title === 'string' && typeof r.owner === 'string' && typeof r.due === 'string'
    && typeof r.treatment === 'string' && typeof r.note === 'string' && typeof r.projectId === 'string'
    && typeof r.targetTaskId === 'string' && typeof r.substageId === 'string' && typeof r.phaseFilter === 'string';
};

const isDraftSnapshot = (s: unknown): s is DraftSnapshot => {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return typeof r.state === 'string' && typeof r.title === 'string'
    && (r.targetTaskId === null || typeof r.targetTaskId === 'string');
};

/**
 * Narrows an arbitrary parsed JSON value down to a Draft, or returns null.
 * localStorage content is untrusted — it could be from an older app version
 * whose fields have since changed shape, or hand-edited — and must never be
 * assumed to match the current Draft shape without checking.
 */
export function parseDraft(raw: string): Draft | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return null;
    const r = v as Record<string, unknown>;
    if (!isDraftFields(r.fields) || !isDraftSnapshot(r.snapshot) || typeof r.savedAt !== 'string') return null;
    return { fields: r.fields, snapshot: r.snapshot, savedAt: r.savedAt };
  } catch {
    return null;
  }
}
