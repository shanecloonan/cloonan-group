/**
 * Honest /test capability flags. Never include secret values.
 * Live persist needs SUPABASE_SERVICE_ROLE_KEY; live ingest needs ETHERSCAN_API_KEYS.
 */

export const LANE_A_FIXTURES = {
  gated_vault: { file: "gated_vault.sol", label: "Gated vault" },
  open_vault: { file: "open_vault.sol", label: "Open vault" },
  vanilla_erc20: { file: "vanilla_erc20.sol", label: "Vanilla ERC-20" },
  usdc_like: { file: "usdc_like.sol", label: "USDC-like" },
  weth_like: { file: "weth_like.sol", label: "WETH-like" },
  utility_no_movers: { file: "utility_no_movers.sol", label: "Utility (no movers)" },
} as const;

export type FixtureId = keyof typeof LANE_A_FIXTURES;

export type ScannerCapabilities = {
  persist_remote: boolean;
  live_ingest: boolean;
  dry_run: boolean;
};

function envOn(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] || "").trim().toLowerCase());
}

export function scannerCapabilities(): ScannerCapabilities {
  const persistRemote = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) && !envOn("ETH_SCANNER_DRY_RUN");
  const liveIngest = Boolean(process.env.ETHERSCAN_API_KEYS?.trim());
  return {
    persist_remote: persistRemote,
    live_ingest: liveIngest,
    dry_run: !persistRemote,
  };
}

export function capabilityNote(caps: ScannerCapabilities): string {
  const persist = caps.persist_remote
    ? "Persist: live Supabase (service role set)."
    : "Persist: dry-run — SUPABASE_SERVICE_ROLE_KEY unset (or ETH_SCANNER_DRY_RUN=1). Results write eth-scanner/work/.";
  const ingest = caps.live_ingest
    ? "Ingest: ETHERSCAN_API_KEYS set — live verified-source fetch."
    : "Ingest: ETHERSCAN_API_KEYS unset — Lane A uses a low-confidence decompile stub (usually manual-review) unless you pick a local fixture.";
  return `${persist} ${ingest}`;
}

export function fixtureCatalog(): { id: FixtureId; label: string }[] {
  return (Object.keys(LANE_A_FIXTURES) as FixtureId[]).map((id) => ({
    id,
    label: LANE_A_FIXTURES[id].label,
  }));
}
