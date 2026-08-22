'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { laToday } from '@/lib/date';
import { logActivity } from '@/lib/state-writer';
import { tokenize } from '@/lib/dedup';
import { runStructured } from '@/lib/claude';
import type { Project, Task } from '@/lib/types';

const MIN = 12;
const MAX = 10000;
/** Below this the text is not about any known task. */
const PROPOSE_AT = 24;
/** Above this the text is clearly about one task, so evidence can attach itself. */
const AUTO_AT = 70;

export type PasteResult =
  | { kind: 'auto'; taskTitle: string }
  | { kind: 'match'; score: number; taskTitle: string }
  | { kind: 'new'; title: string }
  | { error: 'short' | 'long' | 'no_project' | 'multi_project' | 'save'; detail?: string };

const ReadingSchema = z.object({
  title: z.string().describe('The action this update is about, as a short imperative task title'),
  owner: z.string().nullable().describe('Person responsible, if the text names one'),
  due: z.string().nullable().describe('Due date as YYYY-MM-DD, only if the text states one'),
  completion: z.boolean().describe('True only if the text says the work is finished'),
  summary: z.string().describe('One sentence a project manager would keep as the latest update'),
});
type Reading = z.infer<typeof ReadingSchema>;

/** Containment score in percent — how much of the shorter side is shared. */
function overlap(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return 0;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return Math.round((shared / small.size) * 100);
}

/** Address-style names match on their number as reliably as on their words. */
function projectTerms(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
    .filter((w) => (/^\d{3,}$/.test(w) || w.length > 3) && !['drive', 'road', 'street', 'place'].includes(w));
}

async function read(text: string): Promise<Reading | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    return await runStructured({
      job: 'extract',
      system: 'You read one project update written by a construction project manager and report what it is about. '
        + 'Report only what the text states. Never invent a date, an owner or a completion. '
        + 'Keep the title under 12 words and the summary to one sentence.',
      messages: [{ role: 'user', content: text }],
      schema: ReadingSchema,
      toolName: 'report_update',
    });
  } catch {
    // The deterministic path below still works without the model.
    return null;
  }
}

/**
 * Paste one project update → one canonical outcome.
 *
 * Strong evidence for an existing task attaches itself and says so. Anything
 * weaker becomes a proposal that names the task it may duplicate, and waits in
 * the Review Inbox. Nothing here creates a task on its own.
 */
export async function processPastedUpdate(text: string): Promise<PasteResult> {
  const user = await requireUser();
  const body = (text ?? '').trim();
  if (body.length < MIN) return { error: 'short' };
  if (body.length > MAX) return { error: 'long' };

  const admin = supabaseAdmin();
  const today = laToday();
  const { data: projectRows } = await admin.from('projects').select('*');
  const projects = (projectRows ?? []) as Project[];
  const lower = body.toLowerCase();

  const hits = projects
    .map((p) => ({ project: p, score: projectTerms(p.name).filter((term) => lower.includes(term)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!hits.length) return { error: 'no_project' };
  if (hits.length > 1 && hits[0].score === hits[1].score) {
    return {
      error: 'multi_project',
      detail: hits.filter((h) => h.score === hits[0].score).map((h) => h.project.name).join(', '),
    };
  }
  const project = hits[0].project;

  const reading = await read(body);
  const { data: taskRows } = await admin.from('tasks').select('*').eq('project_id', project.id).eq('status', 'open');
  const openTasks = (taskRows ?? []) as Task[];

  const needle = tokenize(reading?.title ? `${reading.title} ${body}` : body);
  const ranked = openTasks
    .map((task) => ({ task, score: overlap(needle, tokenize(`${task.title} ${task.description ?? ''}`)) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] ?? null;
  const completion = reading?.completion
    ?? /\b(done|completed|finished|already checked|confirmed complete|signed off)\b/i.test(body);
  const excerpt = body.length > 180 ? `${body.slice(0, 177)}…` : body;
  const summary = reading?.summary ?? excerpt;

  const { data: doc } = await admin.from('documents').insert({
    project_id: project.id,
    kind: 'other',
    source: 'manual',
    raw_text: body,
    processed_at: new Date().toISOString(),
  }).select('id').single();
  const documentId = (doc?.id as string | undefined) ?? null;

  // Strong, non-final evidence is safe to attach: it changes what we know
  // about the task, not whether the task is done.
  if (best && best.score >= AUTO_AT && !completion) {
    const { data: before } = await admin.from('tasks').select('*').eq('id', best.task.id).maybeSingle();
    const { error } = await admin.from('tasks')
      .update({ description: summary, source: 'pasted update', document_id: documentId, last_touched: today })
      .eq('id', best.task.id);
    if (error) return { error: 'save', detail: error.message };
    await logActivity(admin, {
      entity_type: 'task', entity_id: best.task.id, actor: user.email ?? user.id,
      action: 'auto_evidence', before, after: { description: summary, score: best.score },
    });
    revalidatePath('/'); revalidatePath('/work'); revalidatePath('/upload');
    return { kind: 'auto', taskTitle: best.task.title };
  }

  const matched = best && best.score >= PROPOSE_AT ? best : null;
  const title = matched
    ? `Update: ${matched.task.title}`
    : (reading?.title ?? body.split(/[.!?\n]/)[0].slice(0, 120));

  const { error: pErr } = await admin.from('agent_proposals').insert({
    document_id: documentId,
    project_id: project.id,
    type: matched ? (completion ? 'task_done' : 'task_update') : 'task_create',
    payload: {
      title,
      owner: reading?.owner ?? null,
      due: reading?.due ?? null,
      stage_key: matched?.task.stage_key ?? null,
      summary,
    },
    target_task_id: matched?.task.id ?? null,
    confidence: matched ? Math.min(0.95, matched.score / 100) : 0.4,
    reasoning: matched
      ? `Pasted update shares ${matched.score}% of its wording with an open task in ${project.name}.`
      : `No open task in ${project.name} shared enough wording, so this is proposed as new work.`,
    evidence_excerpt: excerpt,
    title,
    change_type: matched ? (completion ? 'complete_existing' : 'update_existing') : 'new_task',
    result_note: summary,
    match_score: matched?.score ?? 0,
    match_reason: matched
      ? `Matched on project and shared task wording (${matched.score}%). A human decides before any state changes.`
      : 'No canonical action shared enough wording. Sitekick will not create a task without review.',
  });
  if (pErr) return { error: 'save', detail: pErr.message };

  revalidatePath('/inbox'); revalidatePath('/upload'); revalidatePath('/work');
  return matched
    ? { kind: 'match', score: matched.score, taskTitle: matched.task.title }
    : { kind: 'new', title };
}
