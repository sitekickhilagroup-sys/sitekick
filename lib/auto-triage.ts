// Auto-triage for the review inbox (Dor, 2026-08-29: "reduce to almost
// nothing — no guessing, learning only").
//
// Every reduction here is either PROVABLE or LEARNED — never an LLM's
// judgment call:
//
//  1. LEARNED CLASS THRESHOLDS — every proposal belongs to a class
//     (type × reasoning family × payload shape). Human decisions on that
//     class move its acceptance stats; once a class has enough history,
//     ≥85% acceptance auto-applies it and ≥85% rejection/ignoring
//     auto-ignores it. Payload shape makes the classes fine-grained: a
//     due-date move, a completion, an owner change and a plain enrichment
//     learn separately — so when Noa keeps accepting due-moves, due-moves
//     start applying themselves, without anyone guessing. Recomputed from
//     agent_proposals on every run; agent decisions (decided_by 'agent:…')
//     are excluded so the loop can never feed itself.
//
//  2. SAFE-DELTA DEFAULT — before any history exists, an id-matched task
//     update that only ENRICHES (fills empty fields, refreshes description /
//     waiting_for) auto-applies, plus attributed decision log entries.
//     Anything that CHANGES established data waits for a human until the
//     class earns its threshold.
//
//  3. PROVABLE NO-OPS — deterministic checks against current state, zero
//     judgment: an update that asserts only what the register already says;
//     a completion for a task that is already closed; a pending duplicate of
//     another pending proposal (same identity key the ingest dedup uses).
//     These leave the queue as 'ignored' with the proof in result_note.
//
// Production numbers: 113 pending on 8/28; the first rule sweep cleared 59.

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyProposal, logActivity } from './state-writer.ts';
import { tokenize } from './dedup.ts';
import { proposalKey, type ProposalIdentity } from './proposals.ts';
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

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The SHAPE of what an update asserts, from the payload alone (so it is
 *  computable for historical rows too, where the then-current task state is
 *  gone). Ordered by risk: the riskiest asserted field names the class. */
export function payloadShape(type: string, payload: Record<string, unknown>): string {
  if (type !== 'task_update' && type !== 'task_done') return '';
  if (type === 'task_done' || s(payload.status) === 'done') return 'closes';
  if (s(payload.priority) === 'critical') return 'escalates';
  if (s(payload.due)) return 'dates';
  if (s(payload.owner)) return 'owner';
  return 'text';
}

export function proposalClass(p: Pick<AgentProposal, 'type' | 'reasoning'> & { payload?: Record<string, unknown> }): string {
  const shape = payloadShape(p.type, p.payload ?? {});
  return `${p.type}|${reasoningFamily(p.reasoning)}${shape ? `|${shape}` : ''}`;
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
  payload?: Record<string, unknown> | null;
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
    const key = proposalClass({ type: h.type as AgentProposal['type'], reasoning: h.reasoning, payload: h.payload ?? {} });
    const st = stats.get(key) ?? { n: 0, accepted: 0, negative: 0 };
    st.n++;
    if (h.state === 'accepted') st.accepted++;
    if (h.state === 'rejected' || h.state === 'ignored') st.negative++;
    stats.set(key, st);
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

type TargetTask = Pick<Task, 'due' | 'owner' | 'priority' | 'status' | 'description' | 'waiting_for'>;

/** True when the update only adds/refreshes information — nothing it writes
 *  contradicts what the task already says. Mirrors exactly what
 *  applyProposal writes for task_update (description, owner, due,
 *  follow_up_date, priority, status, waiting_for). */
export function isSafeEnrichment(payload: Record<string, unknown>, task: TargetTask): boolean {
  if (s(payload.status) === 'done') return false;                         // closing needs a human (or a learned class)
  const due = s(payload.due);
  if (due && task.due && due !== task.due) return false;                  // moves a real date
  const owner = s(payload.owner);
  if (owner && task.owner && owner.toLowerCase() !== task.owner.trim().toLowerCase()) return false;
  if (s(payload.priority) === 'critical' && task.priority !== 'critical') return false; // escalation
  return true;
}

/** PROVABLE no-op: every field the update asserts is either empty or exactly
 *  what the task already says, and there is no new text. Applying it would
 *  change nothing — pure echo, deterministically ignorable. */
export function isNoOpUpdate(payload: Record<string, unknown>, task: TargetTask): boolean {
  const sameOr = (v: string, cur: string | null) => !v || v.toLowerCase() === (cur ?? '').trim().toLowerCase();
  if (s(payload.status) === 'done') return false; // a completion is never a no-op against an open task
  if (!sameOr(s(payload.due), task.due)) return false;
  if (!sameOr(s(payload.owner), task.owner)) return false;
  if (!sameOr(s(payload.waiting_for), task.waiting_for)) return false;
  if (s(payload.priority) === 'critical' && task.priority !== 'critical') return false;
  const desc = s(payload.description);
  const hasNewText = !!desc && desc.toLowerCase() !== (task.description ?? '').trim().toLowerCase();
  return !hasNewText;
}

export function classifyProposal(
  p: TriageProposal,
  targetTask: TargetTask | null,
  stats: Map<string, ClassStats>,
): TriageVerdict {
  const classKey = proposalClass(p);
  const pay = p.payload ?? {};

  // PROVABLE no-ops first — no judgment involved, only comparison.
  if ((p.type === 'task_update' || p.type === 'task_done') && targetTask) {
    if (targetTask.status !== 'open' && (p.type === 'task_done' || s(pay.status) === 'done')) {
      return { action: 'auto_ignore', reason: 'moot: the target task is already closed', classKey };
    }
    if (p.type === 'task_update' && targetTask.status === 'open' && isNoOpUpdate(pay, targetTask)) {
      return { action: 'auto_ignore', reason: 'no-op: asserts only what the register already says', classKey };
    }
  }

  // Learned thresholds — in BOTH directions they beat the defaults, so a
  // class the defaults would auto-apply stops auto-applying the moment Noa
  // starts rejecting it, and a class she keeps accepting (due-moves,
  // completions) earns auto-apply without anyone guessing.
  const st = stats.get(classKey);
  if (st && st.n >= MIN_CLASS_N) {
    if (st.accepted / st.n >= AUTO_APPLY_RATE) {
      if ((p.type === 'task_update' || p.type === 'task_done') && (!targetTask || targetTask.status !== 'open')) {
        return { action: 'review', reason: 'learned-accept class but the target task is not open', classKey };
      }
      return { action: 'auto_apply', reason: `learned: ${st.accepted}/${st.n} of this class accepted`, classKey };
    }
    if (st.negative / st.n >= AUTO_IGNORE_RATE) {
      return { action: 'auto_ignore', reason: `learned: ${st.negative}/${st.n} of this class rejected or ignored`, classKey };
    }
  }

  // Structural default: additive-only writes.
  if (p.type === 'task_update' && reasoningFamily(p.reasoning) === 'matched_id'
    && p.confidence >= 0.75 && p.target_task_id && targetTask && targetTask.status === 'open'
    && isSafeEnrichment(pay, targetTask)) {
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

// ── Rejected-pattern memory (learning at the source) ────────────────────────
// Titles the team explicitly rejected/ignored ride into the extract prompt
// as "do not re-assert" — the agent stops producing them at all, instead of
// the queue filtering them after the fact.

export async function loadRejectedPatterns(admin: SupabaseClient, limit = 15): Promise<string[]> {
  const { data } = await admin.from('agent_proposals')
    .select('title,decided_by,state')
    .in('state', ['rejected', 'ignored'])
    .not('decided_by', 'is', null)
    .order('decided_at', { ascending: false })
    .limit(60);
  const rows = (data ?? []) as { title: string | null; decided_by: string | null; state: string }[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    // Human rejections only — bulk agent ignores must not teach the
    // extractor to stop reporting real information.
    if (!r.decided_by || r.decided_by.startsWith('agent:')) continue;
    const t = (r.title ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
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
      .select('type,reasoning,state,decided_by,payload')
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
 * auto-appliable, ignore the provably-ignorable, leave the rest for humans.
 * Used both at ingest time (on the rows a document just produced) and by the
 * sweep over the existing backlog. Also collapses duplicates WITHIN the
 * batch: two pending rows asserting the same identity keep only the older.
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
    ? await admin.from('tasks').select('id,due,owner,priority,status,description,waiting_for').in('id', targetIds)
    : { data: [] };
  const targetById = new Map(((targets ?? []) as (TargetTask & { id: string })[]).map((t) => [t.id, t]));

  // Trust boundary for auto-APPLY. Proposals extracted from untrusted email
  // (forwarded / polled) may still be auto-IGNORED — dedup, no-ops and
  // learned-rejects only shrink the queue — but any auto_apply is downgraded to
  // human review, so injected email content can never silently write (close a
  // task, move a due date, commit a decision) even once a class has matured.
  // Proposals with no document_id (tests, manual entry) and trusted sources
  // (upload / sheets / zimas / manual) keep full auto-apply.
  const UNTRUSTED_SOURCES = new Set(['forward', 'gmail', 'outlook']);
  const docIds = [...new Set(proposals.map((p) => p.document_id).filter((x): x is string => !!x))];
  const sourceByDoc = new Map<string, string>();
  if (docIds.length) {
    const { data: docs } = await admin.from('documents').select('id,source').in('id', docIds);
    for (const d of (docs ?? []) as { id: string; source: string }[]) sourceByDoc.set(d.id, d.source);
  }
  const isUntrusted = (p: AgentProposal): boolean =>
    !!p.document_id && UNTRUSTED_SOURCES.has(sourceByDoc.get(p.document_id) ?? '');

  const ignore = async (p: AgentProposal, reason: string, classKey: string) => {
    await admin.from('agent_proposals').update({
      state: 'ignored',
      decided_by: TRIAGE_ACTOR,
      decided_at: new Date().toISOString(),
      result_note: reason,
    }).eq('id', p.id);
    await logActivity(admin, {
      entity_type: 'proposal', entity_id: p.id, actor: TRIAGE_ACTOR,
      action: 'auto_ignore', after: { class: classKey, reason },
    });
    summary.ignored++;
  };

  // Duplicate collapse (provable): same identity key as the ingest dedup
  // uses. Seeded with claims already accepted/auto-applied — a pending row
  // re-asserting a claim the team already took is settled, not open. The
  // batch itself arrives oldest-first from the sweep, so among pending twins
  // the older survives.
  const seenKeys = new Set<string>();
  const { data: settled } = await admin.from('agent_proposals')
    .select('type,project_id,target_task_id,payload')
    .in('state', ['accepted', 'auto_applied'])
    .order('decided_at', { ascending: false })
    .limit(500);
  for (const e of (settled ?? []) as ProposalIdentity[]) {
    const k = proposalKey(e);
    if (k) seenKeys.add(k);
  }

  for (const p of proposals) {
    if (p.state !== 'pending') { summary.kept++; continue; }

    const key = proposalKey(p as ProposalIdentity);
    if (key) {
      if (seenKeys.has(key)) {
        await ignore(p, 'duplicate of a claim already pending or already accepted (same identity)', proposalClass(p));
        continue;
      }
      seenKeys.add(key);
    }

    const target = p.target_task_id ? targetById.get(p.target_task_id) ?? null : null;
    const verdict = classifyProposal(p, target, stats);
    // Untrusted source: an auto_apply becomes review; auto_ignore still runs.
    if (verdict.action === 'auto_apply' && isUntrusted(p)) { summary.kept++; continue; }
    if (verdict.action === 'review') { summary.kept++; continue; }

    if (verdict.action === 'auto_apply') {
      if (p.type === 'task_create') {
        // A learned-accepted creation still needs a home: attribution is a
        // human act (or a learned rule applied at ingest) — never defaulted
        // to General here. Without a project the row waits for a person.
        if (!p.project_id) { summary.kept++; continue; }
        const pay = p.payload as Record<string, unknown>;
        const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
        const { data: created, error } = await admin.from('tasks').insert({
          project_id: p.project_id,
          document_id: p.document_id,
          title: str(pay.title) ?? str(p.title) ?? 'Untitled',
          description: str(pay.description),
          owner: str(pay.owner),
          waiting_for: str(pay.waiting_for),
          due: str(pay.due),
          stage_key: str(pay.stage_key),
          priority: pay.priority === 'critical' || pay.priority === 'high' ? pay.priority : 'normal',
          category: pay.category === 'admin' ? 'admin' : 'project',
          status: 'open',
          source: 'agent:auto-triage',
          last_touched: today,
        }).select('id').single();
        if (error || !created) {
          console.error('[auto-triage] create failed:', p.id, error?.message);
          summary.errors++;
          continue;
        }
        await logActivity(admin, {
          entity_type: 'task', entity_id: created.id, actor: TRIAGE_ACTOR,
          action: 'create', after: { proposal_id: p.id, reason: verdict.reason },
        });
      } else {
        const applied = await applyProposal(admin, p, TRIAGE_ACTOR, today, { agentApply: true });
        if ('error' in applied) {
          // Application failed (target vanished, match failed) — the row stays
          // pending; a human still sees it. Loud in the log, silent nowhere.
          console.error('[auto-triage] apply failed:', p.id, applied.error);
          summary.errors++;
          continue;
        }
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
      await ignore(p, verdict.reason, verdict.classKey);
    }
  }
  return summary;
}

/** The sweep entry point: rule pass over the whole pending backlog, with the
 *  before/after count so callers can report the reduction honestly. */
export interface FullTriageSummary extends TriageSummary {
  pendingBefore: number;
  pendingAfter: number;
}

export async function runFullTriage(
  admin: SupabaseClient,
  opts?: { today?: string },
): Promise<FullTriageSummary> {
  const fetchPending = async (): Promise<AgentProposal[]> => {
    const { data } = await admin.from('agent_proposals')
      .select('*').eq('state', 'pending')
      .order('created_at', { ascending: true }).limit(500);
    return (data ?? []) as AgentProposal[];
  };
  const before = await fetchPending();
  const pass = await runAutoTriage(admin, before, opts);
  const after = await fetchPending();
  return { ...pass, pendingBefore: before.length, pendingAfter: after.length };
}
