'use server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';

/**
 * Data Inbox bulk-upload fix, part 1: Vercel Functions hard-cap request
 * bodies at 4.5MB on every plan (confirmed against Vercel's own docs, not
 * assumed) — the app's own `/api/upload` route claims a 20MB-per-file cap,
 * but anything between 4.5MB and 20MB never actually reached that check; it
 * failed with a raw 413 at the platform level first. This is almost
 * certainly what "size/space limits" meant in practice — a real .olm/.zip
 * mailbox export or a scanned invoice PDF easily clears 4.5MB.
 *
 * Standard fix (Vercel's own documented pattern): the browser uploads
 * directly to Supabase Storage using a short-lived, single-path signed
 * upload token minted here — the file's bytes never pass through a Vercel
 * Function at all, so the 4.5MB ceiling doesn't apply. `/api/upload` is then
 * called with the storage path instead of the raw file (see its `staged`
 * branch) and does the exact same parsing/ingestion it always did.
 *
 * requireUser() gates *minting the token*, not the upload itself — the
 * token, once issued, is what actually authorizes the single upload to that
 * one path, independent of the bucket's own RLS policies.
 */
export async function createUploadUrl(
  fileName: string,
): Promise<{ path: string; token: string } | { error: string }> {
  await requireUser();
  const path = `staged/${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;
  const { data, error } = await supabaseAdmin().storage.from('documents').createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? 'could not create upload URL' };
  return { path: data.path, token: data.token };
}
