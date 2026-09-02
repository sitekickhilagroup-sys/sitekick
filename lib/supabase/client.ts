'use client';

import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Secure in production; off in dev for http://localhost (see proxy.ts).
    { cookieOptions: { secure: process.env.NODE_ENV === 'production' } },
  );
}
