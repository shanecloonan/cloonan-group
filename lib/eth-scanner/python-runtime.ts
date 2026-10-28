/**
 * Locate (or install) a CPython that can run `python -m eth_scanner`.
 * Vercel Node serverless has no system Python. Build traces a portable
 * CPython into the function; runtime can lazy-extract the same pin to /tmp.
 * Never logs secret values.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Keep in lockstep with scripts/bundle-python-runtime.mjs */
export const PORTABLE_PYTHON_RELEASE = "20261026";
export const PORTABLE_PYTHON_VERSION = "3.12.16";

export type PythonSource = "env" | "bundled" | "path" | "lazy";

export type PythonCandidate = {
  bin: string;
  source: PythonSource;
};

export type PythonRuntimeStatus = {
  env_override: boolean;
  bundled: boolean;
  lazy: boolean;
};

export function portablePythonPrefix(root = process.cwd()): string {
  return path.join(root, "eth-scanner", ".runtime", "python");
}

export function portablePythonBin(root = process.cwd()): string {
  return path.join(portablePythonPrefix(root), "bin", "python3");
}

export function lazyPythonPrefix(): string {
  return path.join(tmpdir(), "eth-scanner-python");
}

export function lazyPythonBin(): string {
  return path.join(lazyPythonPrefix(), "bin", "python3");
}

export function bundleScriptPath(root = process.cwd()): string {
  return path.join(root, "scripts", "bundle-python-runtime.mjs");
}

export function pythonRuntimeStatus(root = process.cwd()): PythonRuntimeStatus {
  return {
    env_override: Boolean(process.env.ETH_SCANNER_PYTHON?.trim()),
    bundled: existsSync(portablePythonBin(root)),
    lazy: existsSync(lazyPythonBin()),
  };
}

export function listPythonCandidates(root = process.cwd()): PythonCandidate[] {
  const out: PythonCandidate[] = [];
  const preferred = process.env.ETH_SCANNER_PYTHON?.trim();
  if (preferred) out.push({ bin: preferred, source: "env" });
  const bundled = portablePythonBin(root);
  if (existsSync(bundled)) out.push({ bin: bundled, source: "bundled" });
  if (!preferred) {
    out.push({ bin: "python3", source: "path" }, { bin: "python", source: "path" });
  }
  const lazy = lazyPythonBin();
  if (existsSync(lazy) && lazy !== bundled) out.push({ bin: lazy, source: "lazy" });
  return out;
}

export function pythonHomeFor(source: PythonSource, bin: string): string | undefined {
  if (source === "bundled" || source === "lazy") {
    return path.resolve(bin, "..", "..");
  }
  return undefined;
}

export function canLazyInstallPython(): boolean {
  return process.platform === "linux";
}

export function missingPythonError(lastErr: string, tried: string[]): string {
  const names = tried.length ? tried.join(", ") : "python3, python";
  const onVercel = Boolean(process.env.VERCEL);
  const hint = onVercel
    ? "Vercel Node serverless has no system Python. This deploy should include a portable CPython at eth-scanner/.runtime/python (downloaded at build). If that file is missing from the function bundle, rebuild or set ETH_SCANNER_PYTHON."
    : "Install Python 3.10+ (not a Windows Store stub) or set ETH_SCANNER_PYTHON to a real interpreter.";
  return `${lastErr} (tried ${names}). ${hint}`;
}

function stampMatches(prefix: string): boolean {
  try {
    const stamp = readFileSync(path.join(prefix, ".bundle-id"), "utf8").trim();
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    return stamp === `${PORTABLE_PYTHON_VERSION}+${PORTABLE_PYTHON_RELEASE}-${arch}`;
  } catch {
    return false;
  }
}

/**
 * Download the pinned linux-gnu CPython into destPrefix (bin/python3).
 * Used at `next build` on Vercel and as a /tmp fallback at request time.
 */
export function ensurePortablePython(opts?: { destPrefix?: string; root?: string }): string {
  const root = opts?.root ?? process.cwd();
  const destPrefix = opts?.destPrefix ?? portablePythonPrefix(root);
  const bin = path.join(destPrefix, "bin", "python3");
  if (existsSync(bin) && stampMatches(destPrefix)) return bin;

  const script = bundleScriptPath(root);
  if (!existsSync(script)) {
    throw new Error(
      "portable CPython installer is missing from this function bundle (scripts/bundle-python-runtime.mjs)",
    );
  }
  const ran = spawnSync(process.execPath, [script, "--force", "--dest", destPrefix], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ETH_SCANNER_BUNDLE_PYTHON: "1" },
  });
  if (ran.status !== 0) {
    const err = (ran.stderr || ran.stdout || "bundle-python-runtime failed").trim().slice(0, 400);
    throw new Error(err);
  }
  if (!existsSync(bin)) {
    throw new Error("portable CPython install finished without bin/python3");
  }
  return bin;
}
