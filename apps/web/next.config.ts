import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@vetrix/domain", "@vetrix/db", "@vetrix/pack"],
};

export default nextConfig;
