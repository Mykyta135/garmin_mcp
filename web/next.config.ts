import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon: it must be require()'d at runtime by Node
  // rather than bundled, or the .node binary fails to resolve on the server.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
