import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Client router cache: repeat navigation within 60s serves instantly,
    // fresh data still fetched on hard reload / after the window. Server
    // actions revalidate their paths, which purges this cache on mutation.
    staleTimes: { dynamic: 60, static: 300 },
  },
  /* config options here */
};

export default nextConfig;
