import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloud Run runs a self-contained server built from this output.
  output: "standalone",
  // Trace files from the monorepo root so the workspace packages are included.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@vetrix/domain", "@vetrix/db", "@vetrix/pack"],
};

export default nextConfig;
