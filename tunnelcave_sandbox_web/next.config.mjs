// tunnelcave_sandbox_web/next.config.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));

export const resolveClientSourcePath = (baseDir = nextConfigDir) => {
  //1.- Locate the shared client source directory whether it lives beside the app or inside the app (Docker copy).
  const clientSourceCandidates = [
    { label: "sibling", absolutePath: path.resolve(baseDir, "../typescript-client/src") },
    { label: "local", absolutePath: path.resolve(baseDir, "typescript-client/src") },
  ];
  //2.- Resolve the first existing candidate so Webpack aliases point at the correct filesystem entry in all environments.
  return (
    clientSourceCandidates.find(({ absolutePath }) => fs.existsSync(absolutePath))?.absolutePath ??
    clientSourceCandidates[0].absolutePath
  );
};

const resolvedClientSourcePath = resolveClientSourcePath();

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    //1.- Synchronize the runtime alias with the monorepo client source directory.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@client": resolvedClientSourcePath,
    };
    return config;
  },
  experimental: { externalDir: true },
};

export default nextConfig;
