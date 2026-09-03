import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const requestedDistDir = process.env.TUBEKNOWLEDGE_NEXT_DIST_DIR;
if (requestedDistDir && !/^\.next-[a-z0-9-]+$/i.test(requestedDistDir)) throw new Error("TUBEKNOWLEDGE_NEXT_DIST_DIR invalide.");

const nextConfig: NextConfig = {
  distDir: requestedDistDir || ".next",
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
