import Arweave from "arweave";
import { supabase } from "./supabase";
import { ARWEAVE_GATEWAY_URL, ARWEAVE_DIRECT_GATEWAYS, ARWEAVE_PRIMARY_GATEWAY } from "./config";
import { poolFetch, listGateways, type GatewayRole } from "./gateway-pool";
import { uploadToTurbo, uploadFileToTurbo, getTurboPrice, getTurboBalance, wincToAr } from "./turbo";
import { isArConnectAvailable, dispatchTransaction, type DispatchResult } from "./arconnect";
import type {
  ArweaveTag,
  ArweaveNetworkInfo,
  ArweaveTxFull,
  ArweaveTxStatus,
  ArweaveCostEstimate,
  ArweaveGqlResult,
  ArweaveUploadResult,
  ArweaveUploadRecord,
  ArweaveBookmark,
  ArweavePoolStatus,
  ArweaveBlock,
  GqlQueryParams,
  UploadMethod,
} from "./wallet-types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function b64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(str: string): ArrayBuffer {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const buf = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

function winstonToAr(winston: string): string {
  return (Number(winston) / 1e12).toFixed(12);
}

function arToWinston(ar: string): string {
  return BigInt(Math.round(parseFloat(ar) * 1e12)).toString();
}

/* ------------------------------------------------------------------ */
/*  arweave-js SDK instance                                            */
/* ------------------------------------------------------------------ */
/*
 * Used for building + signing Arweave transactions. Signing requires the
 * real spec — deepHash + RSA-PSS(saltLength=0) + Merkle data_root — which
 * is easy to get wrong, so we delegate to arweave-js. We still POST the
 * resulting tx via our own gateway waterfall (see writeToArweave) so the
 * client keeps its self-hosted-first / multi-gateway failover story.
 */
const arweaveSdk = Arweave.init({
  host: "arweave.net",
  port: 443,
  protocol: "https",
  timeout: 20_000,
});

/* ------------------------------------------------------------------ */
/*  GraphQL query builder                                              */
/* ------------------------------------------------------------------ */

export function buildGqlQuery(params: GqlQueryParams): string {
  const filters: string[] = [];
  if (params.owners?.length)
    filters.push(`owners: ${JSON.stringify(params.owners)}`);
  if (params.recipients?.length)
    filters.push(`recipients: ${JSON.stringify(params.recipients)}`);
  if (params.tags?.length) {
    const tagFilters = params.tags
      .map((t) => `{ name: ${JSON.stringify(t.name)}, values: ${JSON.stringify(t.values)} }`)
      .join(", ");
    filters.push(`tags: [${tagFilters}]`);
  }
  if (params.block) {
    const parts: string[] = [];
    if (params.block.min != null) parts.push(`min: ${params.block.min}`);
    if (params.block.max != null) parts.push(`max: ${params.block.max}`);
    if (parts.length) filters.push(`block: { ${parts.join(", ")} }`);
  }
  if (params.first) filters.push(`first: ${params.first}`);
  if (params.after) filters.push(`after: ${JSON.stringify(params.after)}`);
  if (params.sort) filters.push(`sort: ${params.sort}`);

  const args = filters.length ? `(${filters.join(", ")})` : "";

  return `{
  transactions${args} {
    pageInfo { hasNextPage }
    edges {
      cursor
      node {
        id anchor signature recipient
        owner { address key }
        fee { winston ar }
        quantity { winston ar }
        data { size type }
        tags { name value }
        block { id timestamp height previous }
        parent { id }
      }
    }
  }
}`;
}

/* ------------------------------------------------------------------ */
/*  ArweaveGateway class                                               */
/* ------------------------------------------------------------------ */

export class ArweaveGateway {
  private baseUrl: string;

  /** Last read that went through fetchWithFallback — surfaced to UI so users
   *  can see which gateway served their data (or that our own node did). */
  public lastServedBy: string | null = null;
  public lastServedByRole: GatewayRole | "supabase" | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || ARWEAVE_GATEWAY_URL;
  }

  /** Safe insert into arweave_uploads. The table is optional infrastructure —
   *  if it doesn't exist on this project yet, logging just silently no-ops
   *  so core upload paths still succeed. */
  private async safeUploadLog(row: Record<string, unknown>): Promise<void> {
    try {
      const { error } = await supabase.from("arweave_uploads").insert(row);
      if (error && process.env.NODE_ENV !== "production") {
        console.warn("[arweave_uploads] insert skipped:", error.message);
      }
    } catch { /* non-fatal */ }
  }

  private async safeUploadUpdate(txId: string, patch: Record<string, unknown>): Promise<void> {
    try {
      await supabase.from("arweave_uploads").update(patch).eq("tx_id", txId);
    } catch { /* non-fatal */ }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    // Also pass the anon key for Supabase edge function auth
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2anF4amFrY2trYmZzZHJudHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTI0NTQsImV4cCI6MjA4ODg2ODQ1NH0.-yAgsCoJDviO5eS4hym15kI9q6nFDw9HA237_jM7224";
    headers["apikey"] = anonKey;
    return headers;
  }

  /**
   * Privileged Supabase-edge-function call. Used for auth-gated operations
   * (submitTx, submitChunk, pool-status, refresh-peers). Do NOT use this
   * for public reads — those should go through the gateway-pool.
   */
  private async gw(path: string, opts: RequestInit = {}): Promise<Response> {
    const authHeaders = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: { ...authHeaders, ...((opts.headers as Record<string, string>) || {}) },
    });
    return res;
  }

  /**
   * Read waterfall:
   *   1. Self-hosted primary node  (lib/gateway-pool.ts)
   *   2. Public gateway pool       (arweave.net, ar-io.net, arweave.dev, ...)
   *
   * Writes / non-GET requests bypass the pool and go straight to the Supabase
   * edge function (authenticated). This keeps user-generated state (uploads,
   * peer-pool state) flowing through our own auth layer.
   */
  private async fetchWithFallback(path: string, opts?: RequestInit): Promise<Response> {
    const method = opts?.method?.toUpperCase() || "GET";
    if (method !== "GET" && method !== "HEAD") {
      // Writes go through the privileged Supabase proxy
      const res = await this.gw(path, opts);
      this.lastServedBy = this.baseUrl;
      this.lastServedByRole = "supabase";
      return res;
    }

    // Reads: primary node → pool → (last resort) supabase proxy
    try {
      const { response, servedBy, role } = await poolFetch(path, { ...opts, timeoutMs: 12_000 });
      this.lastServedBy = servedBy;
      this.lastServedByRole = role;
      return response;
    } catch {
      // Pool completely down — one last attempt through Supabase proxy
      try {
        const res = await this.gw(path, opts);
        if (res.ok || res.status < 500) {
          this.lastServedBy = this.baseUrl;
          this.lastServedByRole = "supabase";
          return res;
        }
      } catch { /* fall through */ }
    }

    // Absolute last resort — direct hit to the pool's first entry
    for (const gw of ARWEAVE_DIRECT_GATEWAYS) {
      try {
        const res = await fetch(`${gw}${path}`, { signal: AbortSignal.timeout(12000) });
        if (res.ok || res.status < 500) {
          this.lastServedBy = gw;
          this.lastServedByRole = "pool";
          return res;
        }
      } catch { continue; }
    }
    return new Response("All gateways failed", { status: 502 });
  }

  /** Inspect the read waterfall that will be used (useful for dashboards). */
  getReadPath(): Array<{ url: string; role: GatewayRole }> {
    return listGateways();
  }

  /* ---- Network ---- */

  async getNetworkInfo(): Promise<ArweaveNetworkInfo> {
    const res = await this.fetchWithFallback("/info");
    if (!res.ok) throw new Error(`Network info failed: ${res.status}`);
    return res.json();
  }

  async getPeers(): Promise<string[]> {
    const res = await this.fetchWithFallback("/peers");
    if (!res.ok) throw new Error(`Peers failed: ${res.status}`);
    return res.json();
  }

  /* ---- Peer Pool (direct peer access) ---- */

  async getPoolStatus(): Promise<ArweavePoolStatus> {
    const res = await this.gw("/pool-status");
    if (!res.ok) throw new Error(`Pool status failed: ${res.status}`);
    return res.json();
  }

  async refreshPeerPool(): Promise<{ refreshed: boolean; peers_activated: number }> {
    const res = await this.gw("/refresh-peers", { method: "POST" });
    if (!res.ok) throw new Error(`Peer refresh failed: ${res.status}`);
    return res.json();
  }

  /* ---- Wallet ---- */

  async getBalance(address: string): Promise<{ winston: string; ar: string }> {
    const res = await this.fetchWithFallback(`/wallet/${address}/balance`);
    if (!res.ok) throw new Error(`Balance failed: ${res.status}`);
    const winston = await res.text();
    return { winston, ar: winstonToAr(winston) };
  }

  async getLastTx(address: string): Promise<string> {
    const res = await this.fetchWithFallback(`/wallet/${address}/last_tx`);
    if (!res.ok) throw new Error(`Last TX failed: ${res.status}`);
    return res.text();
  }

  /* ---- Transactions ---- */

  async getTx(txId: string): Promise<ArweaveTxFull> {
    const res = await this.fetchWithFallback(`/tx/${txId}`);
    if (!res.ok) throw new Error(`TX fetch failed: ${res.status}`);
    return res.json();
  }

  async getTxStatus(txId: string): Promise<ArweaveTxStatus> {
    const res = await this.fetchWithFallback(`/tx/${txId}/status`);
    if (!res.ok) throw new Error(`TX status failed: ${res.status}`);
    return res.json();
  }

  async getTxData(txId: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    const res = await this.fetchWithFallback(`/tx/${txId}/data`);
    if (!res.ok) throw new Error(`TX data failed: ${res.status}`);
    return {
      data: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }

  async getTxTags(txId: string): Promise<ArweaveTag[]> {
    const res = await this.fetchWithFallback(`/tx/${txId}/tags`);
    if (!res.ok) throw new Error(`TX tags failed: ${res.status}`);
    return res.json();
  }

  async getRawData(txId: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    const res = await this.fetchWithFallback(`/${txId}`);
    if (!res.ok) throw new Error(`Raw data failed: ${res.status}`);
    return {
      data: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }

  /**
   * Write waterfall for POSTing signed transactions / chunks:
   *
   *   1. Self-hosted primary gateway  (if ARWEAVE_PRIMARY_GATEWAY set)
   *   2. Supabase edge function proxy (if the function is deployed —
   *      authenticated, gives us centralized logging)
   *   3. arweave.net                   (always the baseline)
   *   4. Other public gateways         (ar-io.net, arweave.dev, ...)
   *
   * First 2xx/202 response wins. The edge-function layer is optional —
   * if it isn't deployed on this project, we silently fall through to
   * direct Arweave submission.
   */
  private async writeToArweave(path: string, body: string): Promise<{ status: number; body: string; servedBy: string }> {
    const candidates: Array<{ url: string; role: "primary" | "supabase" | "public" }> = [];
    if (ARWEAVE_PRIMARY_GATEWAY) candidates.push({ url: ARWEAVE_PRIMARY_GATEWAY.replace(/\/+$/, ""), role: "primary" });
    // Supabase proxy: only worth trying if it looks configured.
    candidates.push({ url: this.baseUrl, role: "supabase" });
    for (const g of ARWEAVE_DIRECT_GATEWAYS) {
      candidates.push({ url: g.replace(/\/+$/, ""), role: "public" });
    }

    const errors: string[] = [];
    for (const { url, role } of candidates) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (role === "supabase") {
          Object.assign(headers, await this.getAuthHeaders());
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        const res = await fetch(`${url}${path}`, {
          method: "POST",
          headers,
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);

        // Accept 200 and 202 (Arweave accepts-for-processing)
        if (res.status === 200 || res.status === 202) {
          const text = await res.text();
          this.lastServedBy = url;
          this.lastServedByRole = role === "supabase" ? "supabase" : role === "primary" ? "primary" : "pool";
          return { status: res.status, body: text, servedBy: url };
        }
        // Supabase proxy not deployed — 404 comes back as html. Treat any
        // non-2xx from the supabase role as "fall through silently".
        if (role === "supabase") {
          errors.push(`${url} → ${res.status} (proxy unavailable, falling through)`);
          continue;
        }
        const errBody = await res.text().catch(() => "");
        errors.push(`${url} → ${res.status}: ${errBody.slice(0, 200)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${url} → ${msg}`);
      }
    }
    throw new Error(
      `Arweave ${path} submission failed on all gateways:\n` + errors.map((e) => `  • ${e}`).join("\n"),
    );
  }

  async submitTx(tx: Record<string, unknown>): Promise<{ status: number; body: string }> {
    const { status, body } = await this.writeToArweave("/tx", JSON.stringify(tx));
    return { status, body };
  }

  async submitChunk(chunk: Record<string, unknown>): Promise<{ status: number }> {
    const { status } = await this.writeToArweave("/chunk", JSON.stringify(chunk));
    return { status };
  }

  /* ---- Pricing ---- */

  async getPrice(bytes: number, target?: string): Promise<string> {
    const path = target ? `/price/${bytes}/${target}` : `/price/${bytes}`;
    const res = await this.fetchWithFallback(path);
    if (!res.ok) throw new Error(`Price failed: ${res.status}`);
    return res.text();
  }

  async estimateCost(bytes: number): Promise<ArweaveCostEstimate> {
    const res = await this.fetchWithFallback(`/cost-estimate?bytes=${bytes}`);
    if (!res.ok) throw new Error(`Cost estimate failed: ${res.status}`);
    return res.json();
  }

  async getTxAnchor(): Promise<string> {
    const res = await this.fetchWithFallback("/tx_anchor");
    if (!res.ok) throw new Error(`Anchor failed: ${res.status}`);
    return res.text();
  }

  /* ---- GraphQL ---- */

  async queryTransactions(params: GqlQueryParams): Promise<ArweaveGqlResult> {
    const query = buildGqlQuery(params);
    const res = await this.gw("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`GraphQL failed: ${res.status}`);
    const json = await res.json();
    return json.data?.transactions ?? { edges: [], pageInfo: { hasNextPage: false } };
  }

  async rawGraphQL(query: string): Promise<unknown> {
    const res = await this.gw("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`GraphQL failed: ${res.status}`);
    return res.json();
  }

  async getTransactionsByOwner(address: string, first = 25, after?: string): Promise<ArweaveGqlResult> {
    return this.queryTransactions({ owners: [address], first, after, sort: "HEIGHT_DESC" });
  }

  async getTransactionsByRecipient(address: string, first = 25, after?: string): Promise<ArweaveGqlResult> {
    return this.queryTransactions({ recipients: [address], first, after, sort: "HEIGHT_DESC" });
  }

  async getTransactionsByTags(tags: { name: string; values: string[] }[], first = 25, after?: string): Promise<ArweaveGqlResult> {
    return this.queryTransactions({ tags, first, after, sort: "HEIGHT_DESC" });
  }

  /* ---- Blocks ---- */

  async getBlockByHeight(height: number): Promise<ArweaveBlock> {
    const res = await this.fetchWithFallback(`/block/height/${height}`);
    if (!res.ok) throw new Error(`Block fetch failed: ${res.status}`);
    return res.json();
  }

  async getBlockByHash(hash: string): Promise<ArweaveBlock> {
    const res = await this.fetchWithFallback(`/block/hash/${hash}`);
    if (!res.ok) throw new Error(`Block fetch failed: ${res.status}`);
    return res.json();
  }

  async getCurrentBlock(): Promise<ArweaveBlock> {
    const info = await this.getNetworkInfo();
    return this.getBlockByHeight(info.height);
  }

  async getRecentBlocks(count = 10): Promise<ArweaveBlock[]> {
    const info = await this.getNetworkInfo();
    const blocks: ArweaveBlock[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const block = await this.getBlockByHeight(info.height - i);
        blocks.push(block);
      } catch { break; }
    }
    return blocks;
  }

  /* ---- Crypto (static) ---- */

  static async generateWallet(): Promise<JsonWebKey> {
    const key = await crypto.subtle.generateKey(
      { name: "RSA-PSS", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    return crypto.subtle.exportKey("jwk", key.privateKey);
  }

  static async jwkToAddress(jwk: JsonWebKey): Promise<string> {
    const n = b64urlDecode(jwk.n!);
    const hash = await sha256(n);
    return b64urlEncode(hash);
  }

  /**
   * Signs a v2 Arweave data transaction using the official arweave-js SDK.
   *
   * We previously hand-rolled this with JSON.stringify + RSA-PSS(saltLength=32)
   * which was NEVER spec-compliant — Arweave requires deepHash of the tx fields
   * signed with RSA-PSS(saltLength=0). arweave-js also computes a valid Merkle
   * `data_root` over the chunked data, which is required for any tx > 0 bytes.
   *
   * Returns the arweave-js Transaction instance. Call `tx.toJSON()` to get the
   * wire format, and `tx.getChunk(i, data)` for chunked uploads > 256KB.
   */
  static async createSignedDataTx(
    data: Uint8Array,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    anchor: string,
    reward: string,
  ): Promise<import("arweave/web/lib/transaction").default> {
    const tx = await arweaveSdk.createTransaction(
      { data, last_tx: anchor, reward },
      jwk as unknown as Parameters<typeof arweaveSdk.createTransaction>[1],
    );
    for (const t of tags) tx.addTag(t.name, t.value);
    await arweaveSdk.transactions.sign(tx, jwk as unknown as Parameters<typeof arweaveSdk.transactions.sign>[1]);
    return tx;
  }

  static async createSignedTransferTx(
    target: string,
    arAmount: string,
    jwk: JsonWebKey,
    anchor: string,
    reward: string,
  ): Promise<import("arweave/web/lib/transaction").default> {
    const quantity = arToWinston(arAmount);
    const tx = await arweaveSdk.createTransaction(
      { target, quantity, last_tx: anchor, reward },
      jwk as unknown as Parameters<typeof arweaveSdk.createTransaction>[1],
    );
    await arweaveSdk.transactions.sign(tx, jwk as unknown as Parameters<typeof arweaveSdk.transactions.sign>[1]);
    return tx;
  }

  /* ---- Upload helpers ---- */

  async uploadData(
    data: Uint8Array,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult> {
    const anchor = await this.getTxAnchor();
    const reward = await this.getPrice(data.byteLength);
    let cost: ArweaveCostEstimate | null = null;
    try { cost = await this.estimateCost(data.byteLength); } catch { /* ok */ }

    const contentTag = tags.find((t) => t.name.toLowerCase() === "content-type");
    const ct = contentTag?.value || "application/octet-stream";

    const allTags: ArweaveTag[] = [
      ...tags,
      { name: "App-Name", value: "MoneyFund" },
      { name: "App-Version", value: "1.0" },
    ];

    // Build + sign via arweave-js (proper deepHash signature + Merkle data_root).
    const tx = await ArweaveGateway.createSignedDataTx(data, allTags, jwk, anchor, reward);
    const txId = tx.id;

    // Track upload in DB (non-fatal if the logging table doesn't exist on
    // this project — Arweave submission is the source of truth).
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await this.safeUploadLog({
        user_id: userId,
        tx_id: txId,
        data_size: data.byteLength,
        content_type: ct,
        tags: allTags,
        status: "preparing",
        cost_winston: reward,
        cost_ar: winstonToAr(reward),
        description: description || null,
      });
    }

    // Submit via arweave-js's TransactionUploader. This is the canonical
    // path for POSTing signed transactions — it handles both small (single
    // /tx POST) and large (/tx header + /chunk stream) uploads uniformly,
    // uses axios under the hood (which arweave.net's CORS whitelist
    // accepts), and knows how to format the request body exactly the way
    // the gateway expects. Our hand-rolled JSON.stringify(tx.toJSON())
    // path was being rejected by arweave.net with "400: Invalid JSON".
    try {
      const uploader = await arweaveSdk.transactions.getUploader(tx);
      while (!uploader.isComplete) {
        await uploader.uploadChunk();
        onProgress?.(uploader.pctComplete);
      }
      if (userId) await this.safeUploadUpdate(txId, { status: "submitted" });
      onProgress?.(100);
      return { txId, status: 200, cost };
    } catch (err) {
      if (userId) await this.safeUploadUpdate(txId, { status: "failed" });
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Arweave upload failed: ${msg}`);
    }
  }

  async uploadFile(
    file: File,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const hasCt = tags.some((t) => t.name.toLowerCase() === "content-type");
    const allTags = hasCt ? tags : [{ name: "Content-Type", value: file.type || "application/octet-stream" }, ...tags];
    return this.uploadData(buffer, allTags, jwk, description || file.name, onProgress);
  }

  /* ---- Bundled upload (Turbo) ---- */

  async uploadDataBundled(
    data: Uint8Array,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult> {
    const allTags: ArweaveTag[] = [
      ...tags,
      { name: "App-Name", value: "MoneyFund" },
      { name: "App-Version", value: "1.0" },
    ];

    const contentTag = tags.find((t) => t.name.toLowerCase() === "content-type");
    const ct = contentTag?.value || "application/octet-stream";

    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;

    let cost: ArweaveCostEstimate | null = null;
    try {
      const turboPrice = await getTurboPrice(data.byteLength);
      cost = {
        winston: turboPrice.winc,
        ar: wincToAr(turboPrice.winc),
        usd: "0",
        usd_per_ar: 0,
      };
    } catch { /* ok */ }

    const { id: txId, turboResult } = await uploadToTurbo(data, jwk, allTags, onProgress);

    if (userId) {
      await this.safeUploadLog({
        user_id: userId,
        tx_id: txId,
        data_size: data.byteLength,
        content_type: ct,
        tags: allTags,
        status: "confirmed",
        cost_winston: cost?.winston ?? "0",
        cost_ar: cost?.ar ?? "0",
        description: description || null,
        upload_method: "turbo",
        bundle_id: turboResult.id || null,
      });
    }

    return { txId, status: 200, cost };
  }

  async uploadFileBundled(
    file: File,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult> {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const hasCt = tags.some((t) => t.name.toLowerCase() === "content-type");
    const allTags = hasCt
      ? tags
      : [{ name: "Content-Type", value: file.type || "application/octet-stream" }, ...tags];
    return this.uploadDataBundled(buffer, allTags, jwk, description || file.name, onProgress);
  }

  /**
   * Smart upload: tries Turbo (bundled, instant) first, falls back to L1.
   * Returns the method used.
   */
  async smartUploadData(
    data: Uint8Array,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    preferredMethod: UploadMethod = "l1",
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult & { method: UploadMethod }> {
    if (preferredMethod === "turbo") {
      try {
        const result = await this.uploadDataBundled(data, tags, jwk, description, onProgress);
        return { ...result, method: "turbo" };
      } catch {
        const result = await this.uploadData(data, tags, jwk, description, onProgress);
        return { ...result, method: "l1" };
      }
    }
    const result = await this.uploadData(data, tags, jwk, description, onProgress);
    return { ...result, method: "l1" };
  }

  async smartUploadFile(
    file: File,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    preferredMethod: UploadMethod = "l1",
    description?: string,
    onProgress?: (pct: number) => void,
  ): Promise<ArweaveUploadResult & { method: UploadMethod }> {
    if (preferredMethod === "turbo") {
      try {
        const result = await this.uploadFileBundled(file, tags, jwk, description, onProgress);
        return { ...result, method: "turbo" };
      } catch {
        const result = await this.uploadFile(file, tags, jwk, description, onProgress);
        return { ...result, method: "l1" };
      }
    }
    const result = await this.uploadFile(file, tags, jwk, description, onProgress);
    return { ...result, method: "l1" };
  }

  /* ---- ArConnect dispatch (bundled via browser extension) ---- */

  async uploadViaArConnect(
    data: Uint8Array,
    tags: ArweaveTag[],
    description?: string,
  ): Promise<ArweaveUploadResult> {
    if (!isArConnectAvailable()) throw new Error("ArConnect not available");

    const allTags: ArweaveTag[] = [
      ...tags,
      { name: "App-Name", value: "MoneyFund" },
      { name: "App-Version", value: "1.0" },
    ];

    const result = await dispatchTransaction(data, allTags) as DispatchResult;

    const contentTag = tags.find((t) => t.name.toLowerCase() === "content-type");
    const ct = contentTag?.value || "application/octet-stream";

    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await this.safeUploadLog({
        user_id: userId,
        tx_id: result.id,
        data_size: data.byteLength,
        content_type: ct,
        tags: allTags,
        status: result.type === "BUNDLED" ? "confirmed" : "submitted",
        cost_winston: "0",
        cost_ar: "0",
        description: description || null,
        upload_method: result.type === "BUNDLED" ? "turbo" : "l1",
      });
    }

    return { txId: result.id, status: 200, cost: null };
  }

  /* ---- Turbo balance & pricing ---- */

  static async getTurboBalance(address: string): Promise<{ winc: string; ar: string }> {
    const bal = await getTurboBalance(address);
    return { winc: bal.winc, ar: wincToAr(bal.winc) };
  }

  static async getTurboPrice(bytes: number): Promise<{ winc: string; ar: string }> {
    const price = await getTurboPrice(bytes);
    return { winc: price.winc, ar: wincToAr(price.winc) };
  }

  /* ---- Content rendering helpers ---- */

  static detectContentType(tags: ArweaveTag[]): string {
    const ct = tags.find((t) => t.name.toLowerCase() === "content-type");
    return ct?.value || "application/octet-stream";
  }

  static isRenderableInline(contentType: string): boolean {
    const ct = contentType.toLowerCase();
    return (
      ct.startsWith("image/") ||
      ct.startsWith("text/") ||
      ct.startsWith("video/") ||
      ct.startsWith("audio/") ||
      ct === "application/json" ||
      ct === "application/pdf"
    );
  }

  static contentCategory(contentType: string): "image" | "text" | "video" | "audio" | "json" | "html" | "pdf" | "binary" {
    const ct = contentType.toLowerCase();
    if (ct.startsWith("image/")) return "image";
    if (ct.startsWith("video/")) return "video";
    if (ct.startsWith("audio/")) return "audio";
    if (ct === "application/json") return "json";
    if (ct === "application/pdf") return "pdf";
    if (ct === "text/html") return "html";
    if (ct.startsWith("text/")) return "text";
    return "binary";
  }

  /* ---- Bookmark helpers ---- */

  static async getBookmarks(): Promise<ArweaveBookmark[]> {
    const { data } = await supabase
      .from("arweave_bookmarks")
      .select("*")
      .order("created_at", { ascending: false });
    return (data ?? []) as ArweaveBookmark[];
  }

  static async addBookmark(
    type: "transaction" | "address" | "content",
    targetId: string,
    label?: string,
    notes?: string,
  ): Promise<void> {
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (!userId) return;
    await supabase.from("arweave_bookmarks").upsert(
      { user_id: userId, bookmark_type: type, target_id: targetId, label: label || null, notes: notes || null },
      { onConflict: "user_id,bookmark_type,target_id" },
    );
  }

  static async removeBookmark(id: string): Promise<void> {
    await supabase.from("arweave_bookmarks").delete().eq("id", id);
  }

  /* ---- Upload history ---- */

  static async getUploads(): Promise<ArweaveUploadRecord[]> {
    const { data } = await supabase
      .from("arweave_uploads")
      .select("*")
      .order("created_at", { ascending: false });
    return (data ?? []) as ArweaveUploadRecord[];
  }

  /* ---- Gateway stats ---- */

  static async getGatewayStats(): Promise<{
    totalRequests: number;
    cacheHitRate: number;
    avgResponseMs: number;
  }> {
    const { data } = await supabase
      .from("arweave_gateway_logs")
      .select("cache_hit, response_time_ms");
    if (!data || data.length === 0) return { totalRequests: 0, cacheHitRate: 0, avgResponseMs: 0 };
    const total = data.length;
    const hits = data.filter((r) => r.cache_hit).length;
    const avgMs = data.reduce((sum, r) => sum + (r.response_time_ms || 0), 0) / total;
    return { totalRequests: total, cacheHitRate: total > 0 ? hits / total : 0, avgResponseMs: Math.round(avgMs) };
  }
}

export { b64urlEncode, b64urlDecode, sha256, winstonToAr, arToWinston };
export default ArweaveGateway;
