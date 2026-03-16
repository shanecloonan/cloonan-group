import { supabase } from "./supabase";
import { ARWEAVE_GATEWAY_URL, ARWEAVE_DIRECT_GATEWAYS } from "./config";
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
  GqlQueryParams,
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

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || ARWEAVE_GATEWAY_URL;
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

  private async gw(path: string, opts: RequestInit = {}): Promise<Response> {
    const authHeaders = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: { ...authHeaders, ...((opts.headers as Record<string, string>) || {}) },
    });
    return res;
  }

  /**
   * Falls back to direct gateway access if the edge function isn't reachable
   * (e.g. user not authenticated). Tries each gateway in order.
   */
  private async directFetch(path: string): Promise<Response> {
    for (const gw of ARWEAVE_DIRECT_GATEWAYS) {
      try {
        const res = await fetch(`${gw}${path}`, { signal: AbortSignal.timeout(12000) });
        if (res.ok || res.status < 500) return res;
      } catch {
        continue;
      }
    }
    return new Response("All gateways failed", { status: 502 });
  }

  private async fetchWithFallback(path: string, opts?: RequestInit): Promise<Response> {
    try {
      const res = await this.gw(path, opts);
      if (res.ok || res.status < 500) return res;
    } catch { /* fall through */ }
    if (!opts || opts.method === "GET" || !opts.method) {
      return this.directFetch(path);
    }
    throw new Error("Gateway request failed");
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

  async submitTx(tx: Record<string, unknown>): Promise<{ status: number; body: string }> {
    const res = await this.gw("/tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tx),
    });
    return { status: res.status, body: await res.text() };
  }

  async submitChunk(chunk: Record<string, unknown>): Promise<{ status: number }> {
    const res = await this.gw("/chunk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    return { status: res.status };
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

  static async signTransaction(
    tx: { owner?: string; target: string; data?: string; quantity: string; reward: string; last_tx: string; tags: { name: string; value: string }[]; data_root: string; data_size: string },
    jwk: JsonWebKey,
  ): Promise<Record<string, unknown>> {
    const msg = JSON.stringify({
      owner: tx.owner, target: tx.target, data: tx.data, quantity: tx.quantity,
      reward: tx.reward, last_tx: tx.last_tx, tags: tx.tags || [],
      data_root: tx.data_root, data_size: tx.data_size,
    });
    const msgBuffer = new TextEncoder().encode(msg);
    const privKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, privKey, msgBuffer);
    const sigB64 = b64urlEncode(signature);
    const sigHash = await sha256(signature);
    const id = b64urlEncode(sigHash);
    return { ...tx, format: 2, signature: sigB64, id };
  }

  static async buildTransferTx(
    target: string,
    arAmount: string,
    jwk: JsonWebKey,
    anchor: string,
    reward: string,
  ): Promise<Record<string, unknown>> {
    const quantity = arToWinston(arAmount);
    const tx = {
      owner: jwk.n,
      target,
      quantity,
      reward,
      last_tx: anchor,
      tags: [] as { name: string; value: string }[],
      data_size: "0",
      data_root: "",
    };
    return ArweaveGateway.signTransaction(tx, jwk);
  }

  static async buildDataTx(
    data: Uint8Array,
    tags: ArweaveTag[],
    jwk: JsonWebKey,
    anchor: string,
    reward: string,
  ): Promise<Record<string, unknown>> {
    const dataRoot = await sha256(data);
    const encodedTags = tags.map((t) => ({
      name: btoa(t.name),
      value: btoa(t.value),
    }));
    const tx = {
      owner: jwk.n,
      target: "",
      quantity: "0",
      reward,
      last_tx: anchor,
      tags: encodedTags,
      data_size: data.byteLength.toString(),
      data_root: b64urlEncode(dataRoot),
      data: b64urlEncode(data),
    };
    return ArweaveGateway.signTransaction(tx, jwk);
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

    const tx = await ArweaveGateway.buildDataTx(data, allTags, jwk, anchor, reward);
    const txId = tx.id as string;

    // Track upload in DB
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (userId) {
      await supabase.from("arweave_uploads").insert({
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

    // Small data: submit in one go
    if (data.byteLength <= 256 * 1024) {
      const result = await this.submitTx(tx);
      const status = result.status === 200 ? "submitted" : "failed";
      if (userId) {
        await supabase.from("arweave_uploads").update({ status }).eq("tx_id", txId);
      }
      onProgress?.(100);
      return { txId, status: result.status, cost };
    }

    // Large data: chunked upload
    const txWithoutData = { ...tx };
    delete txWithoutData.data;
    const submitResult = await this.submitTx(txWithoutData);
    if (submitResult.status !== 200) {
      if (userId) {
        await supabase.from("arweave_uploads").update({ status: "failed" }).eq("tx_id", txId);
      }
      return { txId, status: submitResult.status, cost };
    }

    const chunkSize = 256 * 1024;
    let offset = 0;
    while (offset < data.byteLength) {
      const chunk = data.slice(offset, offset + chunkSize);
      offset += chunk.byteLength;
      const chunkB64 = b64urlEncode(chunk);
      const chunkResult = await this.submitChunk({
        data_root: tx.data_root,
        data_size: tx.data_size,
        data_path: "",
        offset: offset - chunk.byteLength,
        chunk: chunkB64,
      });
      if (chunkResult.status !== 200) {
        if (userId) {
          await supabase.from("arweave_uploads").update({ status: "failed" }).eq("tx_id", txId);
        }
        throw new Error(`Chunk upload failed at ${((offset / data.byteLength) * 100).toFixed(1)}%`);
      }
      onProgress?.(Math.round((offset / data.byteLength) * 100));
    }

    if (userId) {
      await supabase.from("arweave_uploads").update({ status: "submitted" }).eq("tx_id", txId);
    }
    return { txId, status: 200, cost };
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
