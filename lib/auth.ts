import { supabaseServer } from './supabase/server';

export interface SessionUser {
  id: string;
  email: string | null;
}

// getClaims verifies the JWT locally against the cached JWKS — no network
// round trip to Supabase Auth like getUser() (same approach as proxy.ts).
// Fine for gating: all writes still go through the service-role client
// only after this check, and the proxy already refreshed the session.
export async function requireUser(): Promise<SessionUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) throw new Error('unauthorized');
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
}
