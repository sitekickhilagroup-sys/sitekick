import { z } from 'zod';

// extract-comms output contract (forced-tool JSON).
// op=update requires existing_id (an open task the model matched).

// The five canonical lifecycle phases (matches substage_templates.phase_key
// and projects.current_phase_key). The agent may only speak this vocabulary —
// tasks.stage_key historically accumulated 12 dialects ('entitlements',
// 'Legal', …) precisely because nothing constrained it.
export const PHASE_KEYS = ['planning', 'plan_check', 'bidding', 'financing', 'construction'] as const;
const PhaseKey = z.enum(PHASE_KEYS);

export const TaskOpSchema = z.object({
  op: z.enum(['create', 'update']),
  existing_id: z.string().optional(),
  // Per-item attribution (multi-project communications — the Aug 24 meeting
  // summary covered four projects and the old document-level project_name
  // silently discarded all of it). Exact name from the project list, or null.
  project_name: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().optional(),
  owner: z.string().optional(),
  waiting_for: z.string().optional(),
  due: z.string().optional(),
  // Required-nullable like project_name: on a 47K-char bundle the model
  // skipped every optional stage_key; forcing the field forces the choice.
  stage_key: PhaseKey.nullable(),
  // Brief §2 (2026-08-29): administrative work (invoices, payroll, bank/mail
  // access, bookkeeping, legal-ops) is classified separately from project
  // work even when it belongs to a project. Required-nullable like
  // stage_key — forcing the field forces the choice.
  category: z.enum(['project', 'admin']).nullable(),
  priority: z.enum(['critical', 'high', 'normal']).default('normal'),
  planned: z.boolean().optional(),
  follow_up_date: z.string().optional(),
  status: z.enum(['open', 'done']).optional(),
});

export const BlockerOutSchema = z.object({
  project_name: z.string().nullable(),
  what: z.string().min(1),
  blocked_by: z.string().min(1),
  // Which phase this blocker stops — blockers.blocks_phase already exists and
  // applyProposal already carries it; the agent just never filled it.
  // Required-nullable so the model can't silently skip it (same as stage_key).
  blocks_phase: PhaseKey.nullable(),
  days_at_risk: z.number().optional(),
  downstream: z.array(z.string()).optional(),
  suggested_action: z.string().optional(),
  // Noa round 3, agent bug #3: proposals reached the review inbox with no
  // quote — nothing to judge. A blocker claim now must cite the text.
  evidence: z.string().min(1),
});

export const DecisionOutSchema = z.object({
  project_name: z.string().nullable(),
  title: z.string().min(1),
  detail: z.string().optional(),
  decided_at: z.string().optional(),
  // A decision auto-commits to the permanent decisions log, so it must cite the
  // text like every other claim type (blocker/deadline/relationship already do).
  // Without this a fabricated "Decided: …" line in an untrusted email had no
  // quote to audit against. min(1) — routeExtractResult drops any without it.
  evidence: z.string().min(1),
});

export const DraftOutSchema = z.object({
  to_email: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  re_blocker_index: z.number().optional(),
});

export const VendorHoursOutSchema = z.object({
  project_name: z.string().nullable(),
  vendor_name: z.string().min(1),
  hours: z.number(),
  rate: z.number().optional(),
  period: z.string().optional(),
  note: z.string().optional(),
});

export const DeadlineUpdateSchema = z.object({
  project_name: z.string().nullable(),
  task_match: z.string().min(1),
  new_due: z.string(),
  // min(1) — agent bug #3: '' satisfied the old contract and produced a
  // "Deadline change" proposal with nothing to judge.
  evidence: z.string().min(1),
});

export const RelationshipOutSchema = z.object({
  project_name: z.string().nullable(),
  from_match: z.string().min(1),
  to_match: z.string().min(1),
  type: z.enum(['blocks', 'supports', 'parallel', 'unrelated', 'needs_verification']),
  reason: z.string().min(1),
  // Verbatim quote backing the claim — shown in the review inbox (bug #3).
  evidence: z.string().min(1),
});

export const ExtractResultSchema = z.object({
  project_name: z.string().nullable(),
  tasks: z.array(TaskOpSchema),
  blockers: z.array(BlockerOutSchema),
  decisions: z.array(DecisionOutSchema),
  drafts: z.array(DraftOutSchema),
  vendor_hours: z.array(VendorHoursOutSchema),
  deadline_updates: z.array(DeadlineUpdateSchema),
  relationships: z.array(RelationshipOutSchema),
});

export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type TaskOp = z.infer<typeof TaskOpSchema>;

export const InvoiceParseSchema = z.object({
  // 2026-08-28: five PDFs (contracts, a proposal, a hold letter, a cover
  // letter) each became a phantom invoice because the agent was never asked
  // WHAT the document is — only to fill invoice fields. Classification is
  // now step one, and only 'invoice' may create an invoices row.
  document_kind: z.enum(['invoice', 'contract', 'proposal', 'permit_or_letter', 'other']),
  vendor_name: z.string().min(1),
  project_name: z.string().nullable(),
  number: z.string().nullable(),
  amount_usd: z.number(),
  invoice_date: z.string().optional(),
  received_date: z.string().optional(),
  note: z.string().optional(),
});

export type InvoiceParse = z.infer<typeof InvoiceParseSchema>;

// prioritize-tasks output contract (forced-tool JSON) — one score + tier +
// grounded reason per open task (agents/prioritize-tasks.ts). Ranks are
// DERIVED from scores deterministically on our side; the model never emits
// rank integers directly (they drift and collide).
export const PrioritizedTaskSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(0).max(100),
  urgency: z.enum(['now', 'high', 'medium', 'low']),
  // One tight sentence grounded in the task's own facts — shown on My Work.
  reason: z.string().min(1),
});

export const PrioritizeResultSchema = z.object({
  tasks: z.array(PrioritizedTaskSchema),
});

export type PrioritizeResult = z.infer<typeof PrioritizeResultSchema>;

// infer-phase output contract (forced-tool JSON) — one pass of the iterative
// phase-inference loop (agents/infer-phase.ts).
export const PhaseInferenceSchema = z.object({
  phase_key: PhaseKey,
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
  reasoning: z.string().min(1),
});

export type PhaseInference = z.infer<typeof PhaseInferenceSchema>;
