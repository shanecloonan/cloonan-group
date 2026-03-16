export interface EthWallet {
  address: string;
  privateKey?: string;
  type: "moneyfund" | "metamask";
}

export type ArweaveWalletSource = "jwk" | "arconnect";

export interface ArweaveWalletData {
  jwk: JsonWebKey;
  address: string;
  source: ArweaveWalletSource;
}

export interface WalletRow {
  id: string;
  user_id: string;
  chain: "ethereum" | "arweave";
  address: string;
  encrypted_key: string | null;
  iv: string | null;
  wallet_type: string;
  label: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Arweave types                                                      */
/* ------------------------------------------------------------------ */

export interface ArweaveTag {
  name: string;
  value: string;
}

export interface ArweaveNetworkInfo {
  network: string;
  version: number;
  release: number;
  height: number;
  current: string;
  blocks: number;
  peers: number;
  queue_length: number;
  node_state_latency: number;
}

export interface ArweaveTxFull {
  format: number;
  id: string;
  last_tx: string;
  owner: string;
  tags: ArweaveTag[];
  target: string;
  quantity: string;
  data: string;
  data_size: string;
  data_root: string;
  reward: string;
  signature: string;
}

export interface ArweaveTxStatus {
  block_height: number;
  block_indep_hash: string;
  number_of_confirmations: number;
}

export interface ArweaveCostEstimate {
  winston: string;
  ar: string;
  usd: string;
  usd_per_ar: number;
}

export interface ArweaveGqlPageInfo {
  hasNextPage: boolean;
}

export interface ArweaveGqlNode {
  id: string;
  anchor: string;
  signature: string;
  recipient: string;
  owner: { address: string; key: string };
  fee: { winston: string; ar: string };
  quantity: { winston: string; ar: string };
  data: { size: string; type: string | null };
  tags: ArweaveTag[];
  block: { id: string; timestamp: number; height: number; previous: string } | null;
  parent: { id: string } | null;
}

export interface ArweaveGqlEdge {
  cursor: string;
  node: ArweaveGqlNode;
}

export interface ArweaveGqlResult {
  edges: ArweaveGqlEdge[];
  pageInfo: ArweaveGqlPageInfo;
}

export interface ArweaveUploadResult {
  txId: string;
  status: number;
  cost: ArweaveCostEstimate | null;
}

export interface ArweaveUploadRecord {
  id: string;
  user_id: string;
  tx_id: string | null;
  filename: string | null;
  data_size: number;
  content_type: string | null;
  tags: ArweaveTag[];
  status: "preparing" | "submitted" | "confirmed" | "failed";
  cost_winston: string | null;
  cost_ar: string | null;
  description: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export interface ArweaveBookmark {
  id: string;
  user_id: string;
  bookmark_type: "transaction" | "address" | "content";
  target_id: string;
  label: string | null;
  notes: string | null;
  created_at: string;
}

export interface ArweavePeerInfo {
  address: string;
  health: string;
  latency_ms: number;
  block_height: number;
  version: string | null;
  successes: number;
  failures: number;
  last_seen: string;
}

export interface ArweavePoolStatus {
  pool_fresh: boolean;
  active_peers: number;
  top_peers: ArweavePeerInfo[];
}

export interface ArweaveBlock {
  nonce: string;
  previous_block: string;
  timestamp: number;
  last_retarget: number;
  diff: string;
  height: number;
  hash: string;
  indep_hash: string;
  txs: string[];
  tx_root: string;
  wallet_list: string;
  reward_addr: string;
  reward_pool: number;
  weave_size: number;
  block_size: number;
}

export interface GqlQueryParams {
  owners?: string[];
  recipients?: string[];
  tags?: { name: string; values: string[] }[];
  block?: { min?: number; max?: number };
  first?: number;
  after?: string;
  sort?: "HEIGHT_ASC" | "HEIGHT_DESC";
}

/* ------------------------------------------------------------------ */
/*  Upload method (L1 vs bundled)                                      */
/* ------------------------------------------------------------------ */

export type UploadMethod = "l1" | "turbo";

export interface BundledUploadResult {
  txId: string;
  method: UploadMethod;
  turboTimestamp?: number;
  turboCaches?: string[];
}
