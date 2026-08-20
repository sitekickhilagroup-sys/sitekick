import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { runStructured } from '../lib/claude.ts';
import { matchExistingTask } from '../lib/dedup.ts';
import type { Project, Task } from '../lib/types.ts';
import { ExtractResultSchema, type ExtractResult } from './schemas.ts';

const SYSTEM = `You are the operations chief-of-staff for Hilla Group, an LA real-estate developer.
You read one communication (email or meeting transcript) and extract operational state.

Rules:
- Identify which project this concerns from the provided project list. null if none matches.
- Extract tasks: concrete work items with owner and due date when stated.
- CRITICAL dedup rule: the prompt lists the project's OPEN TASKS with ids. If a communication
  refers to work that matches an existing open task (same work, possibly reworded, updated
  status/date/owner), emit op="update" with that existing_id instead of op="create".
  A meeting summary usually UPDATES existing tasks rather than creating duplicates.
- Mark a task done via op="update" + status="done" when the communication says it happened.
- planned=false marks unplanned/reactive work (Hebrew: balatam).
- Extract blockers: something stuck, who/what blocks it, downstream impact.
- Extract decisions actually made (not proposals).
- Draft escalation emails only when a blocker clearly needs one; keep them short and factual.
- vendor_hours: when a vendor states hour estimates or hours worked, capture them.
- deadline_updates: when a date for known work changed, record task_match (title words), new_due (YYYY-MM-DD), evidence (quote).
- Dates: YYYY-MM-DD. Never invent facts not in the text.`;

export interface ExtractContext {
  projects: Pick<Project, 'id' | 'name'>[];
  openTasks: Task[];
  client?: Anthropic;
}

export async function extractComms(
  doc: { id: string; project_hint?: string | null; raw_text: string },
  ctx: ExtractContext,
): Promise<ExtractResult> {
  const projectList = ctx.projects.map((p) => `- ${p.name}`).join('\n');
  const taskList = ctx.openTasks
    .map((t) => `- [${t.id}] (${t.project_id}) ${t.title}${t.waiting_for ? ` — waiting: ${t.waiting_for}` : ''}${t.due ? ` — due ${t.due}` : ''}`)
    .join('\n');

  return runStructured({
    job: 'extract',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `PROJECTS:\n${projectList}\n\nOPEN TASKS (id, project_id, title):\n${taskList || '(none)'}\n\n${doc.project_hint ? `PROJECT HINT: ${doc.project_hint}\n\n` : ''}COMMUNICATION:\n${doc.raw_text}`,
    }],
    schema: ExtractResultSchema,
    toolName: 'report_extraction',
    toolDescription: 'Report the extracted operational state from this communication.',
    client: ctx.client,
  });
}

export interface ApplySummary {
  project_id: string | null;
  tasks_created: number;
  tasks_updated: number;
  blockers: number;
  decisions: number;
  drafts: number;
  vendor_hours: number;
  deadline_updates: number;
}

// Server-side reconciliation: even if the model said "create", a strong match
// against an existing open task becomes an update (belt and braces, item 1).
export async function applyExtractResult(
  admin: SupabaseClient,
  docId: string,
  result: ExtractResult,
  ctx: { projects: Pick<Project, 'id' | 'name'>[]; openTasks: Task[]; today?: string },
): Promise<ApplySummary> {
  const project = result.project_name
    ? ctx.projects.find((p) => p.name === result.project_name) ?? null
    : null;
  const summary: ApplySummary = {
    project_id: project?.id ?? null,
    tasks_created: 0, tasks_updated: 0, blockers: 0, decisions: 0,
    drafts: 0, vendor_hours: 0, deadline_updates: 0,
  };
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  if (!project) return summary;

  const blockerIds: string[] = [];

  for (const op of result.tasks) {
    let existingId = op.op === 'update' ? op.existing_id ?? null : null;
    if (!existingId) {
      const match = matchExistingTask(
        { title: op.title, project_id: project.id, stage_key: op.stage_key ?? null },
        ctx.openTasks,
      );
      if (match) existingId = match.id;
    }
    if (existingId) {
      const patch: Record<string, unknown> = { last_touched: today, document_id: docId };
      if (op.description) patch.description = op.description;
      if (op.owner) patch.owner = op.owner;
      if (op.waiting_for !== undefined) patch.waiting_for = op.waiting_for || null;
      if (op.due) patch.due = op.due;
      if (op.status) patch.status = op.status;
      if (op.follow_up_date) patch.follow_up_date = op.follow_up_date;
      if (op.priority) patch.priority = op.priority;
      await admin.from('tasks').update(patch).eq('id', existingId);
      summary.tasks_updated++;
    } else {
      await admin.from('tasks').insert({
        project_id: project.id,
        document_id: docId,
        title: op.title,
        description: op.description ?? null,
        owner: op.owner ?? null,
        waiting_for: op.waiting_for ?? null,
        due: op.due ?? null,
        stage_key: op.stage_key ?? null,
        priority: op.priority ?? 'normal',
        status: op.status ?? 'open',
        planned: op.planned ?? true,
        follow_up_date: op.follow_up_date ?? null,
        source: 'extract-comms',
      });
      summary.tasks_created++;
    }
  }

  for (const b of result.blockers) {
    const { data } = await admin.from('blockers').insert({
      project_id: project.id,
      document_id: docId,
      what: b.what,
      blocked_by: b.blocked_by,
      days_at_risk: b.days_at_risk ?? 0,
      downstream: b.downstream ?? [],
      suggested_action: b.suggested_action ?? null,
    }).select('id').single();
    blockerIds.push(data?.id ?? '');
    summary.blockers++;
  }

  for (const d of result.decisions) {
    await admin.from('decisions').insert({
      project_id: project.id,
      title: d.title,
      detail: d.detail ?? null,
      decided_at: d.decided_at ?? today,
    });
    summary.decisions++;
  }

  for (const dr of result.drafts) {
    await admin.from('drafts').insert({
      blocker_id: dr.re_blocker_index !== undefined ? blockerIds[dr.re_blocker_index] ?? null : null,
      to_email: dr.to_email ?? null,
      subject: dr.subject,
      body: dr.body,
      status: 'proposed',
    });
    summary.drafts++;
  }

  for (const vh of result.vendor_hours) {
    const { data: vendor } = await admin.from('vendors')
      .upsert({ name: vh.vendor_name }, { onConflict: 'name' })
      .select('id').single();
    if (vendor) {
      await admin.from('vendor_hours').insert({
        vendor_id: vendor.id,
        project_id: project.id,
        document_id: docId,
        hours: vh.hours,
        rate: vh.rate ?? null,
        period: vh.period ?? null,
        note: vh.note ?? null,
      });
      summary.vendor_hours++;
    }
  }

  for (const du of result.deadline_updates) {
    const match = matchExistingTask(
      { title: du.task_match, project_id: project.id },
      ctx.openTasks,
    );
    if (match) {
      await admin.from('tasks').update({ due: du.new_due, last_touched: today }).eq('id', match.id);
      summary.deadline_updates++;
    }
  }

  await admin.from('documents').update({
    processed_at: new Date().toISOString(),
    project_id: project.id,
  }).eq('id', docId);

  return summary;
}
