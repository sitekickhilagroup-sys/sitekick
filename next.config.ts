import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Client router cache: repeat navigation within 30s serves instantly,
    // fresh data still fetched on hard reload / after the window.
    staleTimes: { dynamic: 30, static: 180 },
  },
  /* config options here */
};

export default nextConfig;
