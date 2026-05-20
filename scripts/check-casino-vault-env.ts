/* ===========================================================================
 *  Print CasinoVault / operator env readiness (no keys printed).
 *  Run: npx tsx scripts/check-casino-vault-env.ts
 * ========================================================================= */

import { getVaultChainStatuses } from "../lib/casino/vault-config";

function flag(ok: boolean) {
  return ok ? "✓" : "✗";
}

console.log("=== Casino vault env checklist ===\n");

const chains = getVaultChainStatuses();
for (const c of chains) {
  console.log(
    `${flag(c.ready)} ${c.display} (${c.chainId})` +
      `  vault=${c.vaultAddress ?? "unset"}` +
      `  rpc=${c.rpcConfigured ? "set" : "unset"}`,
  );
}

console.log("");
console.log(`${flag(!!process.env.CASINO_OPERATOR_KEY)} CASINO_OPERATOR_KEY (withdraw EIP-712)`);
console.log(
  `${flag(!!process.env.CASINO_OPERATOR_SECRET)} CASINO_OPERATOR_SECRET (indexer webhooks)`,
);
console.log(
  `${flag(!!process.env.SUPABASE_SERVICE_ROLE_KEY)} SUPABASE_SERVICE_ROLE_KEY (operator routes)`,
);

const any = chains.some((c) => c.ready);
if (!any) {
  console.log("\nNo vault deployed in env — use Dev / Play Money or run:");
  console.log("  .\\scripts\\deploy-casino-vault.ps1");
  console.log("  .\\scripts\\configure-casino-vault.ps1  # ALLOW_TOKEN=0x1c7D4B196Cb0C7B29D5Daedb9e2cCeDaD4d5D4f4");
  console.log("Then set NEXT_PUBLIC_CASINO_VAULT_ETHEREUM_SEPOLIA and CASINO_OPERATOR_KEY.");
} else {
  console.log("\nAt least one chain has NEXT_PUBLIC_CASINO_VAULT_* set.");
}
