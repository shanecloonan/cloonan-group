/**
 * Spawn Lane A (python -m eth_scanner). Defensive only — one address, no shell.
 * Never logs secret values. Live persist / ingest follow env; dry-run is the fallback.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { LANE_A_FIXTURES, type FixtureId, scannerCapabilities, type ScannerCapabilities } from "./capabilities";
import { workRoot } from "./local-store";

export const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const FIXTURE_PLACEHOLDER = "0x1111111111111111111111111111111111111111";
const SCAN_TIMEOUT_MS = 120_000;
const SECRET_VALUE =
  /(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|(?:sk[_-][A-Za-z0-9]{16,})|(?:Bearer\s+[A-Za-z0-9._\-]+)/gi;
const SECRET_PAIR =
  /((?:api[_-]?key|user[_-]?key|service[_-]?role|secret|token|password|mnemonic)[^\s=]*)\s*[:=]\s*\S+/gi;

export type LaneARunInput = {
  address?: string;
  tvl?: number;
  fixture?: string;
};

export type LaneAResult = {
  address: string;
  bucket: string | null;
  dropped: boolean;
  drop_reason: string | null;
  heat: number | null;
  src_confidence: string | null;
  ir_confidence: string | null;
  value_movers: string[];
  contract_class: string | null;
  scope: string | null;
  notes: string[];
};

export type LaneARunOk = {
  ok: true;
  dry_run: boolean;
  live_ingest: boolean;
  persist_remote: boolean;
  fixture: FixtureId | null;
  result: LaneAResult;
};

export type LaneARunErr = {
  ok: false;
  error: string;
  dry_run: boolean;
  live_ingest: boolean;
  persist_remote: boolean;
};

let inflight = false;

export function scanInFlight(): boolean {
  return inflight;
}

export function normalizeScanAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!ETH_ADDRESS_RE.test(s)) return null;
  return s.toLowerCase();
}

export function parseTvl(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) {
    throw new Error("tvl must be a finite number ≥ 0");
  }
  return n;
}

export function resolveFixture(id: string | undefined): { id: FixtureId; abs: string } | null {
  if (!id) return null;
  if (!(id in LANE_A_FIXTURES)) return null;
  const file = LANE_A_FIXTURES[id as FixtureId].file;
  const root = path.resolve(process.cwd(), "eth-scanner", "tests", "fixtures");
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep) || !existsSync(abs)) return null;
  return { id: id as FixtureId, abs };
}

export function redactScannerText(text: string): string {
  return text.replace(SECRET_VALUE, "[redacted]").replace(SECRET_PAIR, "$1=[redacted]");
}

export function extractJsonArray(stdout: string): unknown {
  const trimmed = stdout.trim();
  const fromNl = trimmed.lastIndexOf("\n[");
  const start = fromNl >= 0 ? fromNl + 1 : trimmed.indexOf("[");
  if (start < 0) throw new Error("scanner produced no JSON result");
  return JSON.parse(trimmed.slice(start));
}

function pickResult(payload: unknown, address: string): Record<string, unknown> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("scanner returned an empty result list");
  }
  const match = payload.find((row) => {
    return row && typeof row === "object" && String((row as { address?: string }).address || "").toLowerCase() === address;
  });
  const row = (match || payload[0]) as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new Error("scanner result was not an object");
  return row;
}

function asNotes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((n) => n != null && String(n).trim()).map((n) => redactScannerText(String(n)));
  if (raw == null || raw === "") return [];
  return String(raw)
    .split("\n")
    .map((l) => redactScannerText(l.trim()))
    .filter(Boolean);
}

function asMovers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => String(m)).filter(Boolean).slice(0, 40);
}

function shapeResult(row: Record<string, unknown>, address: string): LaneAResult {
  return {
    address,
    bucket: row.bucket == null ? null : String(row.bucket),
    dropped: Boolean(row.dropped),
    drop_reason: row.drop_reason == null ? null : String(row.drop_reason),
    heat: typeof row.heat === "number" && Number.isFinite(row.heat) ? row.heat : Number(row.heat) || 0,
    src_confidence: row.src_confidence == null ? null : String(row.src_confidence),
    ir_confidence: row.ir_confidence == null ? null : String(row.ir_confidence),
    value_movers: asMovers(row.value_movers),
    contract_class: row.contract_class == null ? null : String(row.contract_class),
    scope: row.scope == null ? null : String(row.scope),
    notes: asNotes(row.notes),
  };
}

function pythonCandidates(): string[] {
  const preferred = process.env.ETH_SCANNER_PYTHON?.trim();
  return preferred ? [preferred] : ["python3", "python"];
}

function spawnLaneA(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string; spawned: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: path.join(process.cwd(), "eth-scanner"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Lane A timed out after ${SCAN_TIMEOUT_MS / 1000}s`));
    }, SCAN_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(-80_000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: err.message, spawned: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, spawned: true });
    });
  });
}

export async function runLaneA(input: LaneARunInput): Promise<LaneARunOk | LaneARunErr> {
  const caps: ScannerCapabilities = scannerCapabilities();
  const fail = (error: string): LaneARunErr => ({
    ok: false,
    error,
    dry_run: caps.dry_run,
    live_ingest: caps.live_ingest,
    persist_remote: caps.persist_remote,
  });

  if (inflight) return fail("a Lane A scan is already running");

  let address = normalizeScanAddress(input.address);
  const fixture = resolveFixture(input.fixture);
  if (input.fixture && !fixture) return fail("unknown fixture — pick a listed local demo source");
  if (!address && fixture) address = FIXTURE_PLACEHOLDER;
  if (!address) return fail("pass a 0x… address (40 hex chars) or pick a local fixture");

  let tvl: number | undefined;
  try {
    tvl = parseTvl(input.tvl);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "invalid tvl");
  }

  const work = workRoot();
  const pythonPath = path.join(process.cwd(), "eth-scanner", "src");
  const args = ["-m", "eth_scanner", "lane-a", "--address", address];
  if (tvl != null) args.push("--tvl", String(tvl));
  if (fixture) args.push("--source", fixture.abs);
  if (caps.dry_run) args.push("--dry-run");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: pythonPath,
    PYTHONUNBUFFERED: "1",
    ETH_SCANNER_WORK_DIR: work,
  };

  inflight = true;
  try {
    let lastErr = "python -m eth_scanner unavailable";
    for (const bin of pythonCandidates()) {
      const ran = await spawnLaneA(bin, args, env);
      if (!ran.spawned) {
        lastErr = `could not start ${bin}`;
        continue;
      }
      if (ran.code !== 0) {
        const snippet = redactScannerText((ran.stderr || ran.stdout || "").trim()).slice(-400);
        const importMiss = /ModuleNotFoundError|No module named/i.test(ran.stderr);
        return fail(
          importMiss
            ? "python -m eth_scanner is not importable — set PYTHONPATH to eth-scanner/src or ETH_SCANNER_PYTHON"
            : `Lane A exited ${ran.code}${snippet ? `: ${snippet}` : ""}`,
        );
      }
      try {
        const payload = extractJsonArray(ran.stdout);
        const row = pickResult(payload, address);
        return {
          ok: true,
          dry_run: caps.dry_run,
          live_ingest: caps.live_ingest && !fixture,
          persist_remote: caps.persist_remote,
          fixture: fixture?.id ?? null,
          result: shapeResult(row, address),
        };
      } catch (err) {
        return fail(err instanceof Error ? err.message : "could not parse scanner JSON");
      }
    }
    return fail(`${lastErr}. Install Python 3 or set ETH_SCANNER_PYTHON.`);
  } finally {
    inflight = false;
  }
}
