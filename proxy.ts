import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Next 16: proxy.ts (middleware successor), Node runtime.
// Refreshes the Supabase session cookie and gates the dashboard.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Router prefetches: don't burn a Supabase auth roundtrip; the real
  // navigation (and every server page) still verifies the session.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose')?.includes('prefetch')
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
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
