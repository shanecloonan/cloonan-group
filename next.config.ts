import type { NextConfig } from "next";
import { spawnSync } from "node:child_process";
import path from "node:path";

function bundlePortablePythonIfNeeded() {
  if (process.env.VERCEL !== "1" && process.env.ETH_SCANNER_BUNDLE_PYTHON !== "1") {
    return;
  }
  const script = path.join(process.cwd(), "scripts", "bundle-python-runtime.mjs");
  const ran = spawnSync(process.execPath, [script, "--force"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, ETH_SCANNER_BUNDLE_PYTHON: "1" },
  });
  if (ran.status !== 0) {
    throw new Error("Failed to bundle portable CPython for /api/test/run (Lane A)");
  }
}

bundlePortablePythonIfNeeded();

/** Exact /api/test/run only — `/api/test` prefix-matches /api/testnet. */
const scannerTrace = [
  "./eth-scanner/src/**/*",
  "./eth-scanner/tests/fixtures/**/*",
  "./eth-scanner/.runtime/**/*",
  "./scripts/bundle-python-runtime.mjs",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/test/run": scannerTrace,
    "/app/api/test/run": scannerTrace,
    "app/api/test/run": scannerTrace,
  },
  outputFileTracingExcludes: {
    "/api/testnet/*": ["./eth-scanner/.runtime/**/*"],
    "/api/test/receipt": ["./eth-scanner/.runtime/**/*"],
    "/api/test": ["./eth-scanner/.runtime/**/*"],
  },
  async redirects() {
    return [
      { source: "/fund", destination: "/research", permanent: true },
      { source: "/fund/:path*", destination: "/research/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
