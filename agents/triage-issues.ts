import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { runStructured } from '../lib/claude.ts';

// Twice-daily automated pass over "Report a problem" notes (the Notes
// Assistant's 4th intent, 0028). Rotem's explicit ask: he wants a
// prioritized, plain-language backlog he can read on demand — not raw notes,
// and not something that decides anything on its own. This agent ONLY
// classifies (time estimate + significance); nothing here writes code,
// deploys, or changes a business record. See app/api/cron/triage-issues.

const SYSTEM = `You triage bug reports for SiteKick, an internal real-estate operations tool used
daily by one project manager (Noa) at Hilla Group. Each item below is a short note she wrote when
something in the app itself was broken or behaved wrong — not a fact about her real-estate deals.

For each item, estimate:
- time_estimate: a short, honest string a developer would actually believe — "15 min", "1-2 hours",
  "half a day", "unclear without investigating". Never invent false precision for something you
  cannot size from the text alone; "unclear without investigating" is a legitimate answer.
- significance: how much this actually costs Noa if it stays broken.
  - critical: blocks a core daily action entirely (she cannot save/complete/undo something she needs).
  - high: works around it exists, but it is a real, frequent daily friction or a data-trust risk.
  - medium: a real bug, but occasional or has an easy workaround.
  - low: cosmetic, rare, or barely affects her actual work.
- one_line_summary: a plain restatement of what's broken, in her own terms, not app jargon — a
  developer picking this up should understand the problem without reading her original note twice.

Ground every estimate in what the note ACTUALLY says. Never assume the cause of a bug you cannot
see the code for — "unclear without investigating" is honest; a confident-sounding guess is not.`;

const IssueTriageSchema = z.object({
  id: z.string().min(1),
  time_estimate: z.string().min(1),
  significance: z.enum(['low', 'medium', 'high', 'critical']),
  one_line_summary: z.string().min(1),
});

const TriageResultSchema = z.object({
  items: z.array(IssueTriageSchema),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

export interface IssueToTriage {
  id: string;
  body: string;
  entityLabel: string | null;
  createdAt: string;
}

export async function triageIssues(
  issues: IssueToTriage[],
  client?: Anthropic,
): Promise<TriageResult> {
  const lines = issues
    .map((i) => `- [${i.id}] (reported ${i.createdAt.slice(0, 10)}${i.entityLabel ? `, re: ${i.entityLabel}` : ''}) ${i.body.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  return runStructured({
    job: 'triage',
    system: SYSTEM,
    messages: [{ role: 'user', content: `PROBLEM REPORTS:\n${lines}` }],
    schema: TriageResultSchema,
    toolName: 'report_triage',
    toolDescription: 'Report a time estimate, significance, and one-line summary for each problem report.',
    client,
  });
}

export interface TriageRunSummary {
  triaged: number;
  skipped_no_pending: boolean;
}

/** Full pass: load untriaged issue reports, classify them, write the result
 *  back onto each comment row, mark them triaged_at so the next run only
 *  picks up genuinely new reports. Never touches anything but `comments`. */
export async function runIssueTriage(
  admin: SupabaseClient,
  client?: Anthropic,
): Promise<TriageRunSummary | { error: string }> {
  const { data, error } = await admin
    .from('comments')
    .select('id, body, entity_type, entity_id, created_at')
    .eq('intent', 'issue')
    .eq('is_test', false)
    .eq('status', 'active')
    .is('triaged_at', null)
    .order('created_at', { ascending: true })
    .limit(40);
  if (error) return { error: error.message };
  const pending = (data ?? []) as { id: string; body: string; entity_type: string; entity_id: string | null; created_at: string }[];
  if (!pending.length) return { triaged: 0, skipped_no_pending: true };

  const toTriage: IssueToTriage[] = pending.map((c) => ({
    id: c.id,
    body: c.body,
    entityLabel: c.entity_type !== 'general' ? `${c.entity_type} ${c.entity_id ?? ''}`.trim() : null,
    createdAt: c.created_at,
  }));
  const result = await triageIssues(toTriage, client);
  const byId = new Map(result.items.map((r) => [r.id, r]));
  const now = new Date().toISOString();
  let triaged = 0;
  for (const c of pending) {
    const r = byId.get(c.id);
    // A hallucinated/missing id must not silently skip triage forever —
    // mark it triaged with a safe fallback rather than looping on it every
    // run with no progress.
    const patch = r
      ? { time_estimate: r.time_estimate, significance: r.significance, triaged_at: now }
      : { time_estimate: 'unclear without investigating', significance: 'medium' as const, triaged_at: now };
    const { error: updErr } = await admin.from('comments').update(patch).eq('id', c.id);
    if (!updErr) triaged++;
  }
  return { triaged, skipped_no_pending: false };
}
