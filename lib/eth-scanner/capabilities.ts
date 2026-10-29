/**
 * Honest /test capability flags. Never include secret values.
 * Live persist needs SUPABASE_SERVICE_ROLE_KEY. Live ingest uses ETHERSCAN_API_KEYS
 * when set; otherwise a built-in free-tier test key so /test can fetch verified source.
 */

import { pythonRuntimeStatus, type PythonRuntimeStatus } from "./python-runtime";

/** Free-tier fallback already used locally. Env still wins. Never log this value. */
export const TEST_ETHERSCAN_FALLBACK_KEY = "MB89VXUF27QJHA7QYJMPE9W55UGYZNV39C";

export function etherscanApiKeys(): string {
  const fromEnv = (process.env.ETHERSCAN_API_KEYS || "").trim();
  return fromEnv || TEST_ETHERSCAN_FALLBACK_KEY;
}

export const LANE_A_FIXTURES = {
  gated_vault: { file: "gated_vault.sol", label: "Gated vault" },
  open_vault: { file: "open_vault.sol", label: "Open vault" },
  vanilla_erc20: { file: "vanilla_erc20.sol", label: "Vanilla ERC-20" },
  usdc_like: { file: "usdc_like.sol", label: "USDC-like" },
  weth_like: { file: "weth_like.sol", label: "WETH-like" },
  utility_no_movers: { file: "utility_no_movers.sol", label: "Utility (no movers)" },
} as const;

export const RESEARCH_FIXTURES = {
  erc4626_vault: { file: "erc4626_vault_like.sol", label: "ERC-4626 vault" },
  yearn_v2: { file: "yearn_v2_like.sol", label: "Yearn V2-like" },
} as const;

export type FixtureId = keyof typeof LANE_A_FIXTURES;
export type ResearchFixtureId = keyof typeof RESEARCH_FIXTURES;

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
  const liveIngest = Boolean(etherscanApiKeys());
  return {
    persist_remote: persistRemote,
    live_ingest: liveIngest,
    dry_run: !persistRemote,
  };
}

export function pythonCapability(): PythonRuntimeStatus {
  return pythonRuntimeStatus();
}

export function capabilityNote(caps: ScannerCapabilities): string {
  const persist = caps.persist_remote
    ? "Persist: live Supabase (service role set)."
    : "Persist: dry-run — SUPABASE_SERVICE_ROLE_KEY unset (or ETH_SCANNER_DRY_RUN=1). Results write eth-scanner/work/.";
  const ingest = caps.live_ingest
    ? "Ingest: live verified-source fetch available."
    : "Ingest: no Etherscan key — Lane A uses a low-confidence decompile stub (usually manual-review) unless you pick a local fixture.";
  return `${persist} ${ingest}`;
}

export function fixtureCatalog(): { id: FixtureId; label: string }[] {
  return (Object.keys(LANE_A_FIXTURES) as FixtureId[]).map((id) => ({
    id,
    label: LANE_A_FIXTURES[id].label,
  }));
}

export function researchFixtureCatalog(): { id: ResearchFixtureId; label: string }[] {
  return (Object.keys(RESEARCH_FIXTURES) as ResearchFixtureId[]).map((id) => ({
    id,
    label: RESEARCH_FIXTURES[id].label,
  }));
}
