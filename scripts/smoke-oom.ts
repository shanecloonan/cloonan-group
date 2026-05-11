/* ================================================================== *
 *  smoke-oom — Adversarial sweep for the One-out-of-Many ZK proof.    *
 *                                                                      *
 *  This is the cryptographic foundation of Triptych / Lelantus. If    *
 *  ANYTHING in this file fails, the privacy story is broken — do not  *
 *  ship.                                                                *
 *                                                                      *
 *  We test:                                                            *
 *    1. Honest prove/verify across multiple ring sizes (4 … 256).     *
 *    2. Round-trip encoding (encodeOomProof ∘ decodeOomProof).        *
 *    3. Zero-knowledge (positional indistinguishability) sanity check:*
 *       proofs at different ℓ are structurally indistinguishable to   *
 *       a verifier without the witness.                                *
 *    4. Forgery resistance:                                            *
 *       a. Wrong witness scalar (random r').                          *
 *       b. Wrong index (prover lies about ℓ).                         *
 *       c. Tampered proof.A, .B, .C, .Gk.                             *
 *       d. Tampered scalar responses f, zA, zC, zd.                   *
 *       e. Inserted false commitment in the ring before the secret.   *
 *       f. Ring permutation invalidates a previously-valid proof.     *
 *    5. Boundary cases (ℓ = 0, ℓ = N−1, smallest N).                  *
 *    6. Size discipline: proof bytes scale as O(log N).               *
 * ================================================================== */

import {
  G, H, randomScalar,
  type CurvePoint,
} from "../lib/network/primitives";
import {
  oomProve, oomVerify,
  encodeOomProof, decodeOomProof,
  oomProofSize,
  type OomProof,
} from "../lib/network/oom";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? "  — " + extra : ""}`);
  }
}

/* Build a ring of N random commitments to NON-zero values, then place *
 * a true commitment to 0 (= r·H) at the secret index ℓ.               */
function makeRing(N: number, ell: number): { ring: CurvePoint[]; r: bigint } {
  if (ell < 0 || ell >= N) throw new Error("bad ell");
  const ring: CurvePoint[] = new Array(N);
  for (let i = 0; i < N; i++) {
    if (i === ell) continue;
    // Decoy: commit to a non-zero value, so it's NOT in <H>.
    const v = randomScalar();
    const r = randomScalar();
    ring[i] = G.multiply(v).add(H.multiply(r));
  }
  const r = randomScalar();
  ring[ell] = H.multiply(r);
  return { ring, r };
}

/* ------------------------------------------------------------------ */
/*  1. HONEST FLOWS                                                    */
/* ------------------------------------------------------------------ */
console.log("\n== 1. Honest prove/verify across ring sizes ==");
{
  const ringSizes = [2, 4, 8, 16, 32, 64, 128, 256];
  for (const N of ringSizes) {
    // Test a handful of secret indices: 0, N/2, N−1, plus a random one.
    const ells = [0, Math.floor(N / 2), N - 1];
    const seenRandomEll = new Set<number>(ells);
    while (seenRandomEll.size === ells.length) {
      const cand = Math.floor(Math.random() * N);
      seenRandomEll.add(cand);
    }
    for (const ell of seenRandomEll) {
      const { ring, r } = makeRing(N, ell);
      const proof = oomProve(ring, ell, r);
      const ok = oomVerify(ring, proof);
      check(`N=${N}, ℓ=${ell}: prove → verify`, ok);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  2. ENCODING ROUND-TRIP                                             */
/* ------------------------------------------------------------------ */
console.log("\n== 2. Wire encoding ==");
{
  const N = 16;
  const ell = 5;
  const { ring, r } = makeRing(N, ell);
  const proof = oomProve(ring, ell, r);
  const wire = encodeOomProof(proof);
  const expectedSize = oomProofSize(N);
  check(`wire length matches oomProofSize(${N})`, wire.length === expectedSize,
    `got ${wire.length}, expected ${expectedSize}`);
  const decoded = decodeOomProof(wire);
  check("re-encoding is byte-identical", bytesEq(wire, encodeOomProof(decoded)));
  check("decoded proof verifies", oomVerify(ring, decoded));
}

/* ------------------------------------------------------------------ */
/*  3. ZK SANITY: positional indistinguishability                      */
/* ------------------------------------------------------------------ */
console.log("\n== 3. Zero-knowledge surface ==");
{
  // Same N, same ring SHAPE but different ℓ → different proofs (proofs
  // are randomized; we can't compare equality, but we CAN verify they
  // share the same structure & both validate against their respective
  // rings).
  const N = 32;
  for (const ell of [0, 7, 15, 31]) {
    const { ring, r } = makeRing(N, ell);
    const proof = oomProve(ring, ell, r);
    const log2N = Math.log2(N);
    const structureOk =
      proof.A.length === log2N && proof.B.length === log2N &&
      proof.C.length === log2N && proof.Gk.length === log2N &&
      proof.f.length === log2N && proof.zA.length === log2N &&
      proof.zC.length === log2N;
    check(`proof at ℓ=${ell} has canonical structure`, structureOk);
    check(`proof at ℓ=${ell} verifies`, oomVerify(ring, proof));
  }
  // Two proofs over the SAME (ring, ell, r) must both verify but differ
  // bit-for-bit (Fiat-Shamir over randomized commitments).
  const N2 = 8;
  const { ring: ring2, r: r2 } = makeRing(N2, 3);
  const p1 = oomProve(ring2, 3, r2);
  const p2 = oomProve(ring2, 3, r2);
  check("two proofs over same statement both verify",
    oomVerify(ring2, p1) && oomVerify(ring2, p2));
  check("two proofs over same statement are bit-different (randomized)",
    !bytesEq(encodeOomProof(p1), encodeOomProof(p2)));
}

/* ------------------------------------------------------------------ */
/*  4. FORGERY RESISTANCE                                              */
/* ------------------------------------------------------------------ */
console.log("\n== 4. Forgery resistance ==");
{
  const N = 16;
  const ell = 9;
  const { ring, r } = makeRing(N, ell);
  const proof = oomProve(ring, ell, r);
  // Sanity: honest proof verifies.
  check("baseline: honest proof verifies", oomVerify(ring, proof));

  // 4a. Wrong witness r' must throw at prove-time (the prover protects
  //     itself; this prevents accidental key reuse).
  let threw = false;
  try {
    oomProve(ring, ell, (r + 1n));
  } catch {
    threw = true;
  }
  check("prove with wrong witness throws", threw);

  // 4b. Lying about ℓ — claim the secret is at a different index, where
  //     ring[ell'] is NOT a commitment to 0. Must also throw.
  let liedThrew = false;
  const fakeEll = (ell + 1) % N;
  try {
    oomProve(ring, fakeEll, r);
  } catch {
    liedThrew = true;
  }
  check("prove with lied-about ℓ throws (witness mismatch)", liedThrew);

  // 4c. Tampered A, B, C, Gk — flip any single point and the proof
  //     should fail to verify.
  for (const field of ["A", "B", "C", "Gk"] as const) {
    const arr = proof[field];
    const k = Math.floor(arr.length / 2);
    const tampered: OomProof = { ...proof, [field]: [...arr] };
    tampered[field][k] = tampered[field][k].add(G); // any non-identity shift
    check(`tampering proof.${field}[${k}] is rejected`, !oomVerify(ring, tampered));
  }

  // 4d. Tampered scalar responses.
  for (const field of ["f", "zA", "zC"] as const) {
    const arr = proof[field];
    const k = Math.floor(arr.length / 2);
    const tampered: OomProof = { ...proof, [field]: [...arr] };
    tampered[field][k] = (tampered[field][k] + 1n);
    check(`tampering proof.${field}[${k}] is rejected`, !oomVerify(ring, tampered));
  }
  // Tamper zd.
  {
    const tampered: OomProof = { ...proof, zd: proof.zd + 1n };
    check("tampering proof.zd is rejected", !oomVerify(ring, tampered));
  }

  // 4e. Tamper the RING after proving — verifier sees a different ring.
  {
    const ring2 = [...ring];
    const idx = (ell + 3) % N;
    ring2[idx] = ring2[idx].add(G);
    check("ring tampered post-proof is rejected", !oomVerify(ring2, proof));
  }

  // 4f. Permuting the ring (preserves multiset, moves ell) breaks the
  //     proof — because Fiat-Shamir binds to the ORDER.
  {
    const ringPerm = [...ring];
    // Swap two non-ell positions
    const i = (ell + 1) % N;
    const j = (ell + 2) % N;
    [ringPerm[i], ringPerm[j]] = [ringPerm[j], ringPerm[i]];
    check("ring permutation (non-ℓ swap) is rejected", !oomVerify(ringPerm, proof));
  }
}

/* ------------------------------------------------------------------ */
/*  5. SECRET-INDEX EXTRACTION RESISTANCE                              */
/*                                                                      *
 *  A skeleton attempt: a verifier who knows the ring but not ℓ should *
 *  not be able to identify ℓ from the proof alone. We can't formally *
 *  test ZK in TypeScript, but we sanity-check that f_j responses do  *
 *  not directly leak ℓ_j (they're masked by a_j, so f_j is uniform   *
 *  given the challenge x).                                            *
 * ------------------------------------------------------------------ */
console.log("\n== 5. f_j response is masked ==");
{
  const N = 16;
  // Two different witnesses at the SAME index → f_j values differ
  // (because (a_j, ℓ_j·x + a_j) is uniform regardless of ℓ_j).
  const ell = 4;
  const { ring, r } = makeRing(N, ell);
  const p1 = oomProve(ring, ell, r);
  const p2 = oomProve(ring, ell, r);
  let allDiff = true;
  for (let j = 0; j < p1.f.length; j++) {
    if (p1.f[j] === p2.f[j]) { allDiff = false; break; }
  }
  check("f_j values randomized across proof runs", allDiff);
}

/* ------------------------------------------------------------------ */
/*  6. PROOF-SIZE SCALING                                              */
/* ------------------------------------------------------------------ */
console.log("\n== 6. Proof-size scaling (log N) ==");
{
  // Compare proof sizes — they should grow LOGARITHMICALLY with N.
  // Each doubling of N adds one "row" (= 4·32 + 3·32 = 224 bytes).
  const samples: { N: number; size: number }[] = [];
  for (const N of [4, 8, 16, 32, 64, 128, 256]) {
    const { ring, r } = makeRing(N, 0);
    const proof = oomProve(ring, 0, r);
    const sz = encodeOomProof(proof).length;
    samples.push({ N, size: sz });
    const expected = 4 + Math.log2(N) * 7 * 32 + 32;
    check(`N=${N}: |proof|=${sz} bytes (=4 + 7·log2(N)·32 + 32 = ${expected})`,
      sz === expected);
  }
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].size - samples[i - 1].size;
    check(`doubling N from ${samples[i - 1].N}→${samples[i].N}: +${delta} bytes`,
      delta === 7 * 32);
  }
}

/* ------------------------------------------------------------------ */
/*  7. PROVE-OR-DIE PERFORMANCE SANITY                                 */
/* ------------------------------------------------------------------ */
console.log("\n== 7. Performance sanity ==");
{
  const N = 256;
  const ell = 137;
  const { ring, r } = makeRing(N, ell);
  const t0 = Date.now();
  const proof = oomProve(ring, ell, r);
  const t1 = Date.now();
  const ok = oomVerify(ring, proof);
  const t2 = Date.now();
  check(`N=${N}: prove in ${t1 - t0}ms, verify in ${t2 - t1}ms (both validate)`, ok);
  // 30-second budget — typescript on a laptop should easily do this at 256.
  check(`N=${N}: prove < 30s`, t1 - t0 < 30_000);
  check(`N=${N}: verify < 10s`, t2 - t1 < 10_000);
}

/* ------------------------------------------------------------------ */
/*  EXIT                                                               */
/* ------------------------------------------------------------------ */

console.log(`\n----------------------------------------\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAIL");
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
