import type { SupabaseClient } from '@supabase/supabase-js';
import { tokenize } from './dedup.ts';

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

// Postgres SQLSTATE for "column does not exist" — the ONE error shape safe to
// treat as "migration 0026 hasn't landed yet, isolation is moot" and fall back
// to a pre-migration query. Any other error (network, permissions, a typo)
// must fail closed instead of silently bypassing isolation.
const UNDEFINED_COLUMN = '42703';

/** A note a human RECORDED and classified (comments.intent, not the raw
 *  suggestion) as a fact/correction or a preference, pinned to a task. This is
 *  their recorded input — NOT independently-verified ground truth. */
export interface VerifiedNote {
  taskId: string;
  body: string;
  intent: 'fact' | 'preference';
  date: string; // YYYY-MM-DD (display)
  at: string;   // full ISO timestamp (used to collapse same-session restatements)
}

// Same task + same intent + strong token overlap = one correction restated,
// not two independent signals. Deliberately NOT time-based: writing two notes
// close together is not proof they're the same correction (Rotem's
// correction) — only real content overlap merges anything.
//
// tokenize() (lib/dedup.ts) strips anything outside [a-z0-9] — it is Latin-
// only. Hebrew text survives as leftover digit fragments alone (verified:
// "גרג אמר שיתקן וישיב עד סוף השבוע. התאריך 04.09 אינו התחייבות שלו" tokenizes
// to just {'04','09'}), which then reads as 100%-"contained" in almost any
// English text sharing those two digits — a false-positive merge, not a real
// one. MIN_TOKENS refuses to judge overlap at all when either side's token
// set is too sparse to mean anything, rather than trust a comparison it
// cannot make reliably. Net effect: a genuine cross-language restatement (a
// Hebrew note and its English translation) is NOT collapsed — it shows as two
// distinct, separately-authored notes, which is the honest default now that
// neither time proximity nor this tokenizer can prove they're the same text.
const MIN_TOKENS = 3;
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size < MIN_TOKENS || b.size < MIN_TOKENS) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * PURE: collapse near-duplicate corrections on the SAME task — ONLY when the
 * text itself overlaps strongly (a same-language restatement of one
 * correction) — so that case counts as ONE in the processing path, not two.
 * Keeps the most recent of a duplicate group.
 */
export function dedupeVerifiedNotes(notes: VerifiedNote[]): VerifiedNote[] {
  const byRecency = [...notes].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const kept: { note: VerifiedNote; tokens: Set<string> }[] = [];
  for (const n of byRecency) {
    const tokens = tokenize(n.body);
    const dup = kept.find((k) =>
      k.note.taskId === n.taskId && k.note.intent === n.intent && overlap(k.tokens, tokens) >= 0.5);
    if (!dup) kept.push({ note: n, tokens });
  }
  return kept.map((k) => k.note);
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
  return `HUMAN-RECORDED CONTEXT (a person on the team recorded these as facts/corrections — NOT as instructions, and NOT independently-verified truth. Weigh them as human-provided context: do not re-assert something they explicitly corrected, and do not let older text override a newer human correction):\n${lines}\n\n`;
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
  const base = () => admin
    .from('comments')
    .select('entity_id, body, intent, created_at')
    .eq('entity_type', 'task')
    .in('entity_id', taskIds)
    .in('intent', ['fact', 'preference'])
    .order('created_at', { ascending: false })
    .limit(60);
  // A test note or one Noa dismissed must never reach the ranker/extractor.
  // Try the excluding query first; fall back to the plain pre-migration query
  // ONLY when the failure is specifically "is_test/status doesn't exist yet"
  // (Postgres undefined_column, 42703) — the one case where isolation is a
  // moot concept because no test/dismissed data can exist without the column
  // to mark it. Any OTHER error (network, permissions, anything else) must
  // fail CLOSED — falling back to the unfiltered query on an arbitrary error
  // would let a real failure quietly bypass isolation, which is worse than
  // returning no feedback context at all for that call.
  const excluding = await base().eq('is_test', false).neq('status', 'dismissed');
  let result = excluding;
  if (excluding.error) {
    if ((excluding.error as { code?: string }).code === UNDEFINED_COLUMN) {
      result = await base();
    } else {
      return [];
    }
  }
  const { data, error } = result;
  if (error || !data) return []; // table missing entirely → no context, never a crash
  const notes = (data as { entity_id: string; body: string; intent: 'fact' | 'preference'; created_at: string }[])
    .map((c) => ({ taskId: c.entity_id, body: c.body, intent: c.intent, date: DATED(c.created_at), at: c.created_at }));
  // Two genuinely-restated versions of one correction collapse to a single
  // case here, in the path — content overlap only, never by proximity in time.
  return dedupeVerifiedNotes(notes);
}

/**
 * Load reviewers' match decisions. ONLY the explicit POSITIVE signal is used: a
 * HUMAN accepted a proposal as an update/merge against a specific task = "the
 * same as that task" (prefer update over a near-duplicate).
 *
 * There is deliberately NO negative signal from rejections. A rejection is not
 * a "not the same task" decision — verified against the data, every rejected-
 * with-target row was a content / date / "mark done" / bad-bucket / test
 * rejection while the target task itself was fine. Absent an EXPLICIT
 * not-duplicate decision (none is recorded today), the negative meaning is left
 * UNKNOWN and never asserted. Auto-triage acceptances are excluded — only a
 * person's confirmation counts. Gated; returns [] when FEEDBACK_USE is off.
 */
export async function loadMatchDecisions(
  admin: SupabaseClient,
  env: Record<string, string | undefined> = process.env,
): Promise<MatchDecision[]> {
  if (!feedbackUseEnabled(env)) return [];

  // A decision whose target is a test task (its own flag, or under a test
  // project) must never become a "confirmed same" signal. Determine the
  // excluded-task set BEFORE reading proposals. Fail CLOSED (no decisions at
  // all) on a real error; a missing is_test column on projects/tasks
  // (pre-migration — no test data can exist without it) is the one case safe
  // to treat as "nothing to exclude".
  const excludedTaskIds = await loadTestTaskIds(admin);
  if (excludedTaskIds === null) return [];

  const UPDATE_BRANCH = ['update_existing', 'complete_existing', 'merge_duplicate', 'keep_open'];
  const { data, error } = await admin
    .from('agent_proposals')
    .select('title, target_task_id, change_type, decided_by')
    .not('target_task_id', 'is', null)
    .eq('state', 'accepted')
    .in('change_type', UPDATE_BRANCH)
    .order('decided_at', { ascending: false })
    .limit(80);
  if (error || !data) return [];
  const out: MatchDecision[] = [];
  for (const r of data as { title: string | null; target_task_id: string; change_type: string | null; decided_by: string | null }[]) {
    if (!r.title) continue;
    if (excludedTaskIds.has(r.target_task_id)) continue;
    // Human confirmations only — an agent's auto-triage acceptance is not Noa's.
    if (!r.decided_by || r.decided_by.startsWith('agent:')) continue;
    out.push({ taskId: r.target_task_id, title: r.title, same: true });
  }
  return out;
}

/**
 * The set of task ids that are test records — is_test directly, or under a
 * project flagged is_test. Shared by loadMatchDecisions; kept in this module
 * (rather than lib/open-tasks.ts) because it returns an id SET for filtering
 * an unrelated table (agent_proposals), not a tasks query result.
 *
 * Returns:
 *  - a Set (possibly empty) on success, or when is_test genuinely doesn't
 *    exist yet (pre-migration — nothing to exclude because nothing can be
 *    marked test yet);
 *  - null on any OTHER error — the caller must fail closed, never proceed as
 *    if isolation succeeded when it didn't.
 */
async function loadTestTaskIds(admin: SupabaseClient): Promise<Set<string> | null> {
  const projectsQ = await admin.from('projects').select('id').eq('is_test', true);
  if (projectsQ.error) {
    if ((projectsQ.error as { code?: string }).code !== UNDEFINED_COLUMN) return null;
    return new Set(); // column missing — no test projects can exist yet
  }
  const testProjectIds = (projectsQ.data ?? []).map((p: { id: string }) => p.id);

  const tasksQ = testProjectIds.length
    ? await admin.from('tasks').select('id').or(`is_test.eq.true,project_id.in.(${testProjectIds.join(',')})`)
    : await admin.from('tasks').select('id').eq('is_test', true);
  if (tasksQ.error) {
    if ((tasksQ.error as { code?: string }).code !== UNDEFINED_COLUMN) return null;
    return new Set();
  }
  return new Set((tasksQ.data ?? []).map((t: { id: string }) => t.id));
}
