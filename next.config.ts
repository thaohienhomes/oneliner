import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Comfy SDK (ESM + hash-wasm) out of the server bundle.
  serverExternalPackages: ["@comfyorg/sdk"],
  // lib/renderShot.ts reads the workflow JSON from disk at runtime.
  outputFileTracingIncludes: { "/api/shot": ["./workflows/**/*.json"] },
};

export default nextConfig;
