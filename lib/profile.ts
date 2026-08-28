import { supabaseAdmin } from './supabase/admin';
import type { Profile } from './types';

// Server-only profile read (service role). Preset colors live in
// lib/avatar-presets.ts so client components can import them without
// dragging the admin client into a browser bundle.
export async function getProfile(userId: string): Promise<Profile | null> {
  const admin = supabaseAdmin();
  const { data } = await admin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  return (data as Profile | null) ?? null;
}
