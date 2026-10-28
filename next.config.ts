import type { NextConfig } from "next";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SCANNER_FILE_TRACE_GLOBS } from "./lib/eth-scanner/python-runtime";

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

const scannerTrace = [...SCANNER_FILE_TRACE_GLOBS];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/test/run": scannerTrace,
    "/api/test": scannerTrace,
    "app/api/test/run": scannerTrace,
    "app/api/test": scannerTrace,
  },
};

export default nextConfig;
