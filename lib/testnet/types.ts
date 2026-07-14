export type TestnetConfig = {
  product: string;
  network_id: string;
  genesis_id: string;
  upstream_repo: string;
  genesis_path: string;
  manifest_path: string;
  checkpoint_log_path: string;
  slot_duration_ms: number;
  validator_committee_size: number;
  boot_peers: string[];
  /** Live stats HTTP→TCP JSON-RPC proxy (POST /rpc). */
  rpc_proxy_url?: string | null;
  links: {
    invite: string;
    join: string;
    checkpoints: string;
    issues: string;
    operators: string;
    rpc_proxy: string;
  };
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown> | unknown[];
  id: number | string;
};

export type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

export type MfndStatus = {
  service?: string;
  status?: string;
  chain?: {
    genesis_id?: string;
    tip_height?: number;
    tip_id?: string;
    validator_count?: number;
  };
  mempool?: {
    pool_len?: number;
    root?: string;
  };
  p2p?: {
    configured?: boolean;
    peer_count?: number;
    session_count?: number;
    listen_addr?: string;
    distinct_ipv4_prefix16?: number;
  };
  rpc?: {
    public_bind?: boolean;
    listen_addr?: string;
    auth_enabled?: boolean;
  };
};

export type MfndTip = {
  height?: number;
  tip_height?: number;
  tip_id?: string;
  id?: string;
  genesis_id?: string;
};

export type BlockHeaderSummary = {
  height?: number;
  id?: string;
  tip_id?: string;
  block_id?: string;
};

export type RecentUpload = {
  height?: number;
  tx_id?: string;
  id?: string;
  summary?: string;
  [key: string]: unknown;
};
