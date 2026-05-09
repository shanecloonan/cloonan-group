/* Bulletproofs smoke test. */
import { bpProve, bpVerify, bpProofSize } from "../lib/network/bulletproofs";
import { randomScalar, L } from "../lib/network/primitives";

function ok(label: string, cond: boolean): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    process.exit(1);
  }
}

console.log("• small N=8 sanity");
{
  const v = 42n;
  const r = randomScalar();
  const t0 = Date.now();
  const { proof } = bpProve(v, r, 8);
  console.log(`    prove(N=8)  ${Date.now() - t0}ms`);
  const t1 = Date.now();
  ok("verifies", bpVerify(proof));
  console.log(`    verify(N=8) ${Date.now() - t1}ms`);
  console.log(`    estimated proof size: ${bpProofSize(8)} bytes`);
}

console.log("• boundary values");
{
  for (const v of [0n, 1n, (1n << 7n) - 1n]) {
    const { proof } = bpProve(v, randomScalar(), 8);
    if (!bpVerify(proof)) {
      console.error(`    FAIL at v=${v}`);
      process.exit(1);
    }
  }
  console.log("    PASS  v=0, 1, 2^7-1");
}

console.log("• reject out-of-range");
{
  let threw = false;
  try {
    bpProve(1n << 8n, randomScalar(), 8);
  } catch {
    threw = true;
  }
  ok("rejects v ≥ 2^N at prove time", threw);
}

console.log("• reject tampered proof");
{
  const { proof } = bpProve(123n, randomScalar(), 16);
  ok("verifies", bpVerify(proof));
  // tamper τ_x
  const bad = { ...proof, taux: (proof.taux + 1n) % L };
  ok("rejects tampered τ_x", !bpVerify(bad));
  // tamper t̂
  const bad2 = { ...proof, tHat: (proof.tHat + 1n) % L };
  ok("rejects tampered t̂", !bpVerify(bad2));
  // tamper IPA
  const bad3 = {
    ...proof,
    ipa: { ...proof.ipa, a: (proof.ipa.a + 1n) % L },
  };
  ok("rejects tampered IPA scalar", !bpVerify(bad3));
}

console.log("• N=64 (production size)");
{
  const v = 0xdeadbeefn;
  const r = randomScalar();
  const t0 = Date.now();
  const { proof } = bpProve(v, r, 64);
  const proveMs = Date.now() - t0;
  const t1 = Date.now();
  const ok64 = bpVerify(proof);
  const verifyMs = Date.now() - t1;
  ok(`verifies (prove ${proveMs}ms, verify ${verifyMs}ms)`, ok64);
  console.log(`    proof size: ${bpProofSize(64)} bytes (vs ~8200 for Borromean N=64)`);
}

console.log("\nBulletproofs smoke checks passed.");
