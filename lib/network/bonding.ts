/* ================================================================== *
 *  Validator bonding parameters (M1) — TS port of                    *
 *  `permawrite/mfn-consensus/src/bonding.rs`.                          *
 * ================================================================== */

export interface BondingParams {
  minValidatorStake: bigint;
  unbondDelayHeights: number;
  maxEntryChurnPerEpoch: number;
  maxExitChurnPerEpoch: number;
  slotsPerEpoch: number;
}

export const DEFAULT_BONDING_PARAMS: BondingParams = {
  minValidatorStake: 1_000_000n,
  unbondDelayHeights: 20_000,
  maxEntryChurnPerEpoch: 4,
  maxExitChurnPerEpoch: 4,
  slotsPerEpoch: 7200,
};

export class BondingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BondingError";
  }
}

/** `epoch_id` for a block height (genesis height `0` ⇒ epoch `0`). */
export function epochIdForHeight(
  height: number,
  slotsPerEpoch: number
): bigint {
  if (slotsPerEpoch <= 0) {
    throw new BondingError("slots_per_epoch must be > 0");
  }
  return BigInt(Math.floor(height / slotsPerEpoch));
}

export function validateStake(
  stake: bigint,
  params: BondingParams
): void {
  if (stake < params.minValidatorStake) {
    throw new BondingError(
      `stake ${stake} is below min_validator_stake ${params.minValidatorStake}`
    );
  }
}

/** Increment entry-churn counter after a successful bond, or throw. */
export function tryRegisterEntryChurn(
  entriesSoFarThisEpoch: number,
  params: BondingParams
): number {
  const next = entriesSoFarThisEpoch + 1;
  if (next > params.maxEntryChurnPerEpoch) {
    throw new BondingError(
      `entry churn ${next} exceeds max_entry_churn_per_epoch ${params.maxEntryChurnPerEpoch}`
    );
  }
  return next;
}
