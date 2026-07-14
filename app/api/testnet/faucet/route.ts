import { NextRequest, NextResponse } from "next/server";

/**
 * Same-origin HTTPS bridge → VPS faucet-http.mjs (holds faucet keys server-side).
 */
const DEFAULT_UPSTREAM = "http://5.161.201.73:8788/faucet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function upstreamUrl(): string {
  return (
    process.env.MFND_FAUCET_UPSTREAM?.trim() ||
    process.env.NEXT_PUBLIC_MFND_FAUCET_URL?.trim() ||
    DEFAULT_UPSTREAM
  );
}

export async function GET() {
  const health = upstreamUrl().replace(/\/faucet\/?$/, "/health");
  try {
    const res = await fetch(health, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `faucet upstream unreachable: ${msg}` },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const upstream = upstreamUrl();
  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(170_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `faucet upstream unreachable: ${msg}` },
      { status: 502 },
    );
  }
}
