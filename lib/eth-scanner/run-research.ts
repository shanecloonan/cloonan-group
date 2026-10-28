/**
 * Spawn the research stack (python -m eth_scanner.research). Defensive only.
 * Never logs secret values. Dry-run is the default for /test.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  LANE_A_FIXTURES,
  RESEARCH_FIXTURES,
  type ResearchFixtureId,
  scannerCapabilities,
  type ScannerCapabilities,
} from "./capabilities";
import { workRoot } from "./local-store";
import {
  canLazyInstallPython,
  ensurePortablePython,
  lazyPythonPrefix,
  listPythonCandidates,
  missingPythonError,
  pythonHomeFor,
  type PythonCandidate,
} from "./python-runtime";
import { acquireScan, releaseScan, scanInFlight } from "./scan-lock";
import { ETH_ADDRESS_RE, FIXTURE_PLACEHOLDER, redactScannerText } from "./run-lane-a";

export { ETH_ADDRESS_RE, FIXTURE_PLACEHOLDER };

const SCAN_TIMEOUT_MS = 180_000;

export type ResearchFinding = {
  id: string;
  severity: string;
  layer: string;
  title: string;
  evidence: string;
  address: string;
  detector: string;
  defensive_only: boolean;
};

export type ResearchLayerSkip = { layer: string; reason: string };

export type ResearchResult = {
  address: string;
  gated: boolean;
  gate_reason: string;
  role: string | null;
  scope: string | null;
  layers_run: string[];
  layers_skipped: ResearchLayerSkip[];
  findings: ResearchFinding[];
  notes: string[];
  receipt_md_path: string | null;
  receipt_json_path: string | null;
  defensive_only: boolean;
};

export type ResearchRunInput = {
  address?: string;
  fixture?: string;
};

export type ResearchRunOk = {
  ok: true;
  dry_run: boolean;
  live_ingest: boolean;
  persist_remote: boolean;
  fixture: string | null;
  result: ResearchResult;
};

export type ResearchRunErr = {
  ok: false;
  error: string;
  dry_run: boolean;
  live_ingest: boolean;
  persist_remote: boolean;
};

export function resolveResearchFixture(id: string | undefined): { id: string; abs: string } | null {
  if (!id) return null;
  const catalogs: Record<string, { file: string }> = { ...RESEARCH_FIXTURES, ...LANE_A_FIXTURES };
  if (!(id in catalogs)) return null;
  const file = catalogs[id].file;
  const root = path.resolve(process.cwd(), "eth-scanner", "tests", "fixtures");
  const abs = path.resolve(root, file);
  if (!abs.startsWith(root + path.sep) || !existsSync(abs)) return null;
  return { id, abs };
}

export function extractJsonObject(stdout: string): unknown {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("research stack produced no JSON result");
  return JSON.parse(trimmed.slice(start, end + 1));
}

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n) => n != null && String(n).trim()).map((n) => redactScannerText(String(n)));
}

function asSkips(raw: unknown): ResearchLayerSkip[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as { layer?: unknown; reason?: unknown };
      return { layer: String(r.layer || ""), reason: redactScannerText(String(r.reason || "")) };
    });
}

function asFindings(raw: unknown): ResearchFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id || ""),
        severity: String(r.severity || "info"),
        layer: String(r.layer || ""),
        title: String(r.title || ""),
        evidence: redactScannerText(String(r.evidence || "")),
        address: String(r.address || ""),
        detector: String(r.detector || ""),
        defensive_only: true,
      };
    });
}

function shapeResult(row: Record<string, unknown>, address: string): ResearchResult {
  return {
    address,
    gated: Boolean(row.gated),
    gate_reason: String(row.gate_reason || ""),
    role: row.role == null ? null : String(row.role),
    scope: row.scope == null ? null : String(row.scope),
    layers_run: asStringList(row.layers_run),
    layers_skipped: asSkips(row.layers_skipped),
    findings: asFindings(row.findings),
    notes: asStringList(row.notes),
    receipt_md_path: row.receipt_md_path == null ? null : String(row.receipt_md_path),
    receipt_json_path: row.receipt_json_path == null ? null : String(row.receipt_json_path),
    defensive_only: true,
  };
}

function envForPython(base: NodeJS.ProcessEnv, candidate: PythonCandidate): NodeJS.ProcessEnv {
  const home = pythonHomeFor(candidate.source, candidate.bin);
  if (!home) return base;
  return { ...base, PYTHONHOME: home };
}

function spawnResearch(
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
      reject(new Error(`research stack timed out after ${SCAN_TIMEOUT_MS / 1000}s`));
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

export async function runResearch(input: ResearchRunInput): Promise<ResearchRunOk | ResearchRunErr> {
  const caps: ScannerCapabilities = scannerCapabilities();
  const fail = (error: string): ResearchRunErr => ({
    ok: false,
    error,
    dry_run: true,
    live_ingest: caps.live_ingest,
    persist_remote: caps.persist_remote,
  });

  if (scanInFlight()) return fail("a scan is already running");

  let address = typeof input.address === "string" && ETH_ADDRESS_RE.test(input.address.trim())
    ? input.address.trim().toLowerCase()
    : null;
  const fixture = resolveResearchFixture(input.fixture);
  if (input.fixture && !fixture) return fail("unknown fixture — pick a listed local demo source");
  if (!address && fixture) address = FIXTURE_PLACEHOLDER;
  if (!address) return fail("pass a 0x… address (40 hex chars) or pick a local fixture");

  const work = workRoot();
  const pythonPath = path.join(process.cwd(), "eth-scanner", "src");
  const args = [
    "-m",
    "eth_scanner.research",
    "run",
    "--address",
    address,
    "--dry-run",
  ];
  if (fixture) args.push("--source", fixture.abs);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: pythonPath,
    PYTHONUNBUFFERED: "1",
    ETH_SCANNER_WORK_DIR: work,
  };

  if (!acquireScan()) return fail("a scan is already running");
  try {
    const candidates = listPythonCandidates();
    const ran = await tryCandidates(candidates, args, env, address, fixture?.id ?? null, caps);
    if (ran.ok || ran.giveUp) return ran.out;

    if (canLazyInstallPython() && !candidates.some((c) => c.source === "bundled" || c.source === "lazy")) {
      try {
        const bin = ensurePortablePython({ destPrefix: lazyPythonPrefix() });
        const lazy: PythonCandidate = { bin, source: "lazy" };
        const again = await tryCandidates([lazy], args, env, address, fixture?.id ?? null, caps);
        if (again.ok || again.giveUp) return again.out;
        return fail(missingPythonError(again.lastErr, [...candidates, lazy].map((c) => c.bin)));
      } catch (err) {
        const why = err instanceof Error ? err.message : "portable CPython install failed";
        return fail(
          missingPythonError(`${ran.lastErr}; lazy install failed: ${redactScannerText(why)}`, candidates.map((c) => c.bin)),
        );
      }
    }
    return fail(missingPythonError(ran.lastErr, candidates.map((c) => c.bin)));
  } finally {
    releaseScan();
  }
}

type Attempt =
  | { ok: true; out: ResearchRunOk; lastErr: string; giveUp: false }
  | { ok: false; out: ResearchRunErr; lastErr: string; giveUp: true }
  | { ok: false; out: ResearchRunErr; lastErr: string; giveUp: false };

async function tryCandidates(
  candidates: PythonCandidate[],
  args: string[],
  env: NodeJS.ProcessEnv,
  address: string,
  fixtureId: string | null,
  caps: ScannerCapabilities,
): Promise<Attempt> {
  const fail = (error: string): ResearchRunErr => ({
    ok: false,
    error,
    dry_run: true,
    live_ingest: caps.live_ingest,
    persist_remote: caps.persist_remote,
  });
  let lastErr = "python -m eth_scanner.research unavailable";
  for (const candidate of candidates) {
    const ran = await spawnResearch(candidate.bin, args, envForPython(env, candidate));
    if (!ran.spawned) {
      lastErr = `could not start ${candidate.bin}`;
      continue;
    }
    if (ran.code !== 0) {
      const snippet = redactScannerText((ran.stderr || ran.stdout || "").trim()).slice(-400);
      const importMiss = /ModuleNotFoundError|No module named/i.test(ran.stderr);
      return {
        ok: false,
        giveUp: true,
        lastErr: snippet,
        out: fail(
          importMiss
            ? "python -m eth_scanner.research is not importable — set PYTHONPATH to eth-scanner/src or ETH_SCANNER_PYTHON"
            : `research stack exited ${ran.code}${snippet ? `: ${snippet}` : ""}`,
        ),
      };
    }
    try {
      const payload = extractJsonObject(ran.stdout);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("research stack returned a non-object JSON result");
      }
      return {
        ok: true,
        giveUp: false,
        lastErr: "",
        out: {
          ok: true,
          dry_run: true,
          live_ingest: caps.live_ingest && !fixtureId,
          persist_remote: caps.persist_remote,
          fixture: fixtureId,
          result: shapeResult(payload as Record<string, unknown>, address),
        },
      };
    } catch (err) {
      return {
        ok: false,
        giveUp: true,
        lastErr: err instanceof Error ? err.message : "could not parse research JSON",
        out: fail(err instanceof Error ? err.message : "could not parse research JSON"),
      };
    }
  }
  return { ok: false, giveUp: false, lastErr, out: fail(lastErr) };
}

export type { ResearchFixtureId };
