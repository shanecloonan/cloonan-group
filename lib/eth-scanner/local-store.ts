/**
 * Read the local dry-run JSON + Markdown receipts written by the Python CLI.
 * Used by /api/test when SUPABASE_SERVICE_ROLE_KEY is unset.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

export type DryRunStore = {
  targets: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  results: Record<string, unknown>[];
};

let cachedWorkRoot: string | null = null;

function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-probe");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Writable work dir for dry-run JSON + receipts. Falls back to /tmp on read-only hosts. */
export function workRoot(): string {
  if (cachedWorkRoot) return cachedWorkRoot;
  const fromEnv = process.env.ETH_SCANNER_WORK_DIR?.trim();
  if (fromEnv) {
    cachedWorkRoot = fromEnv;
    return cachedWorkRoot;
  }
  const local = path.join(process.cwd(), "eth-scanner", "work");
  if (canWriteDir(local)) {
    cachedWorkRoot = local;
    return cachedWorkRoot;
  }
  const fallback = path.join(tmpdir(), "eth-scanner-work");
  mkdirSync(fallback, { recursive: true });
  process.env.ETH_SCANNER_WORK_DIR = fallback;
  cachedWorkRoot = fallback;
  return cachedWorkRoot;
}

export function dryRunStorePath(): string {
  return path.join(workRoot(), "dry-run-store.json");
}

export function receiptsDir(): string {
  return path.join(workRoot(), "receipts");
}

export function loadDryRunStore(): DryRunStore | null {
  const p = dryRunStorePath();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as Partial<DryRunStore>;
    return {
      targets: Array.isArray(data.targets) ? data.targets : [],
      artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
      results: Array.isArray(data.results) ? data.results : [],
    };
  } catch {
    return null;
  }
}

export function latestWrittenReceipt(address: string): { markdown: string; filename: string } | null {
  const dir = receiptsDir();
  if (!existsSync(dir)) return null;
  const needle = `receipt-${address.toLowerCase()}-`;
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(needle) && name.endsWith(".md"))
    .map((name) => {
      const full = path.join(dir, name);
      return { name, full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  return {
    markdown: readFileSync(files[0].full, "utf-8"),
    filename: files[0].name,
  };
}

export type ResearchReceiptFile = {
  filename: string;
  address: string;
  mtime: number;
  markdown?: string;
  json?: Record<string, unknown> | null;
};

const RESEARCH_NAME = /^research-(0x[a-f0-9]{40})-/i;

export function listResearchReceipts(limit = 20): ResearchReceiptFile[] {
  const dir = receiptsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("research-") && name.endsWith(".md"))
    .map((name) => {
      const full = path.join(dir, name);
      const m = RESEARCH_NAME.exec(name);
      return {
        filename: name,
        address: (m?.[1] || "").toLowerCase(),
        mtime: statSync(full).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function latestResearchReceipt(address?: string): {
  markdown: string;
  filename: string;
  json: Record<string, unknown> | null;
  address: string;
} | null {
  const dir = receiptsDir();
  if (!existsSync(dir)) return null;
  const needle = address ? `research-${address.toLowerCase()}-` : "research-";
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(needle) && name.endsWith(".md"))
    .map((name) => {
      const full = path.join(dir, name);
      return { name, full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;
  const md = readFileSync(files[0].full, "utf-8");
  const jsonPath = files[0].full.replace(/\.md$/, ".json");
  let json: Record<string, unknown> | null = null;
  if (existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      json = null;
    }
  }
  const m = RESEARCH_NAME.exec(files[0].name);
  return {
    markdown: md,
    filename: files[0].name,
    json,
    address: (m?.[1] || address || "").toLowerCase(),
  };
}

export function pickSourceArtifact(artifacts: Record<string, unknown>[], address: string) {
  const prefer: Record<string, number> = { source: 0, decompile: 1 };
  const ranked = artifacts
    .filter((a) => String(a.address || "").toLowerCase() === address.toLowerCase())
    .filter((a) => String(a.kind) in prefer)
    .sort((a, b) => {
      const ka = prefer[String(a.kind)] ?? 9;
      const kb = prefer[String(b.kind)] ?? 9;
      if (ka !== kb) return ka - kb;
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  const row = ranked[0];
  if (!row) return null;
  const payload =
    row.path_or_json && typeof row.path_or_json === "object"
      ? { ...(row.path_or_json as Record<string, unknown>) }
      : {};
  delete payload.content;
  return {
    kind: (payload.kind as string) || (row.kind as string) || null,
    tool: (payload.tool as string) || null,
    src_confidence: (payload.src_confidence as string) || (row.confidence as string) || null,
    verified_match: (payload.verified_match as string) || null,
    language: (payload.language as string) || null,
    compiler: (payload.compiler as string) || null,
    contract_name: (payload.contract_name as string) || null,
    is_proxy: Boolean(payload.is_proxy),
    implementation: (payload.implementation as string) || null,
    notes: (payload.notes as string[] | string) || null,
  };
}
