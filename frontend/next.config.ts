import type { NextConfig } from "next";

const API = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: {
    position: "bottom-right",
  },
  experimental: {
    // Story generation can take longer than the 30s default when proxied to Django.
    proxyTimeout: 300_000,
    // App pages render only after SessionProvider loads the user in the browser, so the server can't validate them.
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/media/:path*", destination: `${API}/media/:path*` },
    ];
  },
};

export default nextConfig;
