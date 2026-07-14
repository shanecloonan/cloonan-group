import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin HTTPS bridge → Hetzner observer HTTP JSON-RPC proxy.
 * Browsers on HTTPS pages cannot call http://5.161.201.73:8787 (mixed content);
 * this route fetches the upstream proxy server-side.
 */
const DEFAULT_UPSTREAM = "http://5.161.201.73:8787/rpc";

const PUBLIC_SAFE = new Set([
  "get_block",
  "get_block_header",
  "get_block_evolution",
  "get_block_headers",
  "get_block_txs",
  "get_chain_params",
  "get_claims_by_pubkey",
  "get_claims_for",
  "get_checkpoint",
  "get_light_checkpoint_summary",
  "get_light_follow",
  "get_light_snapshot",
  "get_mempool",
  "get_mempool_tx",
  "get_proof_pool",
  "get_storage_challenge",
  "get_status",
  "get_tip",
  "list_data_roots_with_claims",
  "list_fraud_contests",
  "list_methods",
  "list_recent_claims",
  "list_recent_uploads",
  "list_utxos",
  // Browser wallet submit (testnet faucet/demo only).
  "submit_tx",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function upstreamUrl(): string {
  return (
    process.env.MFND_RPC_PROXY_UPSTREAM?.trim() ||
    process.env.MFND_OBSERVER_RPC_URL?.trim() ||
    DEFAULT_UPSTREAM
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }

  const method =
    body && typeof body === "object" && "method" in body
      ? String((body as { method?: unknown }).method ?? "")
      : "";

  if (!PUBLIC_SAFE.has(method)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id:
          body && typeof body === "object" && "id" in body
            ? (body as { id: unknown }).id
            : null,
        error: {
          code: -32601,
          message: `method not allowed: ${method || "(missing)"}`,
        },
      },
      { status: 403 },
    );
  }

  const upstream = upstreamUrl();
  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = (await res.text()).trim();
    if (!res.ok) {
      return new NextResponse(text || `upstream HTTP ${res.status}`, {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new NextResponse(text.endsWith("\n") ? text : `${text}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id:
          body && typeof body === "object" && "id" in body
            ? (body as { id: unknown }).id
            : null,
        error: { code: -32000, message: `upstream unreachable: ${msg}` },
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    upstream: upstreamUrl(),
    note: "POST JSON-RPC to this path; public-safe methods only",
  });
}
