/* ===========================================================================
 *  Operator / dev: credit a finalized on-chain deposit to a user's ledger.
 *
 *  Requires .env.local (or env):
 *    SUPABASE_SERVICE_ROLE_KEY
 *    NEXT_PUBLIC_SUPABASE_URL
 *    NEXT_PUBLIC_CASINO_VAULT_* + RPC for the chain (for EVM receipt parse)
 *
 *  Usage:
 *    npx tsx scripts/credit-casino-deposit.ts ^
 *      --user-id <uuid> ^
 *      --chain ethereum-sepolia ^
 *      --tx 0x... ^
 *      --wallet 0xYourDepositSender
 *
 *  Optional: --amount-units (skip on-chain parse; dev-mock only really needs this)
 * ========================================================================= */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  USDC_SEPOLIA,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
  DEV_TOKEN,
  type ChainId,
  type TokenSpec,
} from "../lib/casino";
import { serverCreditDeposit } from "../lib/casino/deposit-credit";

function loadEnvLocal(): void {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

const TOKEN_BY_CHAIN: Partial<Record<ChainId, TokenSpec>> = {
  "dev-mock": DEV_TOKEN,
  "ethereum-sepolia": USDC_SEPOLIA,
  "ethereum-base": USDC_BASE,
  "ethereum-mainnet": USDC_ETHEREUM_MAINNET,
};

loadEnvLocal();

const userId = arg("--user-id");
const chainId = arg("--chain") as ChainId | undefined;
const txHash = arg("--tx");
const walletAddress = arg("--wallet");
const amountUnitsRaw = arg("--amount-units");

if (!userId || !chainId || !txHash || !walletAddress) {
  console.error(
    "Usage: npx tsx scripts/credit-casino-deposit.ts --user-id <uuid> --chain <chainId> --tx <hash> --wallet <0x>",
  );
  process.exit(1);
}

const token = TOKEN_BY_CHAIN[chainId];
if (!token) {
  console.error(`No default token for chain ${chainId}. Extend TOKEN_BY_CHAIN in this script.`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

let amountUnits: bigint | undefined;
if (amountUnitsRaw) {
  try {
    amountUnits = BigInt(amountUnitsRaw);
  } catch {
    console.error("Invalid --amount-units");
    process.exit(1);
  }
}

(async () => {
  console.log(`Crediting deposit for user ${userId} on ${chainId}…`);
  const result = await serverCreditDeposit(supabase, userId, {
    chainId,
    token,
    txHash,
    walletAddress,
    amountUnits,
  });

  if ("error" in result) {
    console.error(`Failed (${result.status}): ${result.error}`);
    process.exit(1);
  }

  console.log(
    result.alreadyCredited
      ? `Already credited — ${result.amount.toString()} units`
      : `Credited ${result.amount.toString()} ${token.symbol} units`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
