import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
