import type {
  BlockHeaderSummary,
  JsonRpcRequest,
  JsonRpcResponse,
  MfndStatus,
  MfndTip,
  RecentUpload,
} from "./types";

/**
 * Browser-exposed proxy URL.
 * Precedence: env override → config.json rpc_proxy_url → offline.
 */
export function getRpcProxyUrl(configUrl?: string | null): string | null {
  const raw =
    process.env.NEXT_PUBLIC_MFND_RPC_PROXY_URL?.trim() ||
    process.env.NEXT_PUBLIC_VITE_MFND_RPC_PROXY_URL?.trim() ||
    configUrl?.trim() ||
    "";
  return raw || null;
}

let nextId = 1;

export async function rpcCall<T>(
  proxyUrl: string,
  method: string,
  params: Record<string, unknown> | unknown[] = {},
  signal?: AbortSignal,
): Promise<T> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    method,
    params,
    id: nextId++,
  };

  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`RPC proxy HTTP ${res.status}`);
  }

  const text = (await res.text()).trim();
  // Proxy may return a single NDJSON line or a JSON object.
  const line = text.split("\n").find((l) => l.trim().startsWith("{")) ?? text;
  let parsed: JsonRpcResponse<T>;
  try {
    parsed = JSON.parse(line) as JsonRpcResponse<T>;
  } catch {
    throw new Error("RPC proxy returned non-JSON");
  }

  if (parsed.error) {
    throw new Error(parsed.error.message || `RPC error ${parsed.error.code}`);
  }
  if (parsed.result === undefined) {
    throw new Error("RPC response missing result");
  }
  return parsed.result;
}

export async function fetchLiveSnapshot(proxyUrl: string, signal?: AbortSignal) {
  const [status, tip] = await Promise.all([
    rpcCall<MfndStatus>(proxyUrl, "get_status", {}, signal),
    rpcCall<MfndTip>(proxyUrl, "get_tip", {}, signal).catch(() => null),
  ]);

  let headers: BlockHeaderSummary[] = [];
  let uploads: RecentUpload[] = [];

  const tipHeight =
    status.chain?.tip_height ?? tip?.tip_height ?? tip?.height ?? null;

  if (tipHeight != null && tipHeight >= 0) {
    try {
      const from = Math.max(0, tipHeight - 4);
      const raw = await rpcCall<unknown>(
        proxyUrl,
        "get_block_headers",
        { from_height: from, to_height: tipHeight, limit: 5 },
        signal,
      );
      headers = normalizeHeaders(raw);
    } catch {
      // optional — ignore
    }
  }

  try {
    const raw = await rpcCall<unknown>(
      proxyUrl,
      "list_recent_uploads",
      { limit: 8 },
      signal,
    );
    uploads = normalizeUploads(raw);
  } catch {
    // optional — ignore
  }

  return { status, tip, headers, uploads };
}

function normalizeHeaders(raw: unknown): BlockHeaderSummary[] {
  if (Array.isArray(raw)) {
    return raw.map(asHeader).filter(Boolean) as BlockHeaderSummary[];
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const list =
      (obj.headers as unknown[]) ||
      (obj.blocks as unknown[]) ||
      (obj.items as unknown[]);
    if (Array.isArray(list)) {
      return list.map(asHeader).filter(Boolean) as BlockHeaderSummary[];
    }
  }
  return [];
}

function asHeader(item: unknown): BlockHeaderSummary | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  return {
    height: num(o.height ?? o.block_height),
    id: str(o.id ?? o.tip_id ?? o.block_id ?? o.hash),
  };
}

function normalizeUploads(raw: unknown): RecentUpload[] {
  if (Array.isArray(raw)) return raw as RecentUpload[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const list =
      (obj.uploads as unknown[]) ||
      (obj.items as unknown[]) ||
      (obj.recent as unknown[]);
    if (Array.isArray(list)) return list as RecentUpload[];
  }
  return [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
