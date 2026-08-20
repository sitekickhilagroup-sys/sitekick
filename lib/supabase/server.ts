import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Cookie-bound anon client for Server Components / Server Actions / Route Handlers.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies; proxy/middleware refreshes the session.
          }
        },
      },
    },
  );
}
