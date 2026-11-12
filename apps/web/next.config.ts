import path from "node:path";
import type { NextConfig } from "next";

// Basic protections on every response. A full script CSP needs nonces and is
// added with the first deployment; these headers are safe today.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  // Lets a verification build use its own folder (NEXT_DIST_DIR=.next-verify)
  // so it never overwrites the files of a running `pnpm dev` server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cloud Run runs a self-contained server built from this output.
  output: "standalone",
  // Trace files from the monorepo root so the workspace packages are included.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@vetrix/domain", "@vetrix/db", "@vetrix/pack"],
  // Clinic CSV imports are sent through a server action (each file up to 10 MB).
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
