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
  /* config options here */
};

export default nextConfig;
