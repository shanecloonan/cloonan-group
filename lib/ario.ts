/**
 * ar.io Gateway Network integration.
 *
 * Provides smart gateway selection from the decentralized ar.io network,
 * ArNS (Arweave Name System) resolution, and gateway health monitoring.
 * Uses direct REST API calls — no SDK dependency.
 */

import { ARWEAVE_DIRECT_GATEWAYS } from "./config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ArioGatewayInfo {
  fqdn: string;
  port: number;
  protocol: "http" | "https";
  label: string;
  operatorStake: number;
  status: string;
  startTimestamp: number;
  observerAddress: string;
  gatewayAddress: string;
}

export interface ArioGatewayHealth {
  fqdn: string;
  url: string;
  healthy: boolean;
  latencyMs: number;
  blockHeight?: number;
  version?: string;
  error?: string;
}

export interface ArnsResolution {
  txId: string;
  ttlSeconds: number;
  processId: string;
  resolvedAt?: number;
}

/* ------------------------------------------------------------------ */
/*  Known gateway list (curated high-quality gateways)                 */
/* ------------------------------------------------------------------ */

const KNOWN_GATEWAYS = [
  "arweave.net",
  "ar-io.net",
  "arweave.dev",
  "g8way.io",
  "arweave.developerdao.com",
  "vilenarios.com",
  "ar.arweave.dev",
];

/* ------------------------------------------------------------------ */
/*  Gateway discovery & health checking                                */
/* ------------------------------------------------------------------ */

export async function checkGatewayHealth(
  fqdn: string,
  timeoutMs = 5000,
): Promise<ArioGatewayHealth> {
  const url = `https://${fqdn}`;
  const start = performance.now();

  try {
    const res = await fetch(`${url}/ar-io/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      return { fqdn, url, healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }

    const info = await res.json();
    return {
      fqdn,
      url,
      healthy: true,
      latencyMs,
      blockHeight: info.blockHeight,
      version: info.release,
    };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      fqdn,
      url,
      healthy: false,
      latencyMs,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

/**
 * Checks health of all known gateways in parallel, returns them ranked
 * by latency (healthy ones first).
 */
export async function discoverGateways(
  extraFqdns: string[] = [],
  timeoutMs = 5000,
): Promise<ArioGatewayHealth[]> {
  const allFqdns = [...new Set([...KNOWN_GATEWAYS, ...extraFqdns])];

  const results = await Promise.all(
    allFqdns.map((fqdn) => checkGatewayHealth(fqdn, timeoutMs)),
  );

  return results.sort((a, b) => {
    if (a.healthy && !b.healthy) return -1;
    if (!a.healthy && b.healthy) return 1;
    return a.latencyMs - b.latencyMs;
  });
}

/**
 * Returns the best gateway URL from the ranked list.
 * Falls back to the static ARWEAVE_DIRECT_GATEWAYS config if all fail.
 */
export async function getBestGateway(
  cachedGateways?: ArioGatewayHealth[],
): Promise<string> {
  const gateways = cachedGateways ?? await discoverGateways();
  const best = gateways.find((g) => g.healthy);
  if (best) return best.url;
  return `https://${ARWEAVE_DIRECT_GATEWAYS[0].replace("https://", "")}`;
}

/* ------------------------------------------------------------------ */
/*  ArNS Name Resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves an ArNS name to an Arweave transaction ID.
 * Tries the provided gateway first, falls back to ar-io.net.
 */
export async function resolveArns(
  name: string,
  gatewayUrl?: string,
): Promise<ArnsResolution | null> {
  const gateways = gatewayUrl
    ? [gatewayUrl, "https://ar-io.net"]
    : ["https://ar-io.net", "https://arweave.dev"];

  for (const gw of gateways) {
    try {
      const res = await fetch(`${gw}/ar-io/resolver/${name}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.txId) {
        return {
          txId: data.txId,
          ttlSeconds: data.ttlSeconds ?? 3600,
          processId: data.processId ?? "",
          resolvedAt: data.resolvedAt,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Builds a content URL for an ArNS name.
 * Format: https://{name}.arweave.dev or https://{name}.ar-io.net
 */
export function getArnsUrl(name: string, gateway = "arweave.dev"): string {
  return `https://${name}.${gateway}`;
}

/**
 * Checks if a string looks like an ArNS name (not a TX ID).
 */
export function isArnsName(input: string): boolean {
  if (!input || input.length > 64) return false;
  // TX IDs are 43 chars base64url. ArNS names are shorter and alphanumeric-ish.
  if (/^[a-zA-Z0-9_-]{43}$/.test(input)) return false;
  return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(input);
}

/**
 * Resolves input that could be either a TX ID or ArNS name.
 * Returns the transaction ID in either case.
 */
export async function resolveToTxId(input: string): Promise<string | null> {
  if (!input) return null;

  // Looks like a standard TX ID
  if (/^[a-zA-Z0-9_-]{43}$/.test(input)) return input;

  // Strip ar:// protocol
  let name = input;
  if (name.startsWith("ar://")) name = name.slice(5);

  // Try ArNS resolution
  const result = await resolveArns(name);
  return result?.txId ?? null;
}

/* ------------------------------------------------------------------ */
/*  Gateway network statistics                                         */
/* ------------------------------------------------------------------ */

export interface GatewayNetworkStats {
  totalChecked: number;
  healthyCount: number;
  avgLatencyMs: number;
  bestLatencyMs: number;
  bestGateway: string;
}

export function computeNetworkStats(
  gateways: ArioGatewayHealth[],
): GatewayNetworkStats {
  const healthy = gateways.filter((g) => g.healthy);
  const avgLatencyMs = healthy.length > 0
    ? Math.round(healthy.reduce((s, g) => s + g.latencyMs, 0) / healthy.length)
    : 0;
  const best = healthy[0];

  return {
    totalChecked: gateways.length,
    healthyCount: healthy.length,
    avgLatencyMs,
    bestLatencyMs: best?.latencyMs ?? 0,
    bestGateway: best?.fqdn ?? "none",
  };
}
