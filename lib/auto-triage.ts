// Auto-triage for the review inbox (Dor, 2026-08-29: "81 need review is too
// many — reduce to almost nothing, and the system must learn from every
// human review").
//
// Two mechanisms, layered:
//
//  1. LEARNED CLASS THRESHOLDS — every proposal belongs to a class
//     (type × reasoning family). Human decisions on that class move its
//     acceptance stats; once a class has enough history, ≥85% acceptance
//     auto-applies it and ≥85% rejection/ignoring auto-ignores it. This is
//     recomputed from agent_proposals on every run, so each review Noa does
//     immediately tunes the next batch — no separate training step. Agent
//     decisions (decided_by 'agent:…') are excluded so the loop can never
//     feed itself.
//
//  2. SAFE-DELTA DEFAULTS — before any history exists, a narrow set of
//     structurally additive suggestions auto-applies: an id-matched task
//     update that only ENRICHES (fills empty fields, refreshes description /
//     waiting_for) and a project-attributed decision log entry. Anything that
//     CONFLICTS with current state (moves an existing due date, flips owner,
//     escalates to critical, closes a task) stays for human review, exactly
//     per the brief: no destructive change without approval.
//
// Numbers from production on 2026-08-28: 113 pending, of which 58 were
// id-matched enrichment updates that Noa historically accepts ~87% of the
// time — the class this file exists to clear.

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyProposal, logActivity } from './state-writer.ts';
import { tokenize } from './dedup.ts';
import type { AgentProposal, Task } from './types.ts';

export type TriageAction = 'auto_apply' | 'auto_ignore' | 'review';

export interface TriageVerdict {
  action: TriageAction;
  reason: string;
  classKey: string;
}

export const TRIAGE_ACTOR = 'agent:auto-triage';

/** Reasoning strings the router emits, folded into stable class families —
 *  free-text evidence reasons (deadline quotes etc.) all fold into 'other'. */
function reasoningFamily(reasoning: string | null): string {
  const r = (reasoning ?? '').toLowerCase();
  if (r.startsWith('model matched existing task')) return 'matched_id';
  if (r.startsWith('fuzzy title match')) return 'fuzzy';
  if (r.startsWith('loose title match')) return 'loose';
  if (r.startsWith('no project evidence')) return 'no_project';
  if (r.startsWith('model claimed an update')) return 'claimed_update';
  if (r.startsWith('new blocker asserted')) return 'asserted';
  if (r.startsWith('decision asserted')) return 'asserted';
  return 'other';
}

export function proposalClass(p: Pick<AgentProposal, 'type' | 'reasoning'>): string {
  return `${p.type}|${reasoningFamily(p.reasoning)}`;
}

export interface ClassStats {
  n: number;
  accepted: number;
  /** rejected + ignored — the human said "don't bring me these". */
  negative: number;
}

export interface HistoryRow {
  type: string;
  reasoning: string | null;
  state: string;
  decided_by: string | null;
}

/** Only human decisions teach. auto_applied rows and anything decided by an
 *  agent actor are excluded — a threshold must never learn from its own
 *  output. not_sure counts toward n but toward neither side: it dilutes both
 *  rates, which is the honest reading of "I couldn't tell". */
export function computeClassStats(history: HistoryRow[]): Map<string, ClassStats> {
  const stats = new Map<string, ClassStats>();
  for (const h of history) {
    if (!h.decided_by || h.decided_by.startsWith('agent:')) continue;
    if (h.state !== 'accepted' && h.state !== 'rejected' && h.state !== 'ignored' && h.state !== 'not_sure') continue;
    const key = proposalClass({ type: h.type as AgentProposal['type'], reasoning: h.reasoning });
    const s = stats.get(key) ?? { n: 0, accepted: 0, negative: 0 };
    s.n++;
    if (h.state === 'accepted') s.accepted++;
    if (h.state === 'rejected' || h.state === 'ignored') s.negative++;
    stats.set(key, s);
  }
  return stats;
}

export const MIN_CLASS_N = 5;
export const AUTO_APPLY_RATE = 0.85;
export const AUTO_IGNORE_RATE = 0.85;

type TriageProposal = Pick<
  AgentProposal,
  'type' | 'reasoning' | 'confidence' | 'project_id' | 'target_task_id' | 'payload'
>;

type TargetTask = Pick<Task, 'due' | 'owner' | 'priority' | 'status'>;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** True when the update only adds/refreshes information — nothing it writes
 *  contradicts what the task already says. Mirrors exactly what
 *  applyProposal writes for task_update (description, owner, due,
 *  follow_up_date, priority, status, waiting_for). */
export function isSafeEnrichment(payload: Record<string, unknown>, task: TargetTask): boolean {
  if (s(payload.status) === 'done') return false;                         // closing needs a human
  const due = s(payload.due);
  if (due && task.due && due !== task.due) return false;                  // moves a real date
  const owner = s(payload.owner);
  if (owner && task.owner && owner.toLowerCase() !== task.owner.trim().toLowerCase()) return false;
  if (s(payload.priority) === 'critical' && task.priority !== 'critical') return false; // escalation
  return true;
}

export function classifyProposal(
  p: TriageProposal,
  targetTask: TargetTask | null,
  stats: Map<string, ClassStats>,
): TriageVerdict {
  const classKey = proposalClass(p);

  // Learned thresholds first — in BOTH directions they beat the defaults, so
  // a class the defaults would auto-apply stops auto-applying the moment Noa
  // starts rejecting it, and vice versa.
  const st = stats.get(classKey);
  if (st && st.n >= MIN_CLASS_N) {
    if (st.accepted / st.n >= AUTO_APPLY_RATE) {
      // Even a learned auto-apply never overrides the structural safety rail
      // on updates: a conflicting delta still goes to review.
      if (p.type === 'task_update' || p.type === 'task_done') {
        if (targetTask && targetTask.status === 'open' && isSafeEnrichment(p.payload, targetTask)) {
          return { action: 'auto_apply', reason: `learned: ${st.accepted}/${st.n} of this class accepted`, classKey };
        }
        return { action: 'review', reason: 'learned-accept class but delta conflicts with current task', classKey };
      }
      return { action: 'auto_apply', reason: `learned: ${st.accepted}/${st.n} of this class accepted`, classKey };
    }
    if (st.negative / st.n >= AUTO_IGNORE_RATE) {
      return { action: 'auto_ignore', reason: `learned: ${st.negative}/${st.n} of this class rejected or ignored`, classKey };
    }
  }

  // Structural defaults.
  if (p.type === 'task_update' && reasoningFamily(p.reasoning) === 'matched_id'
    && p.confidence >= 0.75 && p.target_task_id && targetTask && targetTask.status === 'open'
    && isSafeEnrichment(p.payload, targetTask)) {
    return { action: 'auto_apply', reason: 'id-matched enrichment — adds information, changes nothing established', classKey };
  }
  if (p.type === 'decision_create' && p.project_id && p.confidence >= 0.6) {
    return { action: 'auto_apply', reason: 'additive decision log entry on an attributed project', classKey };
  }
  return { action: 'review', reason: 'needs human judgment', classKey };
}

// ── Attribution learning ────────────────────────────────────────────────────
// When Noa files an unattributed suggestion under a project, the item's
// distinctive tokens become a rule; future no-evidence items whose text
// covers those tokens auto-attribute to that project.

export interface AttributionRule {
  id: string;
  tokens: string[];
  project_id: string;
}

/** The most distinctive tokens of a title — longest first, capped, so the
 *  rule is the vendor/subject identity rather than the sentence. */
export function attributionTokens(title: string): string[] {
  return [...tokenize(title)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 6);
}

export function matchAttribution(
  text: string,
  rules: AttributionRule[],
): AttributionRule | null {
  const have = tokenize(text);
  let best: AttributionRule | null = null;
  let bestCover = 0;
  for (const r of rules) {
    if (r.tokens.length < 2) continue; // one shared word is not an identity
    let covered = 0;
    for (const t of r.tokens) if (have.has(t)) covered++;
    const cover = covered / r.tokens.length;
    if (cover >= 0.8 && cover > bestCover) { best = r; bestCover = cover; }
  }
  return best;
}

// ── Runner ──────────────────────────────────────────────────────────────────

export interface TriageSummary {
  applied: number;
  ignored: number;
  kept: number;
  errors: number;
}

/** Fetch what classifyProposal needs once per batch. */
export async function loadTriageContext(admin: SupabaseClient): Promise<{
  stats: Map<string, ClassStats>;
  rules: AttributionRule[];
}> {
  const [historyQ, rulesQ] = await Promise.all([
    admin.from('agent_proposals')
      .select('type,reasoning,state,decided_by')
      .not('decided_at', 'is', null)
      .order('decided_at', { ascending: false })
      .limit(500),
    admin.from('review_rules')
      .select('id,match,outcome')
      .eq('kind', 'attribute_project')
      .eq('active', true),
  ]);
  const stats = computeClassStats((historyQ.data ?? []) as HistoryRow[]);
  const rules: AttributionRule[] = ((rulesQ.data ?? []) as { id: string; match: { tokens?: string[] }; outcome: { project_id?: string } }[])
    .filter((r) => Array.isArray(r.match?.tokens) && typeof r.outcome?.project_id === 'string')
    .map((r) => ({ id: r.id, tokens: r.match.tokens!, project_id: r.outcome.project_id! }));
  return { stats, rules };
}

/**
 * Triage a batch of PENDING proposal rows already in the database: apply the
 * auto-appliable, ignore the auto-ignorable, leave the rest for humans. Used
 * both at ingest time (on the rows a document just produced) and by the
 * sweep over the existing backlog.
 */
export async function runAutoTriage(
  admin: SupabaseClient,
  proposals: AgentProposal[],
  opts?: { today?: string },
): Promise<TriageSummary> {
  const summary: TriageSummary = { applied: 0, ignored: 0, kept: 0, errors: 0 };
  if (!proposals.length) return summary;
  const { stats } = await loadTriageContext(admin);
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);

  const targetIds = [...new Set(proposals.map((p) => p.target_task_id).filter((x): x is string => !!x))];
  const { data: targets } = targetIds.length
    ? await admin.from('tasks').select('id,due,owner,priority,status').in('id', targetIds)
    : { data: [] };
  const targetById = new Map(((targets ?? []) as (TargetTask & { id: string })[]).map((t) => [t.id, t]));

  for (const p of proposals) {
    if (p.state !== 'pending') { summary.kept++; continue; }
    const target = p.target_task_id ? targetById.get(p.target_task_id) ?? null : null;
    const verdict = classifyProposal(p, target, stats);
    if (verdict.action === 'review') { summary.kept++; continue; }

    if (verdict.action === 'auto_apply') {
      const applied = await applyProposal(admin, p, TRIAGE_ACTOR, today);
      if ('error' in applied) {
        // Application failed (target vanished, match failed) — the row stays
        // pending; a human still sees it. Loud in the log, silent nowhere.
        console.error('[auto-triage] apply failed:', p.id, applied.error);
        summary.errors++;
        continue;
      }
      await admin.from('agent_proposals').update({
        state: 'auto_applied',
        decided_by: TRIAGE_ACTOR,
        decided_at: new Date().toISOString(),
        result_note: verdict.reason,
      }).eq('id', p.id);
      await logActivity(admin, {
        entity_type: 'proposal', entity_id: p.id, actor: TRIAGE_ACTOR,
        action: 'auto_apply', after: { class: verdict.classKey, reason: verdict.reason },
      });
      summary.applied++;
    } else {
      await admin.from('agent_proposals').update({
        state: 'ignored',
        decided_by: TRIAGE_ACTOR,
        decided_at: new Date().toISOString(),
        result_note: verdict.reason,
      }).eq('id', p.id);
      await logActivity(admin, {
        entity_type: 'proposal', entity_id: p.id, actor: TRIAGE_ACTOR,
        action: 'auto_ignore', after: { class: verdict.classKey, reason: verdict.reason },
      });
      summary.ignored++;
    }
  }
  return summary;
}
