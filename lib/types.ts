// Domain types — mirror supabase/migrations/0001_init.sql

export type ReqState = 'done' | 'open' | 'unknown';
export type ReqWho = 'us' | 'city';
export type ReqBasis = 'standard' | 'ours';
export type StageStatus = 'done' | 'current' | 'upcoming' | 'skipped';
/** 'cancelled' (0019, Rotem QA round 2): voids an invoice recorded by
 *  mistake — off-chain terminal like on_hold, excluded from open totals,
 *  never deleted so the audit trail survives. */
export type InvoiceStatus = 'received' | 'for_rowan_approval' | 'approved' | 'paid' | 'on_hold' | 'cancelled';
export type InvoiceTab = 'invoices' | 'payment_summary' | 'david';
export type TaskPriority = 'critical' | 'high' | 'normal';
/** 'merged' (0010) marks a duplicate folded into a Master Action. Rows in that
 *  state are kept for history and filtered out of every list. */
export type TaskStatus = 'open' | 'done' | 'dropped' | 'merged';

/** 0013 — a task's effect on the process, separate from its status. A task can
 *  be Waiting without being Blocking. Null means nobody has classified it. */
export type ProcessImpact =
  | 'primary_blocker' | 'workstream_blocker' | 'future_gate'
  | 'external_gate' | 'not_blocking' | 'verify';
export type DocKind = 'email' | 'transcript' | 'invoice_pdf' | 'sheet' | 'other';
export type DocSource = 'forward' | 'gmail' | 'outlook' | 'upload' | 'sheets' | 'zimas' | 'manual';
export type DraftStatus = 'proposed' | 'approved' | 'sent' | 'dismissed';
export type BlockerStatus = 'active' | 'released';
/** 0009 — blocker audit classification. A task can be important, urgent or
 *  waiting on someone without being a true blocker. */
export type BlockerKind =
  | 'primary'
  | 'workstream'
  | 'future_gate'
  | 'external_gate'
  | 'urgent_action'
  | 'verify'
  | 'information_only';
export type EventKind = 'history' | 'forecast';

export interface Project {
  id: string;
  name: string;
  address: string | null;
  llc: string | null;
  city_case: string | null;
  city_on_hold: boolean;
  city_flag: string | null;
  target_rti: string | null;
  created_at: string;
  current_phase_key: PhaseKey | null;
  /** Narrative context paragraph (0006) — shown on the portfolio card + process page. */
  summary: string | null;
  /** 0007: false = parked under "Inactive projects" (Flicker). */
  active: boolean;
  /** 0015 — Noa's standing priority: 1=Blair, 2=San Marco, 3=Rinconia,
   *  4=Alta Mesa. Null = unranked (sorts last, with General, on Today). */
  business_rank: number | null;
}

export interface ProjectStage {
  id: string;
  project_id: string;
  stage_key: string;
  label: string;
  position: number;
  status: StageStatus;
  also_active: boolean;
  substage: string | null;
  risk: boolean;
  slip_days: number;
  confirmed: boolean;
}

export interface StageRequirement {
  id: string;
  project_stage_id: string;
  text: string;
  state: ReqState;
  who: ReqWho;
  basis: ReqBasis;
  evidence: string | null;
  note: string | null;
  src: string | null;
  position: number;
  done_at: string | null;
}

export interface SubstageCatalogRow {
  stage_key: string;
  position: number;
  name: string;
}

export interface ProjectEvent {
  id: string;
  project_id: string;
  kind: EventKind;
  step: string;
  event_date: string | null;
  src: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  project_id: string | null;
  kind: DocKind;
  source: DocSource;
  external_id: string | null;
  storage_path: string | null;
  raw_text: string | null;
  received_at: string;
  processed_at: string | null;
}

export interface Task {
  id: string;
  project_id: string | null;
  document_id: string | null;
  title: string;
  description: string | null;
  owner: string | null;
  waiting_for: string | null;
  due: string | null;
  stage_key: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  planned: boolean;
  follow_up_date: string | null;
  check_back_on: string | null;
  source: string | null;
  last_touched: string;
  created_at: string;
  manual_priority: number | null;
  snoozed_until: string | null;
  /** 0013 — effect on the process, independent of `status`. Null = not yet
   *  classified, and the legacy priority heuristic still applies. */
  process_impact: ProcessImpact | null;
  /** 0010 — set when this row was folded into a Master Action. */
  merged_into: string | null;
  merged_at: string | null;
  merged_by: string | null;
  /** 0015 — free-text note from the last "note" verb; renders on the row so
   *  it survives a refresh instead of living only in the activity log. */
  latest_note: string | null;
  /** 0015 — sub-stage this task is classified under, if any. */
  substage_template_id: string | null;
  /** 0015 — parallel workstream this task is classified under, if any. */
  workstream_id: string | null;
}

export interface Blocker {
  id: string;
  project_id: string;
  /** The doc's `source_evidence_id` — the record proving the dependency. */
  document_id: string | null;
  what: string;
  blocked_by: string;
  days_at_risk: number;
  days_stuck: number;
  downstream: string[];
  suggested_action: string | null;
  status: BlockerStatus;
  created_at: string;
  /** 0009 — classification from the blocker audit. Only 'primary' and
   *  'workstream' count toward a project's blocking count. */
  kind: BlockerKind;
  /** Which phase this prevents. Null means the mandatory test cannot be
   *  answered, so the item can never qualify as a Primary Blocker. */
  blocks_phase: string | null;
  blocks_substage: string | null;
  blocked_deliverable: string | null;
  relationship_reason: string | null;
  confidence: number;
  effective_from: string | null;
  last_verified_at: string | null;
  release_condition: string | null;
  /** Set when a human fixes the classification; agents must not overwrite it
   *  without new contradicting evidence and approval. */
  manually_corrected_by: string | null;
  undo_event_id: string | null;
}

export interface Decision {
  id: string;
  project_id: string | null;
  title: string;
  detail: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface Draft {
  id: string;
  blocker_id: string | null;
  task_id: string | null;
  to_email: string | null;
  subject: string;
  body: string;
  status: DraftStatus;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  discipline: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  hue: string | null;
  notes: string | null;
  created_at: string;
}

export interface VendorHours {
  id: string;
  vendor_id: string;
  project_id: string;
  document_id: string | null;
  hours: number;
  rate: number | null;
  period: string | null;
  note: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  project_id: string | null;
  vendor_id: string | null;
  document_id: string | null;
  number: string | null;
  amount_usd: number;
  invoice_date: string | null;
  received_date: string | null;
  due: string | null;
  status: InvoiceStatus;
  tab: InvoiceTab;
  entity: string | null;
  paid_date: string | null;
  transfer_confirmation_url: string | null;
  approved_by: string | null;
  budget_line: string | null;
  created_at: string;
  invoice_url: string | null;
  receipt_url: string | null;
  /** 0007: free-text field on the Update Invoice editor (spec §יב). */
  notes: string | null;
  /** 0017 (E4) — set on insert when Add Invoice's duplicate check couldn't
   *  rule out a match (or the invoice has no number at all); never
   *  auto-resolved, only a human clears it. Not yet live — see migration
   *  0017_invoice_verify.sql. */
  needs_verification: boolean;
  /** 0018 (Q10) — the tracker's Service Month column ("Sep 25" / "2026-01"). */
  service_month: string | null;
}

export interface Digest {
  id: string;
  for_date: string;
  body_md: string;
  top_actions: Action[];
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

// Priority engine output (lib/priority.ts)
// Locale-neutral "why this ranks here" parts — the UI translates at render
// time (the priority engine has no access to the viewer's locale).
export interface ActionWhy {
  critical?: boolean;
  due?: string | null;
  waiting?: string | null;
  stuck_days?: number;
  blocked_by?: string | null;
  unlocks?: number;
}

export interface Action {
  kind: 'task' | 'blocker';
  id: string;
  project: string | null;
  title: string;
  why: ActionWhy;
  score: number;
  source: string | null;
  waiting_for: string | null;
}

// Agent proposals + audit trail (lib/types.ts mirrors supabase/migrations/0002_proposals_activity.sql)
export type ProposalType = 'task_update' | 'task_done' | 'task_create' | 'blocker_create' | 'decision_create' | 'deadline_update' | 'phase_set' | 'relationship_create';
export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'auto_applied' | 'ignored' | 'not_sure';

// What Noa decides the suggestion actually is, chosen in the Import Review
// drawer before it is applied (her "RECOMMENDED TREATMENT" select).
export type ChangeType =
  | 'new_task' | 'update_existing' | 'complete_existing'
  // 'keep_both_linked' is the option the corrections doc asks for and the
  // drawer was missing: the two items are genuinely different work in one
  // chain, so both survive and a relationship records the dependency.
  // 'keep_open' leaves both records and links nothing.
  | 'merge_duplicate' | 'keep_both_linked' | 'keep_open' | 'information_only';

export interface AgentProposal {
  id: string;
  document_id: string | null;
  project_id: string | null;
  type: ProposalType;
  payload: Record<string, unknown>;
  target_task_id: string | null;
  confidence: number;
  reasoning: string | null;
  evidence_excerpt: string | null;
  state: ProposalState;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  title: string | null;
  change_type: ChangeType | null;
  result_note: string | null;
  match_score: number | null;   // 0-100, how well it matched target_task_id
  match_reason: string | null;
}

export interface ActivityEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
}

// Process model: canonical fixed phases + substage library + parallel
// workstreams (lib/types.ts mirrors supabase/migrations/0003_process_model.sql)
export type PhaseKey = 'planning' | 'plan_check' | 'bidding' | 'financing' | 'construction';
export type SubstageKind = 'standard' | 'conditional';
export type WorkstreamStatus = 'active' | 'done';
export type ProjectSubstageStatus =
  | 'upcoming' | 'active' | 'done' | 'not_applicable'
  // 0007 — Noa's full sub-stage lifecycle (spec §ג):
  | 'waiting' | 'blocked' | 'verify' | 'submitted' | 'with_city';

export interface Phase {
  key: PhaseKey;
  label: string;
  position: number;
}

export interface SubstageTemplate {
  id: string;
  phase_key: PhaseKey;
  name: string;
  kind: SubstageKind;
  position: number;
}

export interface Workstream {
  id: string;
  project_id: string;
  name: string;
  phase_key: PhaseKey;
  status: WorkstreamStatus;
}

// A conditional rule shown as an explorable outcome, never applied on its own:
// "IF the extension is denied THEN …". Options and results are index-aligned.
export interface SubstageDecision {
  label: string;
  options: string[];
  results: string[];
}

export interface ProjectSubstage {
  id: string;
  project_id: string;
  substage_template_id: string;
  workstream_id: string | null;
  status: ProjectSubstageStatus;
  note: string | null;
  decision: SubstageDecision | null;
  activated_at: string | null;
  completed_at: string | null;
  /** 0019 (Noa request #2): per-project manual order override on the shared
   *  template-position×10 scale — null means library order. See
   *  substageSortKey in lib/process.ts. */
  position: number | null;
  /** 0019 (Noa bug #5): free-text dependency line — "after X · parallel to
   *  Y" — shown under the sub-stage name instead of being buried in note. */
  depends_on: string | null;
}

// Relationships: typed task dependencies with evidence (lib/types.ts mirrors supabase/migrations/0004_relationships.sql)
/** 0011 adds the five the process spec requires. `supports` and `unrelated`
 *  stay: the spec's `required_for` is a stronger claim than "supports", and
 *  `independent` is narrower than "unrelated" (same project, different causal
 *  chain), so neither pair collapses into one value. */
export type RelationshipType =
  | 'blocks' | 'supports' | 'parallel' | 'unrelated' | 'needs_verification'
  | 'required_for' | 'affects' | 'related' | 'independent' | 'conditional';

export interface Relationship {
  id: string;
  project_id: string | null;
  from_task_id: string;
  to_task_id: string;
  type: RelationshipType;
  reason: string | null;
  confidence: number;
  evidence_document_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  manual_override: boolean;
  created_at: string;
}

// Weekly review: Sprint D (lib/types.ts mirrors supabase/migrations/0005_weekly_review.sql,
// 'final' + finalized_at added by 0016_weekly_finalize.sql / D1)
export type WeeklyReviewStatus = 'preparing' | 'saved' | 'final';

export interface WeeklyReview {
  id: string;
  meeting_date: string;
  status: WeeklyReviewStatus;
  source_review_id: string | null;
  recording_document_id: string | null;
  /** Set by finalizeReview, cleared by reopenReview (D1). Null while the
   *  review is 'preparing' or 'saved'. */
  finalized_at: string | null;
  created_at: string;
}

export interface WeeklyReviewSubtopic {
  id: string;
  weekly_review_id: string;
  project_id: string | null;
  subtopic: string;
  context: string | null;
  created_at: string;
}

export interface WeeklyReviewItem {
  id: string;
  weekly_review_id: string;
  task_id: string;
  project_id: string | null;
  subtopic: string | null;
  status_snapshot: string;
  weekly_note: string | null;
  /** D2: the item's own "what happens next" line, distinct from weekly_note
   *  (what happened) — added by 0016_weekly_finalize.sql. */
  next_step: string | null;
  sequence: number;
  carried_from: string | null;
}

/** 0020_profiles.sql — per-user profile (name the AI uses, avatar). */
export interface Profile {
  user_id: string;
  display_name: string | null;
  /** 'preset:<key>' for a built-in colored initial, or a public image URL. */
  avatar: string | null;
  updated_at: string;
}
