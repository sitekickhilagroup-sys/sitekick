import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Next 16: proxy.ts (middleware successor), Node runtime.
// Refreshes the Supabase session cookie and gates the dashboard.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No prefetch exemption. There used to be one ("don't burn a Supabase auth
  // roundtrip"), from the getUser() era — but getClaims() below verifies the
  // JWT locally against a cached JWKS, so the exemption saved nothing and
  // opened a hole: any request claiming to be a prefetch (a header the caller
  // controls) rendered protected pages server-side without a session. RLS
  // kept the data empty, but page shells leaked and pages with their own
  // requireUser 500'd instead of redirecting.

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Ship the session cookie as Secure in production so a stray HTTP hop
      // (SSL-strip, pre-HSTS first visit) can't carry it in cleartext. Left
      // off in dev so http://localhost login still works.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // @supabase/ssr hands setAll a second arg of anti-cache response
        // headers (Cache-Control: private, no-store, …). Dropping it — as the
        // one-param version did — means the response that carries a refreshed
        // session Set-Cookie is cacheable; put a CDN in front and one user's
        // token can be served to another. Copy them onto the response.
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );

  // /api/* routes carry their own auth (cron/ingest secrets) — skip the
  // session work entirely for them.
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api')) return response;

  // getClaims verifies the JWT locally (JWKS cached) — no per-request
  // network hop to Supabase Auth like getUser().
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims ?? null;

  const isPublic = pathname.startsWith('/login');
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
