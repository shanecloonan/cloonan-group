import { supabase } from "./supabase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DApp =
  | "wallets"
  | "etf"
  | "dividends"
  | "dao"
  | "dex"
  | "auction"
  | "multiswap"
  | "storefront"
  | "airdrop"
  | "moneydividends";

export type TxStatus = "success" | "error" | "pending";

export interface TxRecord {
  id: string;
  user_id: string;
  wallet_address: string;
  tx_hash: string | null;
  chain: string;
  dapp: DApp;
  action: string;
  status: TxStatus;
  amount: string | null;
  token_address: string | null;
  contract_address: string | null;
  gas_used: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LogTxParams {
  userId: string;
  walletAddress: string;
  txHash?: string | null;
  chain?: string;
  dapp: DApp;
  action: string;
  status?: TxStatus;
  amount?: string | null;
  tokenAddress?: string | null;
  contractAddress?: string | null;
  gasUsed?: string | null;
  details?: Record<string, unknown>;
}

export interface FetchActivityParams {
  userId: string;
  walletAddress?: string | null;
  dapp?: DApp | null;
  action?: string | null;
  status?: TxStatus | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

/* ------------------------------------------------------------------ */
/*  Log a transaction (fire-and-forget safe)                           */
/* ------------------------------------------------------------------ */

export async function logTransaction(params: LogTxParams): Promise<void> {
  try {
    await supabase.from("tx_history").insert({
      user_id: params.userId,
      wallet_address: params.walletAddress,
      tx_hash: params.txHash ?? null,
      chain: params.chain ?? "ethereum",
      dapp: params.dapp,
      action: params.action,
      status: params.status ?? "success",
      amount: params.amount ?? null,
      token_address: params.tokenAddress ?? null,
      contract_address: params.contractAddress ?? null,
      gas_used: params.gasUsed ?? null,
      details: params.details ?? {},
    });
  } catch {
    // Never let logging break the app
  }
}

/** Auto-detect userId from session when not available via wallet context */
export async function logTx(
  params: Omit<LogTxParams, "userId"> & { userId?: string },
): Promise<void> {
  let uid = params.userId;
  if (!uid) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      uid = session?.user?.id;
    } catch { /* no session */ }
  }
  if (!uid) return;
  return logTransaction({ ...params, userId: uid } as LogTxParams);
}

/* ------------------------------------------------------------------ */
/*  Fetch activity with filters                                        */
/* ------------------------------------------------------------------ */

export async function fetchActivity(
  params: FetchActivityParams,
): Promise<{ data: TxRecord[]; count: number }> {
  let query = supabase
    .from("tx_history")
    .select("*", { count: "exact" })
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false });

  if (params.walletAddress) {
    query = query.eq("wallet_address", params.walletAddress);
  }
  if (params.dapp) {
    query = query.eq("dapp", params.dapp);
  }
  if (params.action) {
    query = query.eq("action", params.action);
  }
  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.from) {
    query = query.gte("created_at", params.from);
  }
  if (params.to) {
    query = query.lte("created_at", params.to);
  }
  if (params.search) {
    query = query.or(
      `tx_hash.ilike.%${params.search}%,wallet_address.ilike.%${params.search}%,action.ilike.%${params.search}%`,
    );
  }

  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) throw error;
  return { data: (data as TxRecord[]) ?? [], count: count ?? 0 };
}

/* ------------------------------------------------------------------ */
/*  Helpers for display                                                */
/* ------------------------------------------------------------------ */

export const DAPP_META: Record<DApp, { label: string; icon: string; color: string }> = {
  wallets:        { label: "Wallets",          icon: "⬡",  color: "text-blue-400" },
  etf:            { label: "ETF",              icon: "📈", color: "text-amber-400" },
  dividends:      { label: "Dividends",        icon: "🥩", color: "text-purple-400" },
  dao:            { label: "DAO",              icon: "🗳️", color: "text-sky-400" },
  dex:            { label: "DEX",              icon: "🍒", color: "text-pink-400" },
  auction:        { label: "Ad-space",         icon: "🖼️", color: "text-orange-400" },
  multiswap:      { label: "Multiswap",        icon: "🐙", color: "text-teal-400" },
  storefront:     { label: "Storefront",       icon: "🛒", color: "text-emerald-400" },
  airdrop:        { label: "Airdrop",          icon: "🎁", color: "text-rose-400" },
  moneydividends: { label: "MONEY Dividends",  icon: "💰", color: "text-yellow-400" },
};

export const ACTION_LABELS: Record<string, string> = {
  send_eth: "Send ETH",
  send_token: "Send Token",
  swap_eth_to_token: "Swap ETH → Token",
  swap_token_to_eth: "Swap Token → ETH",
  create_etf: "Create ETF",
  mint_etf: "Mint ETF",
  burn_etf: "Burn ETF",
  withdraw_etf: "Withdraw ETF",
  create_pool: "Create Staking Pool",
  stake: "Stake",
  unstake: "Unstake",
  claim_rewards: "Claim Rewards",
  register_reward_token: "Register Reward Token",
  unregister_reward_token: "Unregister Reward Token",
  create_dao: "Create DAO",
  create_proposal: "Submit Proposal",
  vote: "Vote",
  execute_proposal: "Execute Proposal",
  reclaim_tokens: "Reclaim Tokens",
  create_pair: "Create Pair",
  add_liquidity: "Add Liquidity",
  remove_liquidity: "Remove Liquidity",
  swap_token: "Swap",
  deploy_auction: "Deploy Auction",
  place_bid: "Place Bid",
  sign_ad: "Sign Ad",
  update_sign_params: "Update Sign Params",
  update_sign_token: "Update Sign Token",
  delete_signers: "Delete Signers",
  deploy_multiswap: "Deploy Multiswap",
  create_storefront: "Create Storefront",
  deposit_nft: "Deposit NFT",
  list_nft: "List NFT",
  cancel_listing: "Cancel Listing",
  buy_nft: "Buy NFT",
  airdrop: "Airdrop Tokens",
};
