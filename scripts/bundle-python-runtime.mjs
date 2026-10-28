/**
 * Download the pinned linux-gnu CPython used by POST /api/test/run on Vercel.
 * Keep pins in lockstep with lib/eth-scanner/python-runtime.ts.
 *
 *   node scripts/bundle-python-runtime.mjs [--force] [--dest <prefix>]
 *
 * Default dest: <repo>/eth-scanner/.runtime/python
 * On Vercel, `next build` / package.json `build` always runs this.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTABLE_PYTHON_RELEASE = "20261026";
export const PORTABLE_PYTHON_VERSION = "3.12.16";

const ASSETS = {
  x86_64: {
    file: `cpython-${PORTABLE_PYTHON_VERSION}+${PORTABLE_PYTHON_RELEASE}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
    sha256: "ce4f6d0a6cfdb3bed6e44c2f9affd85943c76a42e25ad3a259002f31d6fb8a20",
  },
  aarch64: {
    file: `cpython-${PORTABLE_PYTHON_VERSION}+${PORTABLE_PYTHON_RELEASE}-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz`,
    sha256: "bb4b6392670c5d3f93876996fcaa19858a4a413a0c7720144c18b0d6f1f0db2d",
  },
};

const SLIM_DIRS = [
  "include",
  "share",
  "lib/pkgconfig",
  "lib/python3.12/tkinter",
  "lib/python3.12/idlelib",
  "lib/python3.12/turtledemo",
  "lib/python3.12/ensurepip",
  "lib/python3.12/test",
  "lib/python3.12/pydoc_data",
  "lib/python3.12/lib2to3",
  "lib/python3.12/unittest",
  "lib/python3.12/site-packages/pip",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function portableArch(arch = process.arch) {
  if (arch === "x64" || arch === "x86_64") return "x86_64";
  if (arch === "arm64" || arch === "aarch64") return "aarch64";
  return null;
}

export function defaultPrefix() {
  return path.join(root, "eth-scanner", ".runtime", "python");
}

function bundleId(arch) {
  return `${PORTABLE_PYTHON_VERSION}+${PORTABLE_PYTHON_RELEASE}-${arch}`;
}

function stampPath(prefix) {
  return path.join(prefix, ".bundle-id");
}

function isUsable(prefix, arch) {
  const bin = path.join(prefix, "bin", "python3");
  if (!existsSync(bin)) return false;
  try {
    return readFileSync(stampPath(prefix), "utf8").trim() === bundleId(arch);
  } catch {
    return true;
  }
}

function chmodBins(prefix) {
  for (const name of ["python3", "python", "python3.12"]) {
    const p = path.join(prefix, "bin", name);
    if (existsSync(p)) {
      try {
        chmodSync(p, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
}

function slim(prefix) {
  for (const rel of SLIM_DIRS) {
    const abs = path.join(prefix, rel);
    if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
  }
  const binDir = path.join(prefix, "bin");
  if (existsSync(binDir)) {
    for (const name of ["pip", "pip3", "pip3.12", "idle3", "idle3.12", "2to3", "2to3-3.12", "pydoc3", "pydoc3.12"]) {
      const abs = path.join(binDir, name);
      if (existsSync(abs)) rmSync(abs, { force: true });
    }
  }
  const turtle = path.join(prefix, "lib/python3.12/turtle.py");
  if (existsSync(turtle)) rmSync(turtle, { force: true });
}

async function download(arch, destFile) {
  const asset = ASSETS[arch];
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PORTABLE_PYTHON_RELEASE}/${encodeURIComponent(asset.file)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  let res;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "cloonan-group-eth-scanner-python-bundle" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`portable CPython download failed HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error("portable CPython checksum mismatch — refusing to extract");
  }
  writeFileSync(destFile, buf);
}

function extract(tarFile, prefix) {
  mkdirSync(prefix, { recursive: true });
  const ran = spawnSync("tar", ["-xzf", tarFile, "--strip-components=1", "-C", prefix], {
    encoding: "utf8",
  });
  if (ran.status !== 0) {
    throw new Error(`portable CPython extract failed: ${(ran.stderr || ran.stdout || "tar failed").trim().slice(0, 240)}`);
  }
}

export async function ensurePortablePython(destPrefix = defaultPrefix()) {
  const arch = portableArch();
  if (!arch) {
    throw new Error(`no portable CPython for arch ${process.arch} — set ETH_SCANNER_PYTHON`);
  }
  if (process.platform !== "linux") {
    throw new Error(`portable CPython is linux-gnu only (host is ${process.platform})`);
  }
  const bin = path.join(destPrefix, "bin", "python3");
  if (isUsable(destPrefix, arch)) {
    chmodBins(destPrefix);
    return bin;
  }
  const staging = mkdtempSync(path.join(tmpdir(), "eth-scanner-cpython-"));
  const tarFile = path.join(staging, "python.tar.gz");
  try {
    await download(arch, tarFile);
    if (existsSync(destPrefix)) rmSync(destPrefix, { recursive: true, force: true });
    extract(tarFile, destPrefix);
    slim(destPrefix);
    chmodBins(destPrefix);
    writeFileSync(stampPath(destPrefix), `${bundleId(arch)}\n`);
    if (!existsSync(bin)) throw new Error("portable CPython extract missing bin/python3");
    return bin;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const destIdx = argv.indexOf("--dest");
  return {
    force: argv.includes("--force") || process.env.VERCEL === "1" || process.env.ETH_SCANNER_BUNDLE_PYTHON === "1",
    dest: destIdx >= 0 ? argv[destIdx + 1] : defaultPrefix(),
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { force, dest } = parseArgs(process.argv.slice(2));
  if (!force) {
    console.log("bundle-python-runtime: skip (set ETH_SCANNER_BUNDLE_PYTHON=1, pass --force, or run on Vercel)");
    process.exit(0);
  }
  ensurePortablePython(dest)
    .then((bin) => {
      console.log(`bundle-python-runtime: ${bin}`);
    })
    .catch((err) => {
      console.error(`bundle-python-runtime: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
