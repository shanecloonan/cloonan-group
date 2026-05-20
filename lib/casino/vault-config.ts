/**
 * Client-safe vault deployment config (from NEXT_PUBLIC_* env vars).
 */

export type VaultChainStatus = {
  chainId: string;
  display: string;
  vaultAddress: string | null;
  rpcConfigured: boolean;
  ready: boolean;
};

const CHAINS: { id: string; display: string; envKey: string; rpcKey: string }[] = [
  { id: "ethereum-mainnet", display: "Ethereum", envKey: "ETHEREUM_MAINNET", rpcKey: "ETHEREUM_MAINNET" },
  { id: "ethereum-base", display: "Base", envKey: "ETHEREUM_BASE", rpcKey: "ETHEREUM_BASE" },
  { id: "ethereum-arbitrum", display: "Arbitrum", envKey: "ETHEREUM_ARBITRUM", rpcKey: "ETHEREUM_ARBITRUM" },
  { id: "ethereum-sepolia", display: "Sepolia (test)", envKey: "ETHEREUM_SEPOLIA", rpcKey: "ETHEREUM_SEPOLIA" },
];

function readVault(chainEnv: string): string | null {
  const v = process.env[`NEXT_PUBLIC_CASINO_VAULT_${chainEnv}` as keyof NodeJS.ProcessEnv];
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
}

function readRpc(chainEnv: string): boolean {
  const v = process.env[`NEXT_PUBLIC_CASINO_RPC_${chainEnv}` as keyof NodeJS.ProcessEnv];
  return typeof v === "string" && v.startsWith("http");
}

/** Server or client — only NEXT_PUBLIC vars are visible in the browser. */
export function getVaultChainStatuses(): VaultChainStatus[] {
  return CHAINS.map((c) => {
    const vaultAddress = readVault(c.envKey);
    const rpcConfigured = readRpc(c.rpcKey);
    return {
      chainId: c.id,
      display: c.display,
      vaultAddress,
      rpcConfigured,
      ready: !!vaultAddress,
    };
  });
}

export function isAnyVaultDeployed(): boolean {
  return getVaultChainStatuses().some((c) => c.ready);
}
