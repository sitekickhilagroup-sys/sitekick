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
    // route handler (which has its own, separate 20MB check). Raised well
    // past any plausible tracker .xlsx so a real file never trips Next's
    // framework-level limit before the action's own error handling runs.
    serverActions: { bodySizeLimit: '10mb' },
  },
  /* config options here */
};

export default nextConfig;
