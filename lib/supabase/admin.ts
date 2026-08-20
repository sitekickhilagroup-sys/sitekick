import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client. All writes go through this, server-side only.
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseAdmin() is server-only');
  }
  if (!cached) {
    cached = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}
