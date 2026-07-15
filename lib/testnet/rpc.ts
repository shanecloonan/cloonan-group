import type {
  BlockHeaderSummary,
  ChainParams,
  FraudContestSnapshot,
  JsonRpcRequest,
  JsonRpcResponse,
  LightCheckpointSummary,
  MempoolPulse,
  MfndStatus,
  MfndTip,
  RecentUpload,
  StoragePulse,
} from "./types";
import {
  aggregatePrivacySamples,
  parseTxPrivacyMeta,
  type PrivacySampleAggregate,
  type TxPrivacyMeta,
} from "./tx-meta";

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

type BlockTxCounts = { all: number; user: number };

/** Cache tx counts by height — payloads are large; heights are immutable. */
const txCountCache = new Map<number, BlockTxCounts>();
/** Privacy-safe shape cache keyed by height. */
const txMetaCache = new Map<number, TxPrivacyMeta[]>();
/** How many historical heights to fetch per live poll while backfilling a total. */
const TX_COUNT_BACKFILL_BUDGET = 16;
/** Max mempool txs to sample for ring-shape stats per poll. */
const MEMPOOL_SAMPLE_BUDGET = 6;

export type TxCountTotals = {
  /**
   * Sum of non-coinbase txs in blocks 1..=tip.
   * Coinbase (empty-input) txs are excluded — otherwise the total ≈ tip height.
   */
  totalTxCount: number | null;
  /** Distinct heights with a cached count in 1..=tip. */
  coveredHeights: number;
  tipHeight: number;
  /** True once every height from 1..=tip is cached. */
  complete: boolean;
};

export type LiveSnapshot = {
  status: MfndStatus;
  tip: MfndTip | null;
  headers: BlockHeaderSummary[];
  uploads: RecentUpload[];
  txTotals: TxCountTotals | null;
  chainParams: ChainParams | null;
  checkpoint: LightCheckpointSummary | null;
  fraudContests: FraudContestSnapshot | null;
  storagePulse: StoragePulse | null;
  mempoolPulse: MempoolPulse | null;
  privacySample: PrivacySampleAggregate | null;
};

export async function fetchLiveSnapshot(
  proxyUrl: string,
  signal?: AbortSignal,
): Promise<LiveSnapshot> {
  const [status, tip, chainParams, checkpoint, fraudContests, mempoolRaw] =
    await Promise.all([
      rpcCall<MfndStatus>(proxyUrl, "get_status", {}, signal),
      rpcCall<MfndTip>(proxyUrl, "get_tip", {}, signal).catch(() => null),
      rpcCall<ChainParams>(proxyUrl, "get_chain_params", {}, signal).catch(
        () => null,
      ),
      rpcCall<{ summary?: LightCheckpointSummary }>(
        proxyUrl,
        "get_light_snapshot",
        {},
        signal,
      )
        .then((r) => r?.summary ?? null)
        .catch(() => null),
      rpcCall<FraudContestSnapshot>(
        proxyUrl,
        "list_fraud_contests",
        {},
        signal,
      ).catch(() => null),
      rpcCall<{ mempool_len?: number; tx_ids?: string[] }>(
        proxyUrl,
        "get_mempool",
        {},
        signal,
      ).catch(() => null),
    ]);

  let headers: BlockHeaderSummary[] = [];
  let uploads: RecentUpload[] = [];
  let txTotals: TxCountTotals | null = null;
  let storagePulse: StoragePulse | null = null;
  let mempoolPulse: MempoolPulse | null = null;
  let privacySample: PrivacySampleAggregate | null = null;

  const tipHeight =
    status.chain?.tip_height ?? tip?.tip_height ?? tip?.height ?? null;

  if (tipHeight != null && tipHeight >= 1) {
    try {
      const from = Math.max(1, tipHeight - 5);
      const raw = await rpcCall<unknown>(
        proxyUrl,
        "get_block_headers",
        { from_height: from, to_height: tipHeight, limit: 6 },
        signal,
      );
      headers = normalizeHeaders(raw);
      await fetchMissingTxCounts(
        proxyUrl,
        headers.map((h) => h.height).filter((h): h is number => h != null),
        signal,
      );
      headers = headers.map((h) => {
        if (h.height == null) return h;
        const c = txCountCache.get(h.height);
        return c
          ? { ...h, tx_count: c.all, user_tx_count: c.user }
          : h;
      });
      await backfillTxCounts(proxyUrl, tipHeight, signal);
      txTotals = summarizeTxCounts(tipHeight);
      privacySample = aggregatePrivacySamples(collectCachedPrivacyMetas());
    } catch {
      // optional — ignore
    }
  }

  try {
    const raw = await rpcCall<{
      uploads?: RecentUpload[];
      total?: number;
    }>(proxyUrl, "list_recent_uploads", { limit: 12 }, signal);
    uploads = normalizeUploads(raw);
    storagePulse = summarizeStoragePulse(uploads, raw?.total);
  } catch {
    // optional — ignore
  }

  if (mempoolRaw) {
    mempoolPulse = await summarizeMempoolPulse(proxyUrl, mempoolRaw, signal);
    if (privacySample && mempoolPulse.pendingUserTxs != null) {
      // Mempool samples merged into privacy aggregate on next block fetch;
      // keep block-derived sample as primary source.
    }
  }

  return {
    status,
    tip,
    headers,
    uploads,
    txTotals,
    chainParams,
    checkpoint,
    fraudContests,
    storagePulse,
    mempoolPulse,
    privacySample,
  };
}

async function fetchMissingTxCounts(
  proxyUrl: string,
  heights: number[],
  signal?: AbortSignal,
): Promise<void> {
  const missing = [...new Set(heights)].filter(
    (h) => h >= 1 && !txCountCache.has(h),
  );
  await Promise.all(
    missing.map(async (height) => {
      try {
        const raw = await rpcCall<{ txs?: unknown[] }>(
          proxyUrl,
          "get_block_txs",
          { height },
          signal,
        );
        const txs = Array.isArray(raw?.txs) ? raw.txs : [];
        const metas: TxPrivacyMeta[] = [];
        for (const item of txs) {
          if (!item || typeof item !== "object") continue;
          const o = item as { tx_hex?: unknown };
          if (typeof o.tx_hex !== "string") continue;
          const meta = parseTxPrivacyMeta(o.tx_hex);
          if (meta && !meta.isCoinbase) metas.push(meta);
        }
        txMetaCache.set(height, metas);
        txCountCache.set(height, {
          all: txs.length,
          user: countUserTxs(txs),
        });
      } catch {
        // leave uncached — retry next poll
      }
    }),
  );
}

function collectCachedPrivacyMetas(): TxPrivacyMeta[] {
  const out: TxPrivacyMeta[] = [];
  for (const metas of txMetaCache.values()) out.push(...metas);
  return out;
}

async function summarizeMempoolPulse(
  proxyUrl: string,
  raw: { mempool_len?: number; tx_ids?: string[] },
  signal?: AbortSignal,
): Promise<MempoolPulse> {
  const poolLen = raw.mempool_len ?? raw.tx_ids?.length ?? 0;
  const ids = Array.isArray(raw.tx_ids) ? raw.tx_ids.slice(0, MEMPOOL_SAMPLE_BUDGET) : [];
  if (ids.length === 0) {
    return { poolLen, pendingUserTxs: poolLen > 0 ? null : 0 };
  }
  let pending = 0;
  await Promise.all(
    ids.map(async (txId) => {
      try {
        const ent = await rpcCall<{ tx_hex?: string }>(
          proxyUrl,
          "get_mempool_tx",
          { tx_id: txId },
          signal,
        );
        if (typeof ent?.tx_hex !== "string") return;
        const meta = parseTxPrivacyMeta(ent.tx_hex);
        if (meta && !meta.isCoinbase) pending++;
      } catch {
        // skip
      }
    }),
  );
  return {
    poolLen,
    pendingUserTxs: pending > 0 ? pending : poolLen === 0 ? 0 : null,
  };
}

function summarizeStoragePulse(
  uploads: RecentUpload[],
  total?: number,
): StoragePulse {
  let bytes = 0;
  let replSum = 0;
  let replN = 0;
  for (const u of uploads) {
    if (typeof u.size_bytes === "number") bytes += u.size_bytes;
    if (typeof u.replication === "number") {
      replSum += u.replication;
      replN++;
    }
  }
  return {
    totalAnchors: typeof total === "number" ? total : null,
    recentCount: uploads.length,
    totalBytesBucketed: uploads.length > 0 ? bytes : null,
    avgReplication: replN > 0 ? Math.round((replSum / replN) * 10) / 10 : null,
  };
}

/** Fill gaps from tip downward so new blocks stay current while history catches up. */
async function backfillTxCounts(
  proxyUrl: string,
  tipHeight: number,
  signal?: AbortSignal,
): Promise<void> {
  const missing: number[] = [];
  for (let h = tipHeight; h >= 1 && missing.length < TX_COUNT_BACKFILL_BUDGET; h--) {
    if (!txCountCache.has(h)) missing.push(h);
  }
  if (missing.length === 0) return;
  await fetchMissingTxCounts(proxyUrl, missing, signal);
}

function summarizeTxCounts(tipHeight: number): TxCountTotals {
  let total = 0;
  let covered = 0;
  for (let h = 1; h <= tipHeight; h++) {
    const n = txCountCache.get(h);
    if (n != null) {
      total += n.user;
      covered++;
    }
  }
  return {
    totalTxCount: covered > 0 ? total : null,
    coveredHeights: covered,
    tipHeight,
    complete: covered === tipHeight,
  };
}

/** Non-coinbase = tx with at least one ring input (coinbase is empty-input / index 0). */
function countUserTxs(txs: unknown[]): number {
  let user = 0;
  for (const item of txs) {
    if (!item || typeof item !== "object") continue;
    const o = item as { tx_hex?: unknown; tx_index?: unknown };
    if (typeof o.tx_hex === "string") {
      if (!isCoinbaseTxHex(o.tx_hex)) user++;
      continue;
    }
    // Fallback: only treat index 0 as coinbase when hex is unavailable.
    if (typeof o.tx_index === "number" && o.tx_index !== 0) user++;
  }
  return user;
}

/**
 * MFBN tx wire: version varint · 32-byte r_pub · u64 fee · blob(extra) · varint(inputs).
 * Coinbase-shaped iff inputs length is 0.
 */
function isCoinbaseTxHex(hex: string): boolean {
  const raw = hex.replace(/\s+/g, "").toLowerCase();
  if (raw.length < 2 + 64 + 16 || raw.length % 2 !== 0) return false;
  try {
    const bytes = new Uint8Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    let off = 0;
    while (off < bytes.length && bytes[off]! & 0x80) off++;
    off++; // version
    off += 32; // r_pub
    off += 8; // fee
    if (off >= bytes.length) return false;
    const extraLen = readLeb128(bytes, off);
    if (extraLen == null) return false;
    off = extraLen.next;
    off += extraLen.value;
    const inputs = readLeb128(bytes, off);
    return inputs != null && inputs.value === 0;
  } catch {
    return false;
  }
}

function readLeb128(
  bytes: Uint8Array,
  off: number,
): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let i = off;
  while (i < bytes.length) {
    const b = bytes[i]!;
    value |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) return { value, next: i };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
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
  const headerHex = str(o.header_hex);
  const decoded = headerHex ? decodeHeaderMeta(headerHex) : null;
  return {
    height: num(o.height ?? o.block_height) ?? decoded?.height,
    id: str(o.id ?? o.tip_id ?? o.block_id ?? o.hash),
    slot: num(o.slot) ?? decoded?.slot,
    timestamp: num(o.timestamp) ?? decoded?.timestamp,
    header_hex: headerHex,
    tx_count: num(o.tx_count ?? o.num_txs ?? o.transaction_count),
  };
}

/** Decode height / slot / unix timestamp from MFBN `header_hex` (leading fields). */
function decodeHeaderMeta(
  hex: string,
): { height: number; slot: number; timestamp: number } | null {
  const raw = hex.replace(/\s+/g, "").toLowerCase();
  if (raw.length < 2 + 64 + 8 + 8 + 16 || raw.length % 2 !== 0) return null;
  try {
    const bytes = new Uint8Array(raw.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    let off = 0;
    // version varint (LEB128)
    while (off < bytes.length && bytes[off] & 0x80) off++;
    off++; // final version byte
    off += 32; // prev_hash
    if (off + 16 > bytes.length) return null;
    const height = readU32Be(bytes, off);
    off += 4;
    const slot = readU32Be(bytes, off);
    off += 4;
    const timestamp = readU64Be(bytes, off);
    return { height, slot, timestamp };
  } catch {
    return null;
  }
}

function readU32Be(b: Uint8Array, off: number): number {
  return (
    ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>>
    0
  );
}

function readU64Be(b: Uint8Array, off: number): number {
  // Safe for unix-second timestamps (well under 2^53).
  let n = 0;
  for (let i = 0; i < 8; i++) n = n * 256 + b[off + i]!;
  return n;
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
