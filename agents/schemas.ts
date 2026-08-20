import { z } from 'zod';

// extract-comms output contract (forced-tool JSON).
// op=update requires existing_id (an open task the model matched).

export const TaskOpSchema = z.object({
  op: z.enum(['create', 'update']),
  existing_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  owner: z.string().optional(),
  waiting_for: z.string().optional(),
  due: z.string().optional(),
  stage_key: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal']).default('normal'),
  planned: z.boolean().optional(),
  follow_up_date: z.string().optional(),
  status: z.enum(['open', 'done']).optional(),
});

export const BlockerOutSchema = z.object({
  what: z.string().min(1),
  blocked_by: z.string().min(1),
  days_at_risk: z.number().optional(),
  downstream: z.array(z.string()).optional(),
  suggested_action: z.string().optional(),
});

export const DecisionOutSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  decided_at: z.string().optional(),
});

export const DraftOutSchema = z.object({
  to_email: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  re_blocker_index: z.number().optional(),
});

export const VendorHoursOutSchema = z.object({
  vendor_name: z.string().min(1),
  hours: z.number(),
  rate: z.number().optional(),
  period: z.string().optional(),
  note: z.string().optional(),
});

export const DeadlineUpdateSchema = z.object({
  task_match: z.string().min(1),
  new_due: z.string(),
  evidence: z.string(),
});

export const ExtractResultSchema = z.object({
  project_name: z.string().nullable(),
  tasks: z.array(TaskOpSchema),
  blockers: z.array(BlockerOutSchema),
  decisions: z.array(DecisionOutSchema),
  drafts: z.array(DraftOutSchema),
  vendor_hours: z.array(VendorHoursOutSchema),
  deadline_updates: z.array(DeadlineUpdateSchema),
});

export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type TaskOp = z.infer<typeof TaskOpSchema>;

export const InvoiceParseSchema = z.object({
  vendor_name: z.string().min(1),
  project_name: z.string().nullable(),
  number: z.string().nullable(),
  amount_usd: z.number(),
  invoice_date: z.string().optional(),
  received_date: z.string().optional(),
  note: z.string().optional(),
});

export type InvoiceParse = z.infer<typeof InvoiceParseSchema>;
