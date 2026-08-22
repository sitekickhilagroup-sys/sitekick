// The only module that commits agent proposals (client handoff: "one service writes").
import type { SupabaseClient } from '@supabase/supabase-js';
import { matchExistingTask } from './dedup.ts';
import type { AgentProposal, Task } from './types.ts';

/** Returns the audit row id, which is what Undo needs to restore the snapshot. */
export async function logActivity(
  admin: SupabaseClient,
  entry: { entity_type: string; entity_id: string; actor: string; action: string; before?: unknown; after?: unknown },
): Promise<string | null> {
  const { data } = await admin.from('activity_log').insert({
    entity_type: entry.entity_type, entity_id: entry.entity_id,
    actor: entry.actor, action: entry.action,
    before_json: entry.before ?? null, after_json: entry.after ?? null,
  }).select('id').single();
  return (data?.id as string | undefined) ?? null;
}

export async function applyProposal(
  admin: SupabaseClient,
  p: AgentProposal,
  actor: string,
  today: string,
): Promise<{ ok: true } | { error: string }> {
  const pay = p.payload as Record<string, unknown>;
  if (p.type === 'task_update' || p.type === 'task_done') {
    if (!p.target_task_id) return { error: 'proposal has no target task' };
    const patch: Record<string, unknown> = { last_touched: today, document_id: p.document_id };
    for (const k of ['description', 'owner', 'due', 'follow_up_date', 'priority', 'status'] as const) {
      if (pay[k] !== undefined && pay[k] !== null) patch[k] = pay[k];
    }
    if (pay.waiting_for !== undefined) patch.waiting_for = (pay.waiting_for as string) || null;
    const { data: before } = await admin.from('tasks').select('*').eq('id', p.target_task_id).maybeSingle();
    const { error } = await admin.from('tasks').update(patch).eq('id', p.target_task_id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'task', entity_id: p.target_task_id, actor, action: `accept:${p.type}`, before, after: patch });
    return { ok: true };
  }
  if (p.type === 'blocker_create') {
    const { data, error } = await admin.from('blockers').insert({
      project_id: p.project_id, document_id: p.document_id,
      what: pay.what, blocked_by: pay.blocked_by,
      days_at_risk: pay.days_at_risk ?? 0, downstream: pay.downstream ?? [],
      suggested_action: pay.suggested_action ?? null,
    }).select('id').single();
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'blocker', entity_id: data.id, actor, action: 'accept:blocker_create', after: pay });
    return { ok: true };
  }
  if (p.type === 'decision_create') {
    const { data, error } = await admin.from('decisions').insert({
      project_id: p.project_id, title: pay.title, detail: pay.detail ?? null,
      decided_at: (pay.decided_at as string | undefined) ?? today,
    }).select('id').single();
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'decision', entity_id: data.id, actor, action: 'accept:decision_create', after: pay });
    return { ok: true };
  }
  if (p.type === 'deadline_update') {
    const { data: open } = await admin.from('tasks').select('*').eq('status', 'open').eq('project_id', p.project_id!);
    const match = matchExistingTask(
      { title: pay.task_match as string, project_id: p.project_id! },
      (open ?? []) as Task[],
    );
    if (!match) return { error: 'no matching open task' };
    const { error } = await admin.from('tasks').update({ due: pay.new_due, last_touched: today }).eq('id', match.id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'task', entity_id: match.id, actor, action: 'accept:deadline_update', after: { due: pay.new_due } });
    return { ok: true };
  }
  if (p.type === 'relationship_create') {
    const { data: open } = await admin.from('tasks').select('*').eq('status', 'open').eq('project_id', p.project_id!);
    const openTasks = (open ?? []) as Task[];
    const from = matchExistingTask({ title: pay.from_match as string, project_id: p.project_id! }, openTasks);
    const to = matchExistingTask({ title: pay.to_match as string, project_id: p.project_id! }, openTasks);
    if (!from || !to) return { error: 'could not match both tasks' };
    const { data, error } = await admin.from('relationships').upsert({
      project_id: p.project_id,
      from_task_id: from.id,
      to_task_id: to.id,
      type: pay.type,
      reason: pay.reason ?? null,
      confidence: p.confidence,
      evidence_document_id: p.document_id,
      verified_by: actor,
      verified_at: new Date().toISOString(),
    }, { onConflict: 'from_task_id,to_task_id' }).select('id').single();
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'relationship', entity_id: data.id, actor, action: 'accept:relationship_create', after: pay });
    return { ok: true };
  }
  if (p.type === 'phase_set') {
    if (!p.project_id) return { error: 'proposal has no project' };
    const { error } = await admin.from('projects').update({ current_phase_key: pay.phase_key }).eq('id', p.project_id);
    if (error) return { error: error.message };
    await logActivity(admin, { entity_type: 'project', entity_id: p.project_id, actor, action: 'accept:phase_set', after: pay });
    return { ok: true };
  }
  return { error: `unknown proposal type ${p.type}` };
}
