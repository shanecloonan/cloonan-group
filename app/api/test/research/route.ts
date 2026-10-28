/**
 * Research-stack dry-run for /test. Defensive only.
 * GET lists last receipts. POST runs python -m eth_scanner.research.
 */

import { NextResponse } from "next/server";
import { capabilityNote, pythonCapability, researchFixtureCatalog, scannerCapabilities } from "@/lib/eth-scanner/capabilities";
import { latestResearchReceipt, listResearchReceipts } from "@/lib/eth-scanner/local-store";
import { runResearch } from "@/lib/eth-scanner/run-research";
import { scanInFlight } from "@/lib/eth-scanner/scan-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function summarize(receipt: ReturnType<typeof latestResearchReceipt>) {
  if (!receipt) return null;
  const payload = receipt.json || {};
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const skipped = Array.isArray(payload.layers_skipped) ? payload.layers_skipped : [];
  return {
    address: receipt.address,
    filename: receipt.filename,
    gated: Boolean(payload.gated),
    gate_reason: payload.gate_reason == null ? "" : String(payload.gate_reason),
    role: payload.role == null ? null : String(payload.role),
    scope: payload.scope == null ? null : String(payload.scope),
    layers_run: Array.isArray(payload.layers_run) ? payload.layers_run.map(String) : [],
    layers_skipped: skipped,
    findings_count: findings.length,
    findings: findings.slice(0, 40),
    notes: Array.isArray(payload.notes) ? payload.notes.map(String).slice(0, 12) : [],
    receipt_url: receipt.address
      ? `/api/test/receipt?address=${encodeURIComponent(receipt.address)}&kind=research`
      : null,
    stack_version: payload.stack_version == null ? null : String(payload.stack_version),
  };
}

export async function GET() {
  const caps = scannerCapabilities();
  const latest = latestResearchReceipt();
  return json({
    ok: true,
    ...caps,
    dry_run: true,
    python_runtime: pythonCapability(),
    running: scanInFlight(),
    fixtures: researchFixtureCatalog(),
    receipts: listResearchReceipts(20),
    latest: summarize(latest),
    note: `${capabilityNote(caps)} Research runs are dry-run. Optional forge/echidna/halmos/hevm skip when missing.`,
  });
}

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "expected a JSON object" }, 400);
  }
  const { address, fixture } = body as { address?: unknown; fixture?: unknown };
  if (scanInFlight()) {
    return json({ ok: false, error: "a scan is already running" }, 429);
  }

  const out = await runResearch({
    address: typeof address === "string" ? address : undefined,
    fixture: typeof fixture === "string" ? fixture : undefined,
  });
  if (!out.ok) {
    const status = /already running/.test(out.error)
      ? 429
      : /pass a 0x|unknown fixture/.test(out.error)
        ? 400
        : /unavailable|not importable|could not start|no system Python|portable CPython/.test(out.error)
          ? 503
          : 500;
    return json({ ...out, note: capabilityNote(out) }, status);
  }
  return json({
    ...out,
    note: capabilityNote(out),
    receipt_url: `/api/test/receipt?address=${encodeURIComponent(out.result.address)}&kind=research`,
  });
}
