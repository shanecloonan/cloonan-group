/* VRF smoke test. */
import {
  vrfKeygen,
  vrfProve,
  vrfVerify,
  vrfOutputAsIndex,
  encodeVrfProof,
  decodeVrfProof,
} from "../lib/network/vrf";

function ok(label: string, cond: boolean): void {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.error(`  FAIL  ${label}`);
    process.exit(1);
  }
}

const kp = vrfKeygen();
const msg = new TextEncoder().encode("slot:42");
const { proof, output } = vrfProve(kp, msg);
ok("output is 32 bytes", output.length === 32);

const v = vrfVerify(kp.pk, msg, proof);
ok("verify ok", v.ok);
ok("output matches", v.output !== null && v.output.every((x, i) => x === output[i]));

// determinism
const r2 = vrfProve(kp, msg);
ok("output deterministic", r2.output.every((x, i) => x === output[i]));

// different msg → different output
const r3 = vrfProve(kp, new TextEncoder().encode("slot:43"));
ok("different msg → different output", !r3.output.every((x, i) => x === output[i]));

// different sk → different output for same msg
const kp2 = vrfKeygen();
const r4 = vrfProve(kp2, msg);
ok("different sk → different output", !r4.output.every((x, i) => x === output[i]));

// tampered proof → rejected
const bad = { ...proof, s: (proof.s + 1n) };
ok("rejects tampered proof", !vrfVerify(kp.pk, msg, bad).ok);

// encode / decode round-trip
const enc = encodeVrfProof(proof);
ok("encoded proof is 80 bytes", enc.length === 80);
const dec = decodeVrfProof(enc);
ok("decoded proof verifies", vrfVerify(kp.pk, msg, dec).ok);

// uniform index
const counts: number[] = new Array(10).fill(0);
for (let i = 0; i < 1000; i++) {
  const m = new TextEncoder().encode(`slot:${i}`);
  const r = vrfProve(kp, m);
  counts[vrfOutputAsIndex(r.output, 10)]++;
}
const min = Math.min(...counts), max = Math.max(...counts);
ok(`index distribution roughly uniform (min=${min}, max=${max})`, min > 50 && max < 200);

console.log("\nVRF smoke checks passed.");
