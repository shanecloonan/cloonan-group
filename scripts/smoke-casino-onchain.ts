/* ===========================================================================
 *  Smoke test: lib/casino — Ethereum adapter + operator EIP-712 signing
 *  ---------------------------------------------------------------------------
 *  Validates the Phase-1 on-chain deposit/withdraw plumbing WITHOUT a real
 *  RPC connection. Specifically:
 *
 *   1. ERC-20 `approve(...)` and CasinoVault `deposit(...)` calldata
 *      encoding is deterministic and matches the canonical 4-byte
 *      selectors.
 *   2. CasinoVault `withdraw(...)` calldata encoding round-trips: encode →
 *      decode produces the original args.
 *   3. EIP-712 operator signing: a voucher signed with a known key
 *      recovers to the expected operator address.
 *   4. Tampering with any field of the voucher invalidates the signature
 *      (defense-in-depth check).
 *   5. `buildDepositTx` / `buildWithdrawTx` produce well-formed
 *      `UnsignedTx` objects.
 *
 *  Run:  npx tsx scripts/smoke-casino-onchain.ts
 * ========================================================================= */

import { ethers } from "ethers";
import {
  CASINO_VAULT_ABI,
  ERC20_ABI,
  ERC20_IFACE,
  RealEthereumAdapter,
  USDC_BASE,
  VAULT_IFACE,
  sessionRefBytes32,
  signWithdrawalVoucher,
  verifyWithdrawalVoucher,
  DEV_OPERATOR_KEY,
  DEV_OPERATOR_ADDRESS,
  type SigningDomain,
  type WithdrawalVoucher,
} from "../lib/casino";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  console.log("── 1. ABI fragments parse cleanly ─────────────────────────");
  assert(ERC20_ABI.length > 0, "ERC20_ABI parsed");
  assert(CASINO_VAULT_ABI.length > 0, "CASINO_VAULT_ABI parsed");
  console.log(
    `  ERC20: ${ERC20_ABI.length} fragments · Vault: ${CASINO_VAULT_ABI.length} fragments ✓`,
  );

  console.log("── 2. approve(...) selector + calldata ────────────────────");
  // keccak256("approve(address,uint256)") = 0x095ea7b3...
  const APPROVE_SELECTOR = "0x095ea7b3";
  const vaultAddr = "0x1111111111111111111111111111111111111111";
  const amount = 5_000_000n; // 5 USDC
  const data = ERC20_IFACE.encodeFunctionData("approve", [
    vaultAddr,
    ethers.BigNumber.from(amount.toString()),
  ]);
  assert(data.startsWith(APPROVE_SELECTOR), `approve selector mismatch: ${data.slice(0, 10)}`);
  console.log(`  approve(${vaultAddr}, ${amount}) → ${data.slice(0, 10)}… ✓`);

  console.log("── 3. CasinoVault.deposit(...) selector + roundtrip ───────");
  // keccak256("deposit(address,uint256)") = 0x47e7ef24...
  const DEPOSIT_SELECTOR = "0x47e7ef24";
  const depositData = VAULT_IFACE.encodeFunctionData("deposit", [
    USDC_BASE.address,
    ethers.BigNumber.from(amount.toString()),
  ]);
  assert(depositData.startsWith(DEPOSIT_SELECTOR), `deposit selector mismatch: ${depositData.slice(0, 10)}`);
  const decoded = VAULT_IFACE.decodeFunctionData("deposit", depositData);
  assert(decoded.token.toLowerCase() === USDC_BASE.address.toLowerCase(), "token roundtrips");
  assert(BigInt(decoded.amount.toString()) === amount, "amount roundtrips");
  console.log(`  deposit(${USDC_BASE.address}, ${amount}) encode↔decode ✓`);

  console.log("── 4. CasinoVault.withdraw(...) roundtrip ─────────────────");
  const user = "0x2222222222222222222222222222222222222222";
  const nonce = 17n;
  const sessionRef = sessionRefBytes32("session-uuid-abc");
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const sig =
    "0x" + "11".repeat(65);
  const withdrawData = VAULT_IFACE.encodeFunctionData("withdraw", [
    user,
    USDC_BASE.address,
    ethers.BigNumber.from(amount.toString()),
    ethers.BigNumber.from(nonce.toString()),
    sessionRef,
    ethers.BigNumber.from(expiresAt),
    sig,
  ]);
  const decW = VAULT_IFACE.decodeFunctionData("withdraw", withdrawData);
  assert(decW.user.toLowerCase() === user.toLowerCase(), "user roundtrips");
  assert(decW.token.toLowerCase() === USDC_BASE.address.toLowerCase(), "withdraw token roundtrips");
  assert(BigInt(decW.amount.toString()) === amount, "withdraw amount roundtrips");
  assert(BigInt(decW.nonce.toString()) === nonce, "nonce roundtrips");
  assert(decW.sessionRef === sessionRef, "sessionRef roundtrips");
  assert(BigInt(decW.expiresAt.toString()) === BigInt(expiresAt), "expiresAt roundtrips");
  assert(decW.operatorSig === sig, "operatorSig roundtrips");
  console.log(`  withdraw(...) 7-arg encode↔decode ✓`);

  console.log("── 5. sessionRef sha256 determinism ────────────────────────");
  const a = sessionRefBytes32("hello");
  const b = sessionRefBytes32("hello");
  const c = sessionRefBytes32("hello!");
  assert(a === b, "same input → same hash");
  assert(a !== c, "different input → different hash");
  assert(/^0x[0-9a-f]{64}$/.test(a), "sessionRef is bytes32 hex");
  console.log(`  sha256("hello") = ${a.slice(0, 14)}… (32-byte hex ✓)`);

  console.log("── 6. EIP-712 signWithdrawalVoucher / recovery ────────────");
  const domain: SigningDomain = {
    chainId: 8453, // Base
    verifyingContract: "0x3333333333333333333333333333333333333333",
  };
  const voucher: WithdrawalVoucher = {
    user,
    token: USDC_BASE.address,
    amount,
    nonce,
    sessionRef,
    expiresAt,
  };
  const signed = await signWithdrawalVoucher({
    operatorKey: DEV_OPERATOR_KEY,
    domain,
    voucher,
  });
  assert(signed.operatorAddress === DEV_OPERATOR_ADDRESS, "operator address from key");
  assert(/^0x[0-9a-f]{130}$/.test(signed.signature), `signature shape: ${signed.signature.length}`);
  console.log(`  voucher signed → ${signed.signature.slice(0, 20)}… (operator ${signed.operatorAddress.slice(0, 10)}…) ✓`);

  console.log("── 7. EIP-712 verifyWithdrawalVoucher recovers ─────────────");
  const v = verifyWithdrawalVoucher({
    domain,
    voucher,
    signature: signed.signature,
    expectedOperator: signed.operatorAddress,
  });
  assert(v.ok, `signature should verify against operator (recovered ${v.recovered})`);
  console.log(`  recovered ${v.recovered} matches operator ✓`);

  console.log("── 8. Tampered voucher invalidates signature ──────────────");
  const tampered: WithdrawalVoucher = { ...voucher, amount: voucher.amount + 1n };
  const v2 = verifyWithdrawalVoucher({
    domain,
    voucher: tampered,
    signature: signed.signature,
    expectedOperator: signed.operatorAddress,
  });
  assert(!v2.ok, "tampered amount should NOT verify");
  console.log(`  tampered amount → recovered ${v2.recovered.slice(0, 10)}… ≠ operator ✓`);

  // Other field tampering
  const tampered2: WithdrawalVoucher = { ...voucher, user: "0x4444444444444444444444444444444444444444" };
  const v3 = verifyWithdrawalVoucher({
    domain,
    voucher: tampered2,
    signature: signed.signature,
    expectedOperator: signed.operatorAddress,
  });
  assert(!v3.ok, "tampered user should NOT verify");
  console.log(`  tampered user → recovered ${v3.recovered.slice(0, 10)}… ≠ operator ✓`);

  // Tampering with the DOMAIN (chainId) also invalidates — replay protection.
  const v4 = verifyWithdrawalVoucher({
    domain: { ...domain, chainId: 1 },
    voucher,
    signature: signed.signature,
    expectedOperator: signed.operatorAddress,
  });
  assert(!v4.ok, "different chainId should NOT verify (replay protection)");
  console.log(`  cross-chain replay attempt → blocked ✓`);

  console.log("── 9. RealEthereumAdapter constructs + builds tx ──────────");
  const adapter = new RealEthereumAdapter({
    chainId: "ethereum-base",
    display: "Base (test)",
    evmChainId: 8453,
    vaultAddress: "0x3333333333333333333333333333333333333333",
    rpcUrl: "http://localhost:1", // never actually called in this test
    explorerBaseUrl: "https://basescan.org",
    requiredConfirmations: 5,
    supportedTokens: [USDC_BASE],
    nativeCurrency: USDC_BASE,
  });
  assert(adapter.getVaultAddress() === "0x3333333333333333333333333333333333333333", "vault addr");
  assert(adapter.txUrl("0xdeadbeef") === "https://basescan.org/tx/0xdeadbeef", "tx url helper");

  const depositTx = await adapter.buildDepositTx({
    user,
    token: USDC_BASE,
    amount,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = depositTx.payload as any;
  assert(payload.kind === "eth_deposit_multicall", "deposit tx kind");
  assert(payload.calls.length === 2, "deposit multicall has 2 steps");
  assert(payload.calls[0].label === "approve", "first call is approve");
  assert(payload.calls[1].label === "deposit", "second call is deposit");
  assert(payload.calls[0].data.startsWith(APPROVE_SELECTOR), "approve selector inside payload");
  assert(payload.calls[1].data.startsWith(DEPOSIT_SELECTOR), "deposit selector inside payload");

  const withdrawTx = await adapter.buildWithdrawTx({
    user,
    token: USDC_BASE,
    amount,
    sessionId: "session-uuid-abc",
    serverSignature: signed.signature,
    nonce,
    expiresAt,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wp = withdrawTx.payload as any;
  assert(wp.kind === "eth_withdraw", "withdraw tx kind");
  assert(wp.to.toLowerCase() === adapter.getVaultAddress().toLowerCase(), "withdraw target = vault");
  // Inspect the encoded calldata.
  const dec = VAULT_IFACE.decodeFunctionData("withdraw", wp.data);
  assert(dec.user.toLowerCase() === user.toLowerCase(), "withdraw payload user matches");
  assert(BigInt(dec.amount.toString()) === amount, "withdraw payload amount matches");
  assert(dec.operatorSig === signed.signature, "withdraw payload sig matches");
  console.log(`  deposit + withdraw UnsignedTx objects well-formed ✓`);

  console.log("── 10. Native ETH deposit gracefully refused ──────────────");
  let nativeErr: string | null = null;
  try {
    await adapter.buildDepositTx({
      user,
      token: { ...USDC_BASE, isNative: true, symbol: "ETH", address: "0x0000000000000000000000000000000000000000" },
      amount,
    });
  } catch (e) {
    nativeErr = (e as Error).message;
  }
  assert(nativeErr !== null && /native eth/i.test(nativeErr), "native ETH deposit must throw");
  console.log(`  native ETH path correctly refused: "${nativeErr?.slice(0, 50)}…" ✓`);

  console.log("\nAll on-chain plumbing smoke tests passed ✓\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
