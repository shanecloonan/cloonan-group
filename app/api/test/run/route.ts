/**
 * Kick a Lane A scan for one /test address (or a whitelisted local fixture).
 * Defensive only. Spawns python -m eth_scanner (system Python or the
 * portable CPython bundled for Vercel). Never a scanner runtime on GET.
 */

import { NextResponse } from "next/server";
import { capabilityNote, fixtureCatalog, pythonCapability, scannerCapabilities } from "@/lib/eth-scanner/capabilities";
import { runLaneA, scanInFlight } from "@/lib/eth-scanner/run-lane-a";

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

export async function GET() {
  const caps = scannerCapabilities();
  return json({
    ok: true,
    ...caps,
    python_runtime: pythonCapability(),
    running: scanInFlight(),
    fixtures: fixtureCatalog(),
    note: capabilityNote(caps),
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
  const { address, tvl, fixture } = body as { address?: unknown; tvl?: unknown; fixture?: unknown };
  if (scanInFlight()) {
    return json({ ok: false, error: "a Lane A scan is already running" }, 429);
  }

  const out = await runLaneA({
    address: typeof address === "string" ? address : undefined,
    tvl: typeof tvl === "number" || typeof tvl === "string" ? Number(tvl) : undefined,
    fixture: typeof fixture === "string" ? fixture : undefined,
  });
  if (!out.ok) {
    const status = /already running/.test(out.error)
      ? 429
      : /pass a 0x|unknown fixture|tvl must/.test(out.error)
        ? 400
        : /unavailable|not importable|could not start|no system Python|portable CPython/.test(out.error)
          ? 503
          : 500;
    return json({ ...out, note: capabilityNote(out) }, status);
  }
  return json({
    ...out,
    note: capabilityNote(out),
    receipt_url: `/api/test/receipt?address=${encodeURIComponent(out.result.address)}`,
  });
}
