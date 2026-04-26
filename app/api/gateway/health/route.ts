/**
 * Server-side health check for the self-hosted Arweave gateway + pool.
 *
 * Runs from the Vercel edge (not the browser), which avoids CORS on admin
 * endpoints and keeps the ADMIN_API_KEY out of client bundles.
 *
 * GET /api/gateway/health
 *   -> {
 *        primary: { configured, url, healthy, height, release, latencyMs, blockList }
 *        pool:    [{ url, healthy, height, latencyMs, error? }, ...]
 *        network: { height }    // from trusted upstream
 *      }
 */

import { NextResponse } from "next/server";
import { ARWEAVE_PRIMARY_GATEWAY, ARWEAVE_DIRECT_GATEWAYS } from "@/lib/config";

export const runtime = "edge";
export const revalidate = 0;
export const dynamic = "force-dynamic";

const ADMIN_KEY = process.env.ARWEAVE_GATEWAY_ADMIN_KEY || "";
const UPSTREAM_HEIGHT_URL = "https://arweave.net/info";

interface ArIoInfo {
  wallet?: string;
  processId?: string;
  release?: number;
  blockHeight?: number;
  height?: number;
  supportedManifestVersions?: string[];
}

async function checkOne(url: string, timeoutMs = 6000): Promise<{
  url: string;
  healthy: boolean;
  height: number | null;
  release: number | null;
  latencyMs: number;
  error?: string;
}> {
  const start = performance.now();
  try {
    // Prefer the ar.io info endpoint (richer), fall back to plain /info.
    let res = await fetch(`${url}/ar-io/info`, { signal: AbortSignal.timeout(timeoutMs) });
    let info: ArIoInfo | null = null;
    if (res.ok) {
      info = await res.json();
    } else {
      res = await fetch(`${url}/info`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        return {
          url,
          healthy: false,
          height: null,
          release: null,
          latencyMs: Math.round(performance.now() - start),
          error: `HTTP ${res.status}`,
        };
      }
      info = await res.json();
    }

    const latencyMs = Math.round(performance.now() - start);
    return {
      url,
      healthy: true,
      height: info?.blockHeight ?? info?.height ?? null,
      release: info?.release ?? null,
      latencyMs,
    };
  } catch (e) {
    return {
      url,
      healthy: false,
      height: null,
      release: null,
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

async function fetchBlockListSize(primaryUrl: string): Promise<number | null> {
  if (!ADMIN_KEY) return null;
  try {
    const res = await fetch(`${primaryUrl}/ar-io/admin/block-list`, {
      signal: AbortSignal.timeout(6000),
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ids?: unknown[]; names?: unknown[] };
    const ids = Array.isArray(body.ids) ? body.ids.length : 0;
    const names = Array.isArray(body.names) ? body.names.length : 0;
    return ids + names;
  } catch {
    return null;
  }
}

export async function GET() {
  const primaryUrl = ARWEAVE_PRIMARY_GATEWAY || null;

  // Kick everything off in parallel.
  const upstreamPromise = fetch(UPSTREAM_HEIGHT_URL, { signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const primaryPromise = primaryUrl ? checkOne(primaryUrl) : Promise.resolve(null);
  const poolPromise = Promise.all(ARWEAVE_DIRECT_GATEWAYS.map((g) => checkOne(g)));
  const blockListPromise = primaryUrl ? fetchBlockListSize(primaryUrl) : Promise.resolve(null);

  const [upstreamInfo, primary, pool, blockListSize] = await Promise.all([
    upstreamPromise,
    primaryPromise,
    poolPromise,
    blockListPromise,
  ]);

  const networkHeight: number | null = (upstreamInfo as { height?: number } | null)?.height ?? null;

  return NextResponse.json(
    {
      configured: !!primaryUrl,
      primary: primary
        ? {
            ...primary,
            blockList: blockListSize, // null when admin key isn't configured server-side
            syncLag:
              networkHeight != null && primary.height != null
                ? Math.max(0, networkHeight - primary.height)
                : null,
          }
        : null,
      pool,
      network: { height: networkHeight },
      checkedAt: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
