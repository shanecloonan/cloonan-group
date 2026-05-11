/* ================================================================== *
 *  MoneyFund Network — Emission Schedule                              *
 *                                                                      *
 *  WHAT THIS IS                                                       *
 *  ────────────                                                       *
 *  The protocol-level rule that decides how many fresh tokens the     *
 *  chain mints to pay validators for producing each block. This is    *
 *  the equivalent of Bitcoin's block subsidy schedule, except we       *
 *  ALSO have a permanent tail emission that NEVER decays to zero —    *
 *  inspired by Monero's design choice, motivated here by a much       *
 *  harder requirement: data permanence.                                *
 *                                                                      *
 *  WHY A TAIL EMISSION                                                *
 *  ──────────────────                                                 *
 *  Bitcoin's "fees-only future" is a bet that transaction fees alone  *
 *  will fund security after the subsidy decays to zero. For a payment *
 *  network this is uncomfortable but survivable. For a *permanence*   *
 *  network it is existential: storage providers must be paid          *
 *  *forever* to hold *forever* data. Letting the subsidy go to zero   *
 *  means letting the permanence promise expire.                        *
 *                                                                      *
 *  So we follow Monero's design and asymptote to a small constant     *
 *  per-block emission rather than zero. Combined with a transaction-  *
 *  fee market and the uploader endowment (see endowment.ts), this     *
 *  gives three independent funding streams: emission, fees, and       *
 *  endowment yield.                                                    *
 *                                                                      *
 *  PROPERTIES                                                          *
 *  ──────────                                                         *
 *    • Deterministic. emission(h) is a pure function of h.            *
 *    • Monotonic supply. cumulativeEmission(h) is non-decreasing.     *
 *    • Bounded inflation. After tail kicks in, annual %-inflation     *
 *      asymptotically approaches zero (constant numerator, growing    *
 *      denominator) without ever hitting it.                          *
 *    • Genesis is unfunded. emission(0) = 0. The genesis block does   *
 *      not pay a coinbase; it's part of protocol setup, not a slot.   *
 *                                                                      *
 *  PARAMETERS                                                          *
 *  ──────────                                                         *
 *  The defaults below are chosen to be reasonable for testnet and a   *
 *  starting point for mainnet debate. They are NOT yet load-bearing   *
 *  for any economic decision; they are the protocol's *opinion* and   *
 *  can be tuned by genesis configuration before launch. Concretely:   *
 *                                                                      *
 *    initialReward    50.00000000 MFN per block (10^8 base units)     *
 *    halvingPeriod    8,000,000 blocks (~4 yrs at 6s slots, VRF-adj.) *
 *    halvingCount     8 halvings before tail (~32 years)              *
 *    tailEmission     0.50000000 MFN per block forever                 *
 *                                                                      *
 *  TOTAL ISSUANCE                                                     *
 *  ──────────────                                                     *
 *  Sum over the eight halving eras:                                   *
 *    Σ (initialReward / 2^k) · halvingPeriod    for k = 0..7          *
 *    ≈ initialReward · halvingPeriod · (1 + ½ + ¼ + ... + 1/128)      *
 *    ≈ 50 · 8,000,000 · 1.9921875 ≈ 796,875,000 MFN minted via subsidy *
 *  After that the tail emits 0.5 MFN/block indefinitely, so total      *
 *  supply grows linearly with the tail rate after year ~32.            *
 *                                                                      *
 *  Compare:                                                            *
 *    Bitcoin: 21M cap, no tail.                                       *
 *    Monero:  ~18M cap then ~0.6 XMR/block tail forever.              *
 *    Us:      ~800M MFN main emission then 0.5 MFN/block tail.        *
 * ================================================================== */

/* ------------------------------------------------------------------ */
/*  PARAMS                                                             */
/* ------------------------------------------------------------------ */

export interface EmissionParams {
  /** Reward paid at block heights 1 through halvingPeriod (inclusive). *
   *  Denominated in smallest-unit (10^-8 MFN, like Bitcoin satoshis).  */
  initialReward: bigint;
  /** Number of blocks per halving era. */
  halvingPeriod: number;
  /** How many halvings happen before tail emission kicks in.          */
  halvingCount: number;
  /** Permanent per-block emission after halvings end. Must be > 0 to  *
   *  guarantee perpetual security funding.                             */
  tailEmission: bigint;
  /** Per-storage-proof minted reward, paid INTO the block coinbase on  *
   *  top of the regular subsidy + fees. This is the "permanence        *
   *  subsidy" — what motivates validators to actually do the slot-     *
   *  audit work that proves stored data is still being held. Without   *
   *  this, storage providers earn nothing for their work and the       *
   *  permanence guarantee is a paper promise.                          *
   *                                                                     *
   *  Default: 0.1 MFN per proof = 10_000_000 base units. With a busy   *
   *  network (say 10 storage proofs per block) this adds 1 MFN/block   *
   *  ≈ 2% additional inflation over the era-0 subsidy — a meaningful  *
   *  incentive without dominating block production rewards.            */
  storageProofReward: bigint;
}

/** One MFN = 10^8 base units, matching Bitcoin's satoshi denomination. *
 *  This makes wallet UX and integer math symmetric with existing       *
 *  ecosystem tooling.                                                  */
export const MFN_DECIMALS = 8;
export const MFN_BASE = 100_000_000n; //  10^MFN_DECIMALS

/** The tail is chosen one binary halving below the last subsidy era,    *
 *  giving a perfectly smooth (monotone) transition. Concretely:         *
 *      era 0..7: initialReward >> 0..>> 7                              *
 *      tail   : initialReward >> 8                                      *
 *  This produces ≈ 0.1% perpetual inflation against the pre-tail        *
 *  supply at the expected ~4.1M blocks/year rate — high enough to fund *
 *  storage providers forever, low enough to be a non-event for holders.*/
export const DEFAULT_EMISSION_PARAMS: EmissionParams = {
  initialReward: 50n * MFN_BASE,
  halvingPeriod: 8_000_000,
  halvingCount: 8,
  tailEmission: (50n * MFN_BASE) >> 8n, //  ≈ 0.195 MFN/block
  storageProofReward: MFN_BASE / 10n, //  0.1 MFN per accepted storage proof
};

/* ------------------------------------------------------------------ */
/*  VALIDATION                                                         */
/* ------------------------------------------------------------------ */

/** Verify the chosen params make economic sense. Throws on misconfig. *
 *  Genesis must reject params that violate these invariants — without *
 *  them the chain could mint nothing forever (tail = 0) or have a     *
 *  reward that flips sign (initial < 0).                              */
export function validateEmissionParams(p: EmissionParams): void {
  if (p.initialReward < 0n) throw new Error("emission: initialReward must be >= 0");
  if (p.tailEmission <= 0n) {
    throw new Error("emission: tailEmission must be > 0 (permanent funding required)");
  }
  if (p.storageProofReward < 0n) {
    throw new Error("emission: storageProofReward must be >= 0");
  }
  if (p.halvingPeriod <= 0) throw new Error("emission: halvingPeriod must be > 0");
  if (p.halvingCount < 0) throw new Error("emission: halvingCount must be >= 0");
  if (p.halvingCount > 64) {
    // After 64 halvings of a 64-bit value the reward is effectively 0;
    // we conservatively cap at 64 since BigInt right-shift would still
    // work but the era would be economically meaningless.
    throw new Error("emission: halvingCount must be <= 64");
  }
  // The last halving era (era halvingCount - 1) emits initialReward >>
  // (halvingCount - 1). We require tailEmission <= that value so the
  // emission schedule is *monotonically non-increasing*. Without this
  // there's a discontinuity where per-block emission jumps UP entering
  // the tail era — bad UX, no economic justification (the halving was
  // doing its job; the tail is a *floor*, not a *raise*).
  if (p.halvingCount > 0) {
    const lastSubsidy = p.initialReward >> BigInt(p.halvingCount - 1);
    if (p.tailEmission > lastSubsidy && lastSubsidy > 0n) {
      throw new Error(
        `emission: tailEmission (${p.tailEmission}) > last halving subsidy ` +
          `(${lastSubsidy}); would create an upward discontinuity at tail start`
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  EMISSION                                                           */
/* ------------------------------------------------------------------ */

/** Return the per-block emission at block `height`. Genesis (height 0) *
 *  produces no emission; height 1 produces `initialReward`; halvings   *
 *  are at `halvingPeriod + 1`, `2*halvingPeriod + 1`, etc.             */
export function emissionAtHeight(
  height: number,
  params: EmissionParams = DEFAULT_EMISSION_PARAMS
): bigint {
  if (height <= 0) return 0n;
  const halvings = Math.floor((height - 1) / params.halvingPeriod);
  if (halvings >= params.halvingCount) return params.tailEmission;
  return params.initialReward >> BigInt(halvings);
}

/** Cumulative tokens minted via emission from height 1 through `height` *
 *  inclusive. Used by treasury accounting, tests, and economic         *
 *  monitoring. Pure function of height; closed-form per era so it      *
 *  evaluates in O(halvingCount) regardless of height magnitude.        */
export function cumulativeEmission(
  height: number,
  params: EmissionParams = DEFAULT_EMISSION_PARAMS
): bigint {
  if (height <= 0) return 0n;
  let total = 0n;

  // Sum each halving era that the height enters or completes.
  for (let era = 0; era < params.halvingCount; era++) {
    const eraStart = era * params.halvingPeriod + 1;
    const eraEnd = (era + 1) * params.halvingPeriod;
    if (height < eraStart) break;
    const blocksInEra = Math.min(height, eraEnd) - eraStart + 1;
    total += (params.initialReward >> BigInt(era)) * BigInt(blocksInEra);
  }

  // Tail era: every block past halvingCount * halvingPeriod.
  const tailStart = params.halvingCount * params.halvingPeriod + 1;
  if (height >= tailStart) {
    total += params.tailEmission * BigInt(height - tailStart + 1);
  }

  return total;
}

/** Total tokens minted by the end of the last halving (i.e. the         *
 *  "pre-tail" supply). Useful for headlining "Bitcoin-like cap"         *
 *  numbers even though our true supply is unbounded by the tail.        */
export function preTailSupplyCap(
  params: EmissionParams = DEFAULT_EMISSION_PARAMS
): bigint {
  return cumulativeEmission(
    params.halvingCount * params.halvingPeriod,
    params
  );
}

/** Cumulative ANNUAL tail emission once the halvings are done. Used    *
 *  by inflation-rate displays and by the endowment formula's calibration. *
 *  Approximate: assumes one block per slot at the configured slot rate. *
 *  Pass the average blocks-per-year your network actually produces.    */
export function annualTailEmission(
  blocksPerYear: number,
  params: EmissionParams = DEFAULT_EMISSION_PARAMS
): bigint {
  return params.tailEmission * BigInt(blocksPerYear);
}

/** Current annualized issuance rate at `height`, expressed in parts    *
 *  per billion of `supply`. Used by status displays and by the         *
 *  endowment-yield calibration logic to know what real yield the       *
 *  treasury can support without diluting holders.                       */
export function annualizedInflationPpb(
  height: number,
  blocksPerYear: number,
  params: EmissionParams = DEFAULT_EMISSION_PARAMS
): bigint {
  const supply = cumulativeEmission(height, params);
  if (supply === 0n) return 0n;
  const yearAhead = emissionAtHeight(height, params) * BigInt(blocksPerYear);
  return (yearAhead * 1_000_000_000n) / supply;
}
