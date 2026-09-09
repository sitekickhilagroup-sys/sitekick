import type { SupabaseClient } from '@supabase/supabase-js';

// Using Noa's verified feedback (Noa's report §3 / Rotem's directive): her
// confirmed notes and her match decisions influence what the agents SEE before
// they suggest — the association (create-vs-update) and the ranker's context —
// without changing any business record on their own.
//
// Kill-switch: feedback use is ON by default and reverts with FEEDBACK_USE set
// to 0/false/off — the switch STOPS using feedback and returns the agents to
// their prior behaviour without deleting any evidence (the rows stay; only the
// prompt blocks stop being added). Feedback here is context-only: it never
// mutates a business record, so on is safe; off is the one-env-var rollback.
export function feedbackUseEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.FEEDBACK_USE ?? '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** A note a human CONFIRMED (comments.intent, not the raw suggestion) —
 *  a fact/correction or a preference, pinned to a task. */
export interface VerifiedNote {
  taskId: string;
  body: string;
  intent: 'fact' | 'preference';
  date: string; // YYYY-MM-DD
}

/** A reviewer's judgment that a proposal is / is not the same as a task. */
export interface MatchDecision {
  taskId: string;
  title: string;
  same: boolean; // true = confirmed the same (prefer update), false = not the same (never match)
}

const DATED = (s: string | null | undefined): string => (s ?? '').slice(0, 10);

/**
 * PURE: the extractor/ranker context block for human-verified notes. Facts a
 * person confirmed are authoritative and must not be re-asserted-away or
 * overridden by older extracted text — the Greg case: "the 2026-09-04 date is
 * not his commitment" has to reach the agent so it stops presenting that date
 * as a deadline. Empty string when there are no notes (block simply absent).
 */
export function renderVerifiedNotes(notes: VerifiedNote[]): string {
  if (!notes.length) return '';
  const lines = notes
    .map((n) => `- [task ${n.taskId}] (${n.intent}${n.date ? `, ${n.date}` : ''}) ${n.body.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  return `HUMAN-VERIFIED CONTEXT (a person on the team confirmed these facts and corrections; treat them as authoritative — do NOT re-assert anything they corrected, and never let older text override a newer correction):\n${lines}\n\n`;
}

/**
 * PURE: the extractor's context block for human match decisions. A "same as"
 * confirmation should make the extractor prefer UPDATING that task over
 * creating a near-duplicate; a "not the same" rejection must stop it re-matching
 * that pairing (the review-queue flood + Noa's "it thinks the task is a
 * duplicate of itself"). Empty string when there are none.
 */
export function renderMatchDecisions(decisions: MatchDecision[]): string {
  if (!decisions.length) return '';
  const same = decisions.filter((d) => d.same);
  const not = decisions.filter((d) => !d.same);
  const seg = (d: MatchDecision) => `- task ${d.taskId}: "${d.title.replace(/\s+/g, ' ').trim()}"`;
  const parts: string[] = [];
  if (same.length) parts.push(`CONFIRMED THE SAME by a reviewer (prefer emitting op="update" against that task over a new near-duplicate):\n${same.map(seg).join('\n')}`);
  if (not.length) parts.push(`REJECTED AS NOT THE SAME by a reviewer (do NOT match this kind of item to that task, even on a strong title overlap):\n${not.map(seg).join('\n')}`);
  return `HUMAN MATCH DECISIONS:\n${parts.join('\n')}\n\n`;
}

/**
 * Load human-confirmed notes for the given tasks. Uses comments.intent (the
 * value a human confirmed/corrected), never suggested_intent. Only fact and
 * preference count — a one-off instruction is not standing context. Gated:
 * returns [] when FEEDBACK_USE is off, or when the comments table is absent.
 */
export async function loadVerifiedNotes(
  admin: SupabaseClient,
  taskIds: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<VerifiedNote[]> {
  if (!feedbackUseEnabled(env) || taskIds.length === 0) return [];
  const { data, error } = await admin
    .from('comments')
    .select('entity_id, body, intent, created_at')
    .eq('entity_type', 'task')
    .in('entity_id', taskIds)
    .in('intent', ['fact', 'preference'])
    .order('created_at', { ascending: false })
    .limit(60);
  if (error || !data) return []; // table missing (migration not applied) → no context, never a crash
  return (data as { entity_id: string; body: string; intent: 'fact' | 'preference'; created_at: string }[])
    .map((c) => ({ taskId: c.entity_id, body: c.body, intent: c.intent, date: DATED(c.created_at) }));
}

/**
 * Load reviewers' match decisions from the proposals already decided: an
 * accepted update against a task is a "same as" confirmation; a rejected
 * proposal that carried a matched target is a "not the same". Gated; returns []
 * when FEEDBACK_USE is off.
 */
export async function loadMatchDecisions(
  admin: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
): Promise<MatchDecision[]> {
  if (!feedbackUseEnabled(env)) return [];
  const { data, error } = await admin
    .from('agent_proposals')
    .select('title, target_task_id, state, change_type')
    .not('target_task_id', 'is', null)
    .in('state', ['accepted', 'rejected'])
    .order('decided_at', { ascending: false })
    .limit(80);
  if (error || !data) return [];
  const UPDATE_BRANCH = ['update_existing', 'complete_existing', 'merge_duplicate', 'keep_open'];
  const out: MatchDecision[] = [];
  for (const r of data as { title: string | null; target_task_id: string; state: string; change_type: string | null }[]) {
    if (!r.title) continue;
    if (r.state === 'accepted' && r.change_type && UPDATE_BRANCH.includes(r.change_type)) {
      out.push({ taskId: r.target_task_id, title: r.title, same: true });
    } else if (r.state === 'rejected') {
      out.push({ taskId: r.target_task_id, title: r.title, same: false });
    }
  }
  return out;
}
