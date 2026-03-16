/**
 * Warp SmartWeave contract integration.
 *
 * Provides contract state reading via DRE (Distributed Resolution
 * Environment) nodes, interaction browsing via the Warp Gateway,
 * Atomic Asset (NFT) parsing, and PST balance checking.
 *
 * Uses direct REST API calls — no warp-contracts SDK dependency.
 */

import {
  DRE_NODES,
  WARP_GATEWAY_URL as WARP_GATEWAY,
  SONAR_URL,
} from "./config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SmartWeaveState {
  state: Record<string, unknown>;
  validity: Record<string, boolean>;
  sortKey: string;
  contractTxId: string;
}

export interface ContractInteraction {
  id: string;
  owner: string;
  block: { height: number; timestamp: number };
  input: Record<string, unknown>;
  tags: { name: string; value: string }[];
}

export interface AtomicAsset {
  contractTxId: string;
  title: string;
  description: string;
  type: string;
  contentType: string;
  ticker: string;
  owner: string;
  balances: Record<string, number>;
  claimable: unknown[];
  transferable: boolean;
  contentUrl: string;
}

export interface PstInfo {
  contractTxId: string;
  name: string;
  ticker: string;
  owner: string;
  balances: Record<string, number>;
  totalSupply: number;
}

/* ------------------------------------------------------------------ */
/*  Contract state via DRE                                             */
/* ------------------------------------------------------------------ */

/**
 * Reads the current state of a SmartWeave contract via DRE nodes.
 * Tries multiple DRE nodes for redundancy.
 */
export async function readContractState(
  contractId: string,
): Promise<SmartWeaveState> {
  for (const dre of DRE_NODES) {
    try {
      const res = await fetch(
        `${dre}/contract?id=${contractId}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.state) {
        return {
          state: data.state,
          validity: data.validity || {},
          sortKey: data.sortKey || "",
          contractTxId: contractId,
        };
      }
    } catch {
      continue;
    }
  }
  throw new Error(`Failed to read contract ${contractId} from any DRE node`);
}

/**
 * Reads a single field from a contract state.
 */
export async function readContractField<T>(
  contractId: string,
  field: string,
): Promise<T | undefined> {
  const { state } = await readContractState(contractId);
  return state[field] as T | undefined;
}

/* ------------------------------------------------------------------ */
/*  Contract interactions via Warp Gateway                             */
/* ------------------------------------------------------------------ */

export async function getContractInteractions(
  contractId: string,
  opts?: { limit?: number; from?: string },
): Promise<ContractInteraction[]> {
  const params = new URLSearchParams({ contractId });
  if (opts?.limit) params.set("limit", opts.limit.toString());
  if (opts?.from) params.set("from", opts.from);

  try {
    const res = await fetch(
      `${WARP_GATEWAY}/gateway/interactions?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.interactions || []).map((ix: Record<string, unknown>) => ({
      id: ix.id,
      owner: (ix.owner as Record<string, string>)?.address || "",
      block: ix.block || { height: 0, timestamp: 0 },
      input: ix.input || {},
      tags: ix.tags || [],
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Atomic Assets (NFTs on Arweave)                                    */
/* ------------------------------------------------------------------ */

/**
 * Parses an Atomic Asset from its contract state.
 * Atomic Assets follow the Arweave Atomic Asset standard:
 * a single transaction that is both the content AND the contract.
 */
export async function getAtomicAsset(
  contractId: string,
): Promise<AtomicAsset | null> {
  try {
    const { state } = await readContractState(contractId);
    const s = state as Record<string, unknown>;

    return {
      contractTxId: contractId,
      title: (s.title as string) || (s.name as string) || "Untitled",
      description: (s.description as string) || "",
      type: (s.contentType as string) || (s.type as string) || "unknown",
      contentType: (s.contentType as string) || "",
      ticker: (s.ticker as string) || "ATOMIC",
      owner: (s.owner as string) || Object.keys(s.balances as Record<string, number> || {})[0] || "",
      balances: (s.balances as Record<string, number>) || {},
      claimable: (s.claimable as unknown[]) || [],
      transferable: s.transferable !== false,
      contentUrl: `https://arweave.net/${contractId}`,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  PST (Profit Sharing Token)                                         */
/* ------------------------------------------------------------------ */

/**
 * Gets PST info including all balances.
 */
export async function getPstInfo(
  contractId: string,
): Promise<PstInfo | null> {
  try {
    const { state } = await readContractState(contractId);
    const s = state as Record<string, unknown>;
    const balances = (s.balances as Record<string, number>) || {};
    const totalSupply = Object.values(balances).reduce((sum, b) => sum + b, 0);

    return {
      contractTxId: contractId,
      name: (s.name as string) || "Unknown PST",
      ticker: (s.ticker as string) || "PST",
      owner: (s.owner as string) || "",
      balances,
      totalSupply,
    };
  } catch {
    return null;
  }
}

/**
 * Gets a specific wallet's PST balance.
 */
export async function getPstBalance(
  contractId: string,
  walletAddress: string,
): Promise<number> {
  const info = await getPstInfo(contractId);
  if (!info) return 0;
  return info.balances[walletAddress] || 0;
}

/* ------------------------------------------------------------------ */
/*  Well-known contracts                                               */
/* ------------------------------------------------------------------ */

export const KNOWN_CONTRACTS = {
  // The original ArDrive PST
  ARDRIVE: "-8A6RexFkpfWwuyVO98wzSFZh0d6VJuI-buTJvlwOJQ",
  // U token (universal)
  U: "KTzTXT_ANmF84fWEKHzWURD1LWd9QaFR9yfYUwH2Lxw",
  // Bazar NFT marketplace contract
  BAZAR: "TFWDStV7VbS-aSxpKk9Sm-7NBDM6VfN8lLblcLm4yk",
} as const;

/* ------------------------------------------------------------------ */
/*  Explorer links                                                     */
/* ------------------------------------------------------------------ */

export function getSonarUrl(contractId: string): string {
  return `${SONAR_URL}/#/app/contract/${contractId}`;
}

export function getViewBlockContractUrl(contractId: string): string {
  return `https://viewblock.io/arweave/tx/${contractId}`;
}

/* ------------------------------------------------------------------ */
/*  Vouch Protocol — verify wallet reputation                          */
/* ------------------------------------------------------------------ */

const VOUCH_CONTRACT = "k2U_J02u5ScJGHLrIDyDBYtx_IXLC4hEPlXe55Ds_Dc";

export async function getVouchScore(
  walletAddress: string,
): Promise<{ vouched: boolean; score: number; vouchers: string[] }> {
  try {
    const { state } = await readContractState(VOUCH_CONTRACT);
    const vouches = (state as Record<string, unknown>).vouches as Record<string, Record<string, unknown>> | undefined;

    if (!vouches || !vouches[walletAddress]) {
      return { vouched: false, score: 0, vouchers: [] };
    }

    const entry = vouches[walletAddress];
    const vouchers = Object.keys(entry);
    return {
      vouched: vouchers.length > 0,
      score: vouchers.length,
      vouchers,
    };
  } catch {
    return { vouched: false, score: 0, vouchers: [] };
  }
}
