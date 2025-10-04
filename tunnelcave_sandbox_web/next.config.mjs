// tunnelcave_sandbox_web/next.config.mjs
import path from "path";
import { fileURLToPath } from "url";

const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    //1.- Synchronize the runtime alias with the monorepo client source directory.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@client": path.resolve(nextConfigDir, "../typescript-client/src"),
    };
    return config;
  },
  experimental: { externalDir: true },
};

export default nextConfig;
