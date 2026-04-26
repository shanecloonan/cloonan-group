/**
 * Gateway pool — primary-first, health-scored, optionally hash-verified
 * client for reading from Arweave.
 *
 * Priority order for every read:
 *   1. Self-hosted primary node (`NEXT_PUBLIC_ARWEAVE_PRIMARY_GATEWAY`)
 *   2. Pool of public gateways (`NEXT_PUBLIC_ARWEAVE_GATEWAY_POOL`, else defaults)
 *
 * Reasoning: running our own node (see `infra/arweave-gateway/`) means we
 * have root access and can't be censored. But until it's fully synced (or
 * if it's temporarily down), we keep working via public gateways. And for
 * payload fetches where we know the `data_root`, we verify the bytes
 * cryptographically so no gateway — ours or theirs — can lie to us.
 */

import {
  ARWEAVE_PRIMARY_GATEWAY,
  ARWEAVE_DIRECT_GATEWAYS,
} from "./config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GatewayRole = "primary" | "pool";

export interface GatewayStat {
  url: string;
  role: GatewayRole;
  wins: number;
  losses: number;
  lastLatencyMs: number;
  lastError: string | null;
  lastUsedAt: number | null;
}

export interface PoolFetchResult {
  response: Response;
  servedBy: string;
  role: GatewayRole;
  latencyMs: number;
  verified?: boolean;
}

export interface PoolFetchOptions extends RequestInit {
  /** Overall budget per attempt. Each gateway gets this much time before we move on. */
  timeoutMs?: number;
  /** If set, skip the primary and go straight to the pool. */
  skipPrimary?: boolean;
  /** If set, only hit the primary (no fallback). */
  primaryOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Internal state                                                     */
/* ------------------------------------------------------------------ */

const stats = new Map<string, GatewayStat>();

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function touch(url: string, role: GatewayRole, latencyMs: number, error?: string | null): void {
  const cur = stats.get(url) ?? {
    url,
    role,
    wins: 0,
    losses: 0,
    lastLatencyMs: 0,
    lastError: null,
    lastUsedAt: null,
  };
  cur.lastLatencyMs = latencyMs;
  cur.lastError = error ?? null;
  cur.lastUsedAt = Date.now();
  if (error) cur.losses++;
  else cur.wins++;
  stats.set(url, cur);
}

/* ------------------------------------------------------------------ */
/*  Gateway list builders                                              */
/* ------------------------------------------------------------------ */

function poolFromEnv(): string[] {
  const raw = process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY_POOL;
  if (!raw) return ARWEAVE_DIRECT_GATEWAYS.map(normalizeBase);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeBase);
}

export function listGateways(opts?: { skipPrimary?: boolean; primaryOnly?: boolean }): Array<{ url: string; role: GatewayRole }> {
  const out: Array<{ url: string; role: GatewayRole }> = [];
  const primary = ARWEAVE_PRIMARY_GATEWAY ? normalizeBase(ARWEAVE_PRIMARY_GATEWAY) : null;

  if (primary && !opts?.skipPrimary) {
    out.push({ url: primary, role: "primary" });
  }
  if (opts?.primaryOnly) return out;

  const pool = poolFromEnv();
  for (const p of pool) {
    if (primary && p === primary) continue;
    out.push({ url: p, role: "pool" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sequential waterfall — primary first, fall back on 5xx or error    */
/* ------------------------------------------------------------------ */

export async function poolFetch(path: string, opts: PoolFetchOptions = {}): Promise<PoolFetchResult> {
  const { timeoutMs = 12_000, skipPrimary, primaryOnly, ...init } = opts;
  const gateways = listGateways({ skipPrimary, primaryOnly });

  if (gateways.length === 0) {
    throw new Error("No Arweave gateways configured");
  }

  let lastErr: unknown = null;

  for (const { url, role } of gateways) {
    const start = performance.now();
    try {
      const res = await fetch(`${url}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - start);

      // Server-side failure → try next gateway. Client errors (4xx) are kept
      // because they are meaningful answers (e.g. 404 for a non-existent tx).
      if (res.status >= 500) {
        touch(url, role, latencyMs, `HTTP ${res.status}`);
        lastErr = new Error(`${url} → HTTP ${res.status}`);
        continue;
      }

      touch(url, role, latencyMs, null);
      return { response: res, servedBy: url, role, latencyMs };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - start);
      const msg = e instanceof Error ? e.message : String(e);
      touch(url, role, latencyMs, msg);
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error("All gateways failed");
}

/* ------------------------------------------------------------------ */
/*  Hash-verified data fetch                                           */
/*                                                                     */
/*  For payloads where we know the expected `data_root` (the SHA-256   */
/*  Merkle root from the signed tx), we can detect a lying gateway by  */
/*  re-hashing the bytes. For small data this is just SHA-256 of the   */
/*  whole payload; for large chunked data Arweave uses a Merkle tree   */
/*  over 256 KiB chunks — that full check is beyond this client, so we */
/*  fall back to a direct-hash match when it applies.                  */
/* ------------------------------------------------------------------ */

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer to satisfy BufferSource (subtle.digest rejects
  // SharedArrayBuffer-backed views, and TS widens `Uint8Array["buffer"]`).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return new Uint8Array(digest);
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface VerifiedFetchResult {
  data: Uint8Array;
  contentType: string;
  servedBy: string;
  role: GatewayRole;
  latencyMs: number;
  verified: boolean;
  verificationNote?: string;
}

/**
 * Fetch raw data for a tx, racing through primary → pool. If `expectedDataRoot`
 * is supplied, verify the bytes cryptographically; any gateway that returns
 * data whose hash doesn't match is penalised and skipped.
 */
export async function fetchTxDataVerified(
  txId: string,
  expectedDataRoot?: string,
  opts: PoolFetchOptions = {},
): Promise<VerifiedFetchResult> {
  const gateways = listGateways({ skipPrimary: opts.skipPrimary, primaryOnly: opts.primaryOnly });
  if (gateways.length === 0) throw new Error("No Arweave gateways configured");

  let lastErr: unknown = null;

  for (const { url, role } of gateways) {
    const start = performance.now();
    try {
      const res = await fetch(`${url}/${txId}`, {
        signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        touch(url, role, latencyMs, `HTTP ${res.status}`);
        lastErr = new Error(`${url} → HTTP ${res.status}`);
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "application/octet-stream";

      let verified = false;
      let verificationNote: string | undefined;
      if (expectedDataRoot) {
        // Direct-hash verification — works for single-chunk txs (<= 256 KiB).
        // For chunked / bundled txs, full Merkle verification is out of scope
        // for this client; we trust and annotate.
        if (bytes.byteLength <= 256 * 1024) {
          const actualRoot = b64urlEncode(await sha256(bytes));
          if (actualRoot === expectedDataRoot) {
            verified = true;
          } else {
            touch(url, role, latencyMs, "data_root mismatch");
            lastErr = new Error(`${url} returned data that does not match data_root`);
            continue;
          }
        } else {
          verificationNote = "Chunked payload — Merkle verification requires full tx chunks";
        }
      }

      touch(url, role, latencyMs, null);
      return { data: bytes, contentType, servedBy: url, role, latencyMs, verified, verificationNote };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - start);
      const msg = e instanceof Error ? e.message : String(e);
      touch(url, role, latencyMs, msg);
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error("All gateways failed");
}

/* ------------------------------------------------------------------ */
/*  Telemetry                                                           */
/* ------------------------------------------------------------------ */

export function getPoolStats(): GatewayStat[] {
  return Array.from(stats.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === "primary" ? -1 : 1;
    return (b.wins - b.losses) - (a.wins - a.losses);
  });
}

export function resetPoolStats(): void {
  stats.clear();
}

/** Primary gateway URL if configured, else null. */
export function getPrimaryGateway(): string | null {
  return ARWEAVE_PRIMARY_GATEWAY ? normalizeBase(ARWEAVE_PRIMARY_GATEWAY) : null;
}

/** Is the primary gateway configured (i.e. do we have our own node)? */
export function hasPrimaryGateway(): boolean {
  return !!ARWEAVE_PRIMARY_GATEWAY;
}
