import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Client router cache: repeat navigation within 60s serves instantly,
    // fresh data still fetched on hard reload / after the window. Server
    // actions revalidate their paths, which purges this cache on mutation.
    staleTimes: { dynamic: 60, static: 300 },
    // Server Actions cap request bodies at 1MB by default — comfortable for
    // every other action in this app, but E6's reconciliation upload
    // (app/actions/invoices.ts's parseReconciliationSource) sends the whole
    // invoice-tracker workbook as one action call, not through /api/upload's
    // route handler (which has its own, separate 20MB check). Kept modest
    // (review round 2, judgment call 1) rather than generously loosened: this
    // limit applies to EVERY Server Action in the app, and the body is
    // buffered before requireUser() ever runs — 2mb comfortably covers any
    // plausible tracker .xlsx without widening that pre-auth exposure more
    // than this one upload actually needs.
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Security headers on every route. frame-ancestors/X-Frame-Options close the
  // clickjacking vector: without them an attacker page can iframe /settings or
  // /work and, because the session cookie is sameSite=lax (sent on framed GET
  // navigations), trick a logged-in user into clicking through real one-click
  // actions (deleteAppUser, advanceInvoice). Next's Server-Action Origin check
  // stops CSRF but not this — the click is genuinely same-origin. HSTS forces
  // HTTPS so the (now Secure) auth cookie can never go out in cleartext.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
