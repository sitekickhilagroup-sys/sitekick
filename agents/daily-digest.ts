import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { runStructured } from '../lib/claude.ts';
import { followUpAlerts, topActions } from '../lib/priority.ts';
import type { Action, Blocker, Invoice, Project, ProjectStage, Relationship, Task } from '../lib/types.ts';

const DigestSchema = z.object({ body_md: z.string().min(1) });

const SYSTEM = `You write the 07:00 LA morning digest for Hilla Group's development operations.
Audience: the founders. Tone: factual, terse, no fluff. Markdown.
Sections in order:
## Top actions today  (numbered, from the provided ranked list — do not reorder)
## What's stuck       (active blockers: what, on whom, days stuck, downstream)
## Follow-ups due     (tasks whose follow-up/check-back date arrived)
## Stage notes        (projects at risk or with slip days)
## Money waiting on Rowan  (invoices in for_rowan_approval, with totals)
Skip a section entirely when it has no items. Never invent data.
STYLE: one line per item, up to ~30 words when the detail earns it. No intro, no outro, no commentary — just the facts.`;

export async function buildDigest(
  admin: SupabaseClient,
  forDate: string,
  client?: Anthropic,
): Promise<{ body_md: string; top_actions: Action[] }> {
  const [projectsQ, stagesQ, tasksQ, blockersQ, invoicesQ, relationshipsQ, profilesQ] = await Promise.all([
    admin.from('projects').select('*'),
    admin.from('project_stages').select('*'),
    admin.from('tasks').select('*').eq('status', 'open'),
    admin.from('blockers').select('*').eq('status', 'active'),
    admin.from('invoices').select('*').eq('status', 'for_rowan_approval'),
    admin.from('relationships').select('*').eq('type', 'blocks'),
    admin.from('profiles').select('display_name'),
  ]);
  const projects = (projectsQ.data ?? []) as Project[];
  const stages = (stagesQ.data ?? []) as ProjectStage[];
  const tasks = (tasksQ.data ?? []) as Task[];
  const blockers = (blockersQ.data ?? []) as Blocker[];
  const rowanInvoices = (invoicesQ.data ?? []) as Invoice[];
  const relationships = (relationshipsQ.data ?? []) as Relationship[];

  const stagesByProject = new Map<string, ProjectStage[]>();
  for (const s of stages) {
    const list = stagesByProject.get(s.project_id) ?? [];
    list.push(s);
    stagesByProject.set(s.project_id, list);
  }
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const actions = topActions(tasks, blockers, stagesByProject, names, { today: forDate, limit: 8 }, relationships);
  const followUps = followUpAlerts(tasks, forDate);
  const atRisk = stages.filter((s) => s.risk && s.slip_days > 0);
  const rowanTotal = rowanInvoices.reduce((sum, i) => sum + Number(i.amount_usd), 0);

  const payload = {
    date: forDate,
    top_actions: actions,
    blockers: blockers.map((b) => ({
      project: names.get(b.project_id), what: b.what, blocked_by: b.blocked_by,
      days_stuck: b.days_stuck, downstream: b.downstream, suggested: b.suggested_action,
    })),
    follow_ups: followUps.map((t) => ({
      project: t.project_id ? names.get(t.project_id) : 'All', title: t.title, owner: t.owner,
      follow_up_date: t.follow_up_date ?? t.check_back_on, description: t.description,
    })),
    stage_notes: atRisk.map((s) => ({
      project: names.get(s.project_id), stage: s.label, slip_days: s.slip_days, substage: s.substage,
    })),
    rowan_queue: {
      count: rowanInvoices.length,
      total_usd: rowanTotal,
      items: rowanInvoices.map((i) => ({ number: i.number, amount: Number(i.amount_usd), entity: i.entity })),
    },
  };

  // Profile display names (0020): the digest addresses the people who set
  // one, instead of a nameless "the founders".
  const audience = ((profilesQ.data ?? []) as { display_name: string | null }[])
    .map((p) => p.display_name).filter((n): n is string => !!n);
  const audienceLine = audience.length ? `AUDIENCE: written for ${audience.join(', ')}.\n` : '';

  const { body_md } = await runStructured({
    job: 'digest',
    system: SYSTEM,
    messages: [{ role: 'user', content: `${audienceLine}DATA:\n${JSON.stringify(payload, null, 1)}` }],
    schema: DigestSchema,
    toolName: 'report_digest',
    toolDescription: 'Report the digest markdown.',
    client,
  });

  await admin.from('digests').upsert(
    { for_date: forDate, body_md, top_actions: actions },
    { onConflict: 'for_date' },
  );

  return { body_md, top_actions: actions };
}
