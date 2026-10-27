/**
 * Read the local dry-run JSON + Markdown receipts written by the Python CLI.
 * Used by /api/test when SUPABASE_SERVICE_ROLE_KEY is unset.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

export type DryRunStore = {
  targets: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  results: Record<string, unknown>[];
};

function workRoot(): string {
  return process.env.ETH_SCANNER_WORK_DIR || path.join(process.cwd(), "eth-scanner", "work");
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
