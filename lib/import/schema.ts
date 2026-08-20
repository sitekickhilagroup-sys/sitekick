import { z } from 'zod';
import type { ReqState } from '../types.ts';

// Wire format = the dashboard "record" structure the client already validated.
// Kept permissive on unknown keys so PM-supplied files evolve without code changes.

export const RecordItemSchema = z.object({
  r: z.string().min(1),
  done: z.boolean().optional(),
  state: z.string().optional(),
  who: z.enum(['us', 'city']).optional(),
  basis: z.enum(['standard', 'ours']).optional(),
  evidence: z.string().optional(),
  note: z.string().optional(),
  src: z.string().optional(),
});

export const RecordStageSchema = z.object({
  items: z.array(RecordItemSchema),
  total: z.number().optional(),
  active: z.boolean().optional(),
  note: z.string().optional(),
});

export const RecordImportSchema = z.object({
  stage: z.string().min(1),
  note: z.string().optional(),
  done_n: z.number().optional(),
  total: z.number().optional(),
  also_active: z.array(z.string()).optional(),
  stages: z.record(z.string(), RecordStageSchema),
});

export type RecordImport = z.infer<typeof RecordImportSchema>;
export type RecordItem = z.infer<typeof RecordItemSchema>;

// done flag or any "done*" state wins; unknown wins over open only when explicit.
export function mapState(item: RecordItem): ReqState {
  if (item.done || (item.state ?? '').startsWith('done')) return 'done';
  if (item.state === 'unknown') return 'unknown';
  if (item.state === 'open') return 'open';
  return item.state ? 'unknown' : 'open';
}
