/* ================================================================== *
 *  MoneyFund Network — Endowment Math                                  *
 *                                                                      *
 *  WHAT THIS IS                                                       *
 *  ────────────                                                       *
 *  The protocol-level math that turns "how big is this upload, and    *
 *  for how long do you want it preserved?" into "how many MFN must    *
 *  you escrow into the storage treasury right now?"                    *
 *                                                                      *
 *  This is the on-chain version of the formula from §3 of the         *
 *  whitepaper:                                                         *
 *                                                                      *
 *      E₀  =  C₀ · (1 + i) / (r − i)                                  *
 *                                                                      *
 *  Where                                                               *
 *      E₀  = upfront endowment the user pays at upload time            *
 *      C₀  = first-year storage cost (units of MFN base)              *
 *      i   = annual inflation rate of storage cost (per year)         *
 *      r   = annual real yield rate the treasury earns (per year)     *
 *      r > i  (the *non-degeneracy condition*)                         *
 *                                                                      *
 *  Derivation reminder:                                                *
 *      ∞                                                              *
 *      Σ   C₀ · (1+i)ᵗ / (1+r)ᵗ⁻¹   converges to  C₀ (1+i)/(r−i)       *
 *      t=1                                                            *
 *                                                                      *
 *  WHY ON-CHAIN                                                       *
 *  ────────────                                                       *
 *  We MUST evaluate this on-chain because:                            *
 *    • applyBlock needs to validate that an UploadTx's endowment      *
 *      escrow matches the protocol's expectation for the declared    *
 *      size and duration — too low and the upload underfunds, which  *
 *      breaks the permanence guarantee.                              *
 *    • Wallets must agree on the cost before submitting, or every    *
 *      upload would be racey.                                         *
 *    • The same formula computes the per-slot payout to storage      *
 *      providers, so the *liability* and the *payout schedule* must  *
 *      both come from the same canonical math.                        *
 *                                                                      *
 *  PRECISION                                                          *
 *  ─────────                                                          *
 *  All rates are in PARTS PER BILLION (PPB). 20_000_000 ppb = 2%.    *
 *  This gives 9 decimal places of precision without any float, which *
 *  is exactly determinism-safe across implementations. Final monetary *
 *  values are computed with CEILING DIVISION so the protocol can      *
 *  never accidentally underfund — the user pays at most 1 base unit  *
 *  more than the mathematical answer.                                  *
 *                                                                      *
 *  REPLICATION                                                        *
 *  ───────────                                                        *
 *  The first-year cost C₀ scales linearly with the number of         *
 *  independent storage replicas the network maintains. The protocol  *
 *  enforces a minimum replication factor below which uploads cannot   *
 *  be accepted — without it, "permanence" is one rack-fire away from *
 *  oblivion.                                                           *
 * ================================================================== */

/* ------------------------------------------------------------------ */
/*  PARAMS                                                             */
/* ------------------------------------------------------------------ */

/** All rate values are in PARTS PER BILLION. 1% = 10_000_000 ppb. */
export const PPB = 1_000_000_000n;

export interface EndowmentParams {
  /** Storage cost per byte per year per replica, in PARTS PER BILLION *
   *  of one MFN base unit. PPB precision is needed because a single   *
   *  byte-year is much cheaper than 1 base unit at any plausible MFN  *
   *  token valuation — without subunit precision the integer math    *
   *  would clamp small uploads to 0 cost, defeating both the         *
   *  permanence guarantee and any anti-spam protection.               *
   *                                                                    *
   *  Example calibration: setting this to 200_000 means 1 byte-year   *
   *  per replica costs 2 × 10⁻⁴ base units (= 2 × 10⁻¹² MFN). Then    *
   *  1 GB stored at 3 × replication for an effectively-infinite       *
   *  horizon costs ≈ 0.3 MFN — roughly Arweave-comparable.            */
  costPerByteYearPpb: bigint;
  /** Annual inflation of storage cost, in PPB. Empirically storage    *
   *  has *deflated* historically (Kryder's law), so a positive i is   *
   *  a conservative bet — we assume costs go up, charge enough to     *
   *  cover that, and pocket the surplus if Kryder holds.              */
  inflationPpb: bigint;
  /** Annual real yield the treasury captures (compute-fees, MEV       *
   *  recapture, idle-capital investment), in PPB. r > i is the        *
   *  protocol's non-degeneracy condition.                              */
  realYieldPpb: bigint;
  /** Minimum number of independent replicas a single upload must have. *
   *  Hard floor: 3. A two-replica system has no quorum recoverability *
   *  after a single failure.                                           */
  minReplication: number;
  /** Maximum replication factor (DOS protection: an attacker could    *
   *  otherwise pin tiny data with absurd replication and inflate the  *
   *  treasury indefinitely). Sensible default: 32.                     */
  maxReplication: number;
}

export const DEFAULT_ENDOWMENT_PARAMS: EndowmentParams = {
  // 200,000 ppb = 2 × 10⁻⁴ base units per byte-year per replica.
  // → 1 GB · 3× replication ≈ 0.31 MFN (Arweave-comparable).
  costPerByteYearPpb: 200_000n,
  inflationPpb: 20_000_000n, //   2.0% storage cost inflation
  realYieldPpb: 40_000_000n, //   4.0% treasury real yield
  minReplication: 3,
  maxReplication: 32,
};

/* ------------------------------------------------------------------ */
/*  VALIDATION                                                         */
/* ------------------------------------------------------------------ */

export function validateEndowmentParams(p: EndowmentParams): void {
  if (p.costPerByteYearPpb < 0n) throw new Error("endowment: costPerByteYearPpb < 0");
  if (p.inflationPpb < 0n) throw new Error("endowment: inflation < 0 (use 0 for zero-inflation)");
  if (p.realYieldPpb <= 0n) throw new Error("endowment: realYield <= 0 (treasury must earn something)");
  if (p.realYieldPpb <= p.inflationPpb) {
    // This is the non-degeneracy condition; without it the geometric
    // series diverges and the on-chain formula returns Infinity (or
    // worse, a negative number from r-i < 0).
    throw new Error(
      `endowment: realYield (${p.realYieldPpb} ppb) must exceed inflation ` +
        `(${p.inflationPpb} ppb) — the geometric series diverges otherwise`
    );
  }
  if (p.minReplication < 1) throw new Error("endowment: minReplication < 1");
  if (p.minReplication > p.maxReplication) {
    throw new Error("endowment: minReplication > maxReplication");
  }
}

/* ------------------------------------------------------------------ */
/*  PRIMARY: required upfront endowment for a single upload            */
/* ------------------------------------------------------------------ */

/**
 *  E₀ = C₀ · (1+i) / (r − i)
 *
 *  where  C₀ = costPerByteYear · sizeBytes · replication
 *
 *  Returned in MFN base units. Uses ceiling division so the protocol
 *  never under-funds; the maximum over-payment is one base unit
 *  (10⁻⁸ MFN), which is dust.
 *
 *  Throws if size or replication is out of bounds.
 */
export function requiredEndowment(
  sizeBytes: bigint,
  replication: number,
  params: EndowmentParams = DEFAULT_ENDOWMENT_PARAMS
): bigint {
  validateEndowmentParams(params);
  if (sizeBytes < 0n) throw new Error("endowment: sizeBytes < 0");
  if (replication < params.minReplication) {
    throw new Error(
      `endowment: replication ${replication} < minReplication ${params.minReplication}`
    );
  }
  if (replication > params.maxReplication) {
    throw new Error(
      `endowment: replication ${replication} > maxReplication ${params.maxReplication}`
    );
  }
  // costPerByteYearPpb is in PPB of a base unit; the full numerator
  // therefore picks up a PPB factor that the denominator does NOT have.
  // We work it through symbolically:
  //   C₀         = (costPerByteYearPpb / PPB) · size · replication        (base units)
  //   E₀         = C₀ · (PPB + i) / (r − i)                                (base units)
  //  Substituting:
  //   E₀ · PPB · PPB = costPerByteYearPpb · size · repl · (PPB + i)
  //   E₀             = costPerByteYearPpb · size · repl · (PPB + i)
  //                    --------------------------------------------------
  //                                     PPB · (r − i)
  // We compute the numerator and denominator in bigint, then ceil-divide.
  const sizeRepl = sizeBytes * BigInt(replication);
  if (sizeRepl === 0n) return 0n;
  const numerator = params.costPerByteYearPpb * sizeRepl * (PPB + params.inflationPpb);
  const denominator = PPB * (params.realYieldPpb - params.inflationPpb);
  return ceilDiv(numerator, denominator);
}

/* ------------------------------------------------------------------ */
/*  SECONDARY: scheduled per-slot payout to storage providers          */
/* ------------------------------------------------------------------ */

/**
 *  How many base units the treasury pays out, in a single slot, for an
 *  endowment of size `endowment`. Derivation: the treasury invests the
 *  endowment at real yield r per *year*; per-slot yield is r / slotsPerYear.
 *
 *  Pays out FLOOR yield-per-slot so the treasury never overdraws.
 */
export function payoutPerSlot(
  endowment: bigint,
  slotsPerYear: bigint,
  params: EndowmentParams = DEFAULT_ENDOWMENT_PARAMS
): bigint {
  if (slotsPerYear <= 0n) throw new Error("endowment: slotsPerYear must be > 0");
  // annualPayout = endowment · realYieldPpb / PPB
  // perSlot      = annualPayout / slotsPerYear
  // Combine to one expression for fewer roundoff errors.
  return (endowment * params.realYieldPpb) / (PPB * slotsPerYear);
}

/** Cumulative payout from the treasury over `slots` slots. Useful when *
 *  pre-computing future storage-reward liability and when verifying    *
 *  that a long-running storage subscription will be honoured.          */
export function cumulativePayout(
  endowment: bigint,
  slots: bigint,
  slotsPerYear: bigint,
  params: EndowmentParams = DEFAULT_ENDOWMENT_PARAMS
): bigint {
  if (slots <= 0n) return 0n;
  // For simplicity we use linear scaling. Real yield is compounded in
  // the limit; for short to medium horizons (≤ tens of years) linear
  // is a safe under-approximation that prevents over-payout.
  return payoutPerSlot(endowment, slotsPerYear, params) * slots;
}

/* ------------------------------------------------------------------ */
/*  INVERSE: how big an upload an endowment can fund                   */
/* ------------------------------------------------------------------ */

/** Given a fixed budget, the maximum number of bytes you can pay to     *
 *  permanently store at a given replication. Useful for wallet UX:     *
 *  "you have 100 MFN; that's enough to permanently store up to X TB".   *
 *  Floor-divides so the user never *overspends* against their budget.  */
export function maxBytesForEndowment(
  endowment: bigint,
  replication: number,
  params: EndowmentParams = DEFAULT_ENDOWMENT_PARAMS
): bigint {
  validateEndowmentParams(params);
  if (replication < params.minReplication || replication > params.maxReplication) {
    throw new Error("endowment: replication out of bounds");
  }
  // Inverting the formula above:
  //   sizeBytes = E · PPB · (r − i) / (costPerByteYearPpb · repl · (PPB + i))
  // floor-divide so the inverse never overstates the budget.
  const denominator = params.costPerByteYearPpb *
    BigInt(replication) *
    (PPB + params.inflationPpb);
  if (denominator === 0n) return 0n;
  return (endowment * PPB * (params.realYieldPpb - params.inflationPpb)) / denominator;
}

/* ------------------------------------------------------------------ */
/*  UTIL                                                               */
/* ------------------------------------------------------------------ */

/** Ceiling division for non-negative bigints. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("ceilDiv: denominator must be > 0");
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}
