import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { runStructured, MODELS } from '../lib/claude.ts';
import { scoreTask, IMPACT_WEIGHT } from '../lib/priority.ts';
import { PrioritizeResultSchema, type PrioritizeResult } from './schemas.ts';
import type { Blocker, Project, Task } from '../lib/types.ts';

// Task-prioritization agent (My Work brief §3–4, Dor 2026-08-29): Claude
// proposes an order — per project AND across projects — and explains every
// placement in one grounded sentence. The output is a SUGGESTION layer:
// ranks live in task_priorities per run, Noa's manual pins always win at
// render time, and nothing here mutates a task.
//
// Ranking inputs the brief names: stage blocking, due dates, financial/legal
// risk, dependencies, waiting age, schedule impact, manual priority. The
// deterministic engine score rides along as a hint so the model starts from
// the same signal the rest of the app uses, then adjusts with what it can
// actually read (deadline semantics, who is waited on, money at stake).

const SYSTEM = `You prioritize the operational task list of Hilla Group, an LA hillside real-estate developer.
You receive every OPEN task (grouped by project) plus each project's phase, active blockers, and today's date.

Score every task 0-100 for "how urgent is it to act on this TODAY", assign an urgency tier, and give ONE short reason grounded in that task's own facts.

Ranking factors, in rough weight order:
1. HARD DEADLINES — permit/plan-check expirations, city appointment dates, payment due dates. Overdue or ≤7 days out dominates everything. A dated commitment inside the next 48 hours outranks ANY undated blocker, however severe — an undated blocker is still there the day after tomorrow; a missed filing fee is not. Among "now" items, earlier hard date first.
2. BLOCKS THE PROCESS — the task stops a phase/sub-stage from advancing (process_impact primary_blocker/workstream_blocker, or it feeds an active blocker's release).
3. FINANCIAL / LEGAL RISK — claims, disputed payments, expiring extensions, penalties, anything with a dollar amount and a counterparty.
4. UNBLOCKS OTHERS — completing it releases other listed tasks (dependencies).
5. WAITING AGE — waiting on an external party with an old follow-up date: chasing is due again.
6. STAGE FIT — work on the project's CURRENT phase outranks future-phase prep.

Tiers: "now" = act today, deadline-critical or blocking (top ~5-8 tasks overall). "high" = this week. "medium" = soon, nothing forces it. "low" = background/paperwork with no time pressure.

Rules:
- REASON: one tight sentence, concrete facts from the task itself ("PC extension expires 9/1 — filing appointment must precede it"), never generic filler ("this is important").
- Use the engine_score hint as a starting signal but override it when the text says otherwise — a task whose title carries a real date the engine can't parse should rank on that date.
- Administrative tasks (category=admin) rank on their own merits — an unpaid invoice blocking a consultant's deliverable can outrank project paperwork.
- Score EVERY task exactly once. Never invent ids, never skip one.
- Ties are fine; exact ordering is derived from scores downstream.`;

export interface PrioritizeContext {
  projects: Pick<Project, 'id' | 'name' | 'current_phase_key' | 'business_rank'>[];
  tasks: Task[];
  blockers: Pick<Blocker, 'project_id' | 'what' | 'blocked_by' | 'kind' | 'days_stuck'>[];
  today: string;
  /** Recent human pins — the correction signal the brief wants fed back. */
  pinned?: { title: string; manual_priority: number }[];
  client?: Anthropic;
}

function taskLine(t: Task, engineScore: number): string {
  const bits = [
    `[${t.id}]`,
    t.title,
    t.due ? `due ${t.due}` : null,
    t.follow_up_date ? `follow-up ${t.follow_up_date}` : null,
    t.waiting_for ? `waiting on ${t.waiting_for}` : null,
    t.owner ? `owner ${t.owner}` : null,
    t.process_impact ? `impact ${t.process_impact}` : null,
    t.priority !== 'normal' ? t.priority : null,
    t.category === 'admin' ? 'category=admin' : null,
    t.manual_priority != null ? `PINNED #${t.manual_priority}` : null,
    `engine_score ${engineScore}`,
  ].filter(Boolean);
  const desc = t.description ? ` :: ${t.description.slice(0, 160)}` : '';
  return `- ${bits.join(' · ')}${desc}`;
}

export async function prioritizeTasks(ctx: PrioritizeContext): Promise<PrioritizeResult> {
  const byProject = new Map<string | null, Task[]>();
  for (const t of ctx.tasks) {
    const list = byProject.get(t.project_id);
    if (list) list.push(t); else byProject.set(t.project_id, [t]);
  }
  const blocks = new Map<string, string[]>();
  for (const b of ctx.blockers) {
    const list = blocks.get(b.project_id) ?? [];
    list.push(`${b.what} (blocked by ${b.blocked_by}, ${b.days_stuck}d, ${b.kind})`);
    blocks.set(b.project_id, list);
  }

  const sections: string[] = [];
  for (const p of ctx.projects) {
    const tasks = byProject.get(p.id) ?? [];
    if (!tasks.length) continue;
    const head = `PROJECT: ${p.name} — phase ${p.current_phase_key ?? 'unknown'}${p.business_rank != null ? `, standing business rank ${p.business_rank}` : ''}`;
    const bl = blocks.get(p.id)?.length ? `ACTIVE BLOCKERS:\n${blocks.get(p.id)!.map((x) => `  - ${x}`).join('\n')}\n` : '';
    sections.push(`${head}\n${bl}TASKS:\n${tasks.map((t) => taskLine(t, scoreTask(t, { today: ctx.today }) + (t.process_impact ? IMPACT_WEIGHT[t.process_impact] : 0))).join('\n')}`);
  }
  const general = byProject.get(null) ?? [];
  if (general.length) {
    sections.push(`GENERAL (no project):\nTASKS:\n${general.map((t) => taskLine(t, scoreTask(t, { today: ctx.today }))).join('\n')}`);
  }
  const pins = (ctx.pinned ?? []).length
    ? `\nHUMAN CORRECTIONS (Noa pinned these to the top recently — treat similar work as important):\n${ctx.pinned!.map((p) => `- #${p.manual_priority} ${p.title}`).join('\n')}\n`
    : '';

  return runStructured({
    job: 'digest',
    system: SYSTEM,
    messages: [{ role: 'user', content: `TODAY: ${ctx.today}\n${pins}\n${sections.join('\n\n')}` }],
    schema: PrioritizeResultSchema,
    toolName: 'report_priorities',
    toolDescription: 'Report the urgency score, tier and reason for every open task.',
    maxTokens: 24000,
    client: ctx.client,
  });
}

export interface PrioritizeRunSummary {
  run_id: string;
  ranked: number;
  /** Ids the model skipped (kept out of the run) and ids it invented (dropped). */
  missing: number;
  unknown: number;
}

/** Deterministic rank derivation + persistence: scores → global_rank and
 *  per-project project_rank. Ties break by due date (earlier first), then
 *  engine score, then id — stable across reruns of the same scores. */
export async function applyPrioritization(
  admin: SupabaseClient,
  result: PrioritizeResult,
  ctx: { tasks: Task[]; today: string },
): Promise<PrioritizeRunSummary | { error: string }> {
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const scored = result.tasks.filter((r) => {
    if (!taskById.has(r.id) || seen.has(r.id)) return false; // hallucinated or duplicated id
    seen.add(r.id);
    return true;
  });
  const unknown = result.tasks.length - scored.length;
  const missing = ctx.tasks.length - scored.length;

  const engine = (id: string) => {
    const t = taskById.get(id)!;
    return scoreTask(t, { today: ctx.today }) + (t.process_impact ? IMPACT_WEIGHT[t.process_impact] : 0);
  };
  const ordered = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = taskById.get(a.id)!.due ?? '9999-12-31';
    const db = taskById.get(b.id)!.due ?? '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const ea = engine(a.id); const eb = engine(b.id);
    if (eb !== ea) return eb - ea;
    return a.id < b.id ? -1 : 1;
  });

  const { data: run, error: runErr } = await admin.from('priority_runs')
    .insert({ model: MODELS.digest, scope: 'all', note: `${ordered.length} tasks ranked` })
    .select('id').single();
  if (runErr || !run) return { error: `priority run insert failed: ${runErr?.message}` };

  const projectCounters = new Map<string, number>();
  const rows = ordered.map((r, i) => {
    const t = taskById.get(r.id)!;
    const pKey = t.project_id ?? '∅';
    const pRank = (projectCounters.get(pKey) ?? 0) + 1;
    projectCounters.set(pKey, pRank);
    return {
      run_id: run.id as string,
      task_id: r.id,
      project_id: t.project_id,
      global_rank: i + 1,
      project_rank: pRank,
      score: Math.round(r.score),
      urgency: r.urgency,
      reason: r.reason.slice(0, 300),
    };
  });
  if (rows.length) {
    const { error } = await admin.from('task_priorities').insert(rows);
    if (error) return { error: `task_priorities insert failed: ${error.message}` };
  }
  return { run_id: run.id as string, ranked: rows.length, missing, unknown };
}

/** Full run: fetch → agent → persist. Shared by the My Work refresh action
 *  and the daily digest cron. */
export async function runPrioritization(
  admin: SupabaseClient,
  today: string,
  client?: Anthropic,
): Promise<PrioritizeRunSummary | { error: string }> {
  const [tasksQ, projectsQ, blockersQ, pinsQ] = await Promise.all([
    admin.from('tasks').select('*').eq('status', 'open'),
    admin.from('projects').select('id,name,current_phase_key,business_rank'),
    admin.from('blockers').select('project_id,what,blocked_by,kind,days_stuck').eq('status', 'active'),
    // The correction signal: her current explicit pins ride into the prompt.
    admin.from('tasks').select('title,manual_priority').not('manual_priority', 'is', null)
      .eq('status', 'open').order('manual_priority', { ascending: true }).limit(10),
  ]);
  const tasks = (tasksQ.data ?? []) as Task[];
  if (!tasks.length) return { error: 'no open tasks to rank' };
  const result = await prioritizeTasks({
    projects: (projectsQ.data ?? []) as PrioritizeContext['projects'],
    tasks,
    blockers: (blockersQ.data ?? []) as PrioritizeContext['blockers'],
    today,
    pinned: (pinsQ.data ?? []) as { title: string; manual_priority: number }[],
    client,
  });
  return applyPrioritization(admin, result, { tasks, today });
}
