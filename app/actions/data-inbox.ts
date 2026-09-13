'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import {
  getDataInboxTriage as getDataInboxTriageFor,
  processSelectedDocuments as processSelectedDocumentsFor,
  type DataInboxTriage, type PilotRunResult,
} from '@/lib/data-inbox';

// Type-only re-exports are fine from a 'use server' file (erased at compile
// time — see app/actions/import-queue.ts's existing BatchResult/DrainResult/
// ImportQueueStats re-exports). PILOT_MAX_DOCS/PILOT_BUDGET_USD are real
// VALUES (plain numbers), which — like a synchronous function — a 'use
// server' file cannot export; components needing them import directly from
// '@/lib/data-inbox' instead (see components/upload/data-inbox-triage.tsx).
export type { DataInboxTriage, PilotRunResult, TriageDocument, PilotOutcome, PilotDocResult } from '@/lib/data-inbox';

export async function getDataInboxTriage(offset = 0): Promise<DataInboxTriage> {
  await requireUser();
  return getDataInboxTriageFor(supabaseAdmin(), offset);
}

export async function processSelectedDocuments(documentIds: string[]): Promise<PilotRunResult> {
  await requireUser();
  const result = await processSelectedDocumentsFor(supabaseAdmin(), documentIds);
  revalidatePath('/upload');
  return result;
}
