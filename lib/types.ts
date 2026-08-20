// Domain types — mirror supabase/migrations/0001_init.sql

export type ReqState = 'done' | 'open' | 'unknown';
export type ReqWho = 'us' | 'city';
export type ReqBasis = 'standard' | 'ours';
export type StageStatus = 'done' | 'current' | 'upcoming' | 'skipped';
export type InvoiceStatus = 'received' | 'for_rowan_approval' | 'approved' | 'paid' | 'on_hold';
export type InvoiceTab = 'invoices' | 'payment_summary' | 'david';
export type TaskPriority = 'critical' | 'high' | 'normal';
export type TaskStatus = 'open' | 'done' | 'dropped';
export type DocKind = 'email' | 'transcript' | 'invoice_pdf' | 'sheet' | 'other';
export type DocSource = 'forward' | 'gmail' | 'outlook' | 'upload' | 'sheets' | 'zimas' | 'manual';
export type DraftStatus = 'proposed' | 'approved' | 'sent' | 'dismissed';
export type BlockerStatus = 'active' | 'released';
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
}

export interface Blocker {
  id: string;
  project_id: string;
  document_id: string | null;
  what: string;
  blocked_by: string;
  days_at_risk: number;
  days_stuck: number;
  downstream: string[];
  suggested_action: string | null;
  status: BlockerStatus;
  created_at: string;
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
export interface Action {
  kind: 'task' | 'blocker';
  id: string;
  project: string;
  title: string;
  why: string;
  score: number;
  source: string | null;
  waiting_for: string | null;
}
