/* KZG smoke test. */
import {
  kzgInsecureSetup,
  kzgCommit,
  kzgOpen,
  kzgVerify,
  polyEval,
  randomPolynomial,
  FR_ORDER,
} from "../lib/network/kzg";

function ok(label: string, cond: boolean): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    process.exit(1);
  }
}

const seed = new Uint8Array(32);
for (let i = 0; i < 32; i++) seed[i] = i + 1;

const N = 32;
console.log(`• setup (max degree ${N})`);
const srs = kzgInsecureSetup(N, seed);
ok(`g1 powers length = ${N + 1}`, srs.g1Powers.length === N + 1);

console.log("• commit + open + verify (random poly)");
const p = randomPolynomial(N);
const C = kzgCommit(srs, p);
const x = 12345n;
const opening = kzgOpen(srs, p, x);
ok("y = p(x)", opening.y === polyEval(p, x));
ok("proof verifies", kzgVerify(srs, C, opening));

console.log("• reject wrong y");
const badOpening = { ...opening, y: opening.y + 1n };
ok("rejects wrong y", !kzgVerify(srs, C, badOpening));

console.log("• reject wrong proof");
const badOpening2 = { ...opening, proof: opening.proof.add(opening.proof) };
ok("rejects wrong proof", !kzgVerify(srs, C, badOpening2));

console.log("• evaluate at multiple points");
for (const xi of [0n, 1n, 2n, 1000n, FR_ORDER - 1n]) {
  const op = kzgOpen(srs, p, xi);
  if (!kzgVerify(srs, C, op)) {
    console.error(`  FAIL at x=${xi}`);
    process.exit(1);
  }
}
console.log("  PASS  multi-point opening");

console.log("• small explicit poly: p(X) = 1 + 2X + 3X² + 4X³");
const explicit = [1n, 2n, 3n, 4n];
const Cexp = kzgCommit(srs, explicit);
const op = kzgOpen(srs, explicit, 5n);
ok("p(5) = 1 + 10 + 75 + 500 = 586", op.y === 586n);
ok("verifies", kzgVerify(srs, Cexp, op));

console.log("\nKZG smoke checks passed.");
