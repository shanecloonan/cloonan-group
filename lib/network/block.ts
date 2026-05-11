/* ================================================================== *
 *  MoneyFund Network — Block & Chain State                             *
 *                                                                      *
 *  This is the smallest layer that turns "verifiable transactions"     *
 *  into "an actual chain":                                              *
 *                                                                      *
 *    • Block             header + transactions, deterministically       *
 *                        hashed.                                        *
 *    • ChainState        the immutable-ish state machine: known         *
 *                        outputs, spent key images, storage registry,  *
 *                        and a list of accepted blocks.                *
 *    • applyBlock        pure function that validates a candidate      *
 *                        block against current state and either        *
 *                        returns a new state or an error.              *
 *                                                                      *
 *  This is intentionally NOT a full PoW / PoS / VRF leader-election    *
 *  implementation — that's the consensus layer above. What's here is   *
 *  sufficient for a deterministic state machine that any honest node   *
 *  can re-execute and arrive at the same answer.                       *
 * ================================================================== */

import {
  Point,
  type CurvePoint,
} from "./primitives";
import {
  TransactionWire,
  txId,
  verifyTransaction,
} from "./transaction";
import {
  storageCommitmentHash,
  verifyStorageProof,
  type StorageCommitment,
  type StorageProof,
  merkleTreeFromLeaves,
} from "./storage";
import {
  verifyEvidence,
  canonicalize,
  type SlashEvidence,
} from "./slashing";

export interface UtxoEntry {
  /** Pedersen commitment to the output's amount. CLSAG signers include  *
   *  this in their ring's `C` column.                                   */
  commit: CurvePoint;
  /** Block height at which this output was first anchored. Used by the *
   *  gamma decoy selector to weight by age.                             */
  height: number;
}

export interface StorageEntry {
  commit: StorageCommitment;
  /** Block height at which this commitment's audit was last satisfied.   *
   *  Initialized to the height at which the commitment was anchored on   *
   *  chain. Updated every time a successful StorageProof is included.    */
  lastProvenAt: number;
}
import {
  DOMAIN,
  Writer,
  dhash,
  bytesToHex,
} from "./codec";
import {
  decodeFinalityProof,
  verifyFinalityProof,
  type FinalityProof,
  type Validator,
  type SlotContext,
} from "./consensus";
import {
  isCoinbaseShaped,
  verifyCoinbase,
  buildCoinbase,
} from "./coinbase";
import {
  emissionAtHeight,
  DEFAULT_EMISSION_PARAMS,
  type EmissionParams,
} from "./emission";

/* ------------------------------------------------------------------ */
/*  HEADER + BLOCK                                                     */
/* ------------------------------------------------------------------ */

export interface BlockHeader {
  /** MFBN codec version. */
  version: number;
  /** Hash of the previous block's header. 32 bytes. */
  prevHash: Uint8Array;
  /** Block height (genesis = 0). */
  height: number;
  /** Slot number this block was produced for. Bound into the VRF seed so
   *  blocks at the same height but different slots get distinct producer
   *  eligibility lotteries. */
  slot: number;
  /** Wall-clock timestamp (seconds). Validator may reject blocks too far
   *  in the future relative to local clock — that policy lives at the
   *  network/consensus layer, not here. */
  timestamp: number;
  /** Merkle root of the block's transactions. */
  txRoot: Uint8Array;
  /** Merkle root of all storage commitments newly anchored in this block. */
  storageRoot: Uint8Array;
  /** MFBN-encoded FinalityProof: VRF eligibility + BLS aggregate finality.
   *  Genesis is the only block where this is allowed to be empty. */
  producerProof: Uint8Array;
}

export interface Block {
  header: BlockHeader;
  txs: TransactionWire[];
  /** Storage proofs answering this block's deterministic challenges.    *
   *  Producers fill this in when they hold (or coordinate with provers  *
   *  who hold) the underlying chunks. Empty when no proofs are          *
   *  produced this block — commitments simply stay unproven longer.    */
  storageProofs: StorageProof[];
  /** Slashing evidence collected since the previous block. Any         *
   *  validator referenced here has their stake reduced to 0 in the     *
   *  next state. Verified by applyBlock.                               */
  slashings: SlashEvidence[];
}

/* ------------------------------------------------------------------ */
/*  HASHING                                                            */
/* ------------------------------------------------------------------ */

export function blockHeaderBytes(h: BlockHeader): Uint8Array {
  const w = new Writer();
  w.varint(h.version);
  w.push(h.prevHash);
  w.u32(h.height);
  w.u32(h.slot);
  w.u64(BigInt(h.timestamp));
  w.push(h.txRoot);
  w.push(h.storageRoot);
  w.blob(h.producerProof);
  return w.bytes();
}

/** Hash of the header WITHOUT the producerProof. This is the message       *
 *  the producer + committee BLS-sign — has to be deterministic and exclude *
 *  the very signature it's signing.                                         */
export function headerSigningHash(h: BlockHeader): Uint8Array {
  const w = new Writer();
  w.varint(h.version);
  w.push(h.prevHash);
  w.u32(h.height);
  w.u32(h.slot);
  w.u64(BigInt(h.timestamp));
  w.push(h.txRoot);
  w.push(h.storageRoot);
  return dhash(DOMAIN.BLOCK_HEADER, w.bytes());
}

/** Block id = dhash("block-id", encoded header). */
export function blockId(h: BlockHeader): Uint8Array {
  return dhash(DOMAIN.BLOCK_ID, blockHeaderBytes(h));
}

/** Compute the tx Merkle root using domain-separated leaf and node hashes
 *  (delegated to the storage module's tree builder for consistency). */
export function txMerkleRoot(txs: TransactionWire[]): Uint8Array {
  if (txs.length === 0) {
    return new Uint8Array(32); // empty root sentinel
  }
  const leaves = txs.map((t) => txId(t));
  return merkleTreeFromLeaves(leaves).root;
}

/** Storage Merkle root: commit to the set of newly-anchored storage
 *  commitments in this block. Empty block → 32-byte zero. */
export function storageMerkleRoot(
  storages: StorageCommitment[]
): Uint8Array {
  if (storages.length === 0) return new Uint8Array(32);
  const leaves = storages.map((s) => storageCommitmentHash(s));
  return merkleTreeFromLeaves(leaves).root;
}

/* ------------------------------------------------------------------ */
/*  CHAIN STATE                                                        */
/* ------------------------------------------------------------------ */

/** Consensus parameters baked into the chain at genesis. Changing these
 *  is a hard fork. */
export interface ConsensusParams {
  /** Average number of validators eligible to propose per slot.            *
   *  ≈ 1.0 for Algorand-style "one expected leader per slot".              */
  expectedProposersPerSlot: number;
  /** Stake-weighted quorum threshold in basis points. 6667 = 2/3 + 1bp.    */
  quorumStakeBps: number;
}

export const DEFAULT_CONSENSUS_PARAMS: ConsensusParams = {
  expectedProposersPerSlot: 1.5,
  quorumStakeBps: 6667,
};

/**
 *  State is keyed by string forms (hex) for convenient JS-object use.
 *  In a production node these would be on-disk merkle-Patricia tries
 *  or sparse Merkle trees. For now an in-memory implementation that's
 *  sufficient to power simulations and end-to-end tests.
 */
export interface ChainState {
  /** Block-height counter. Genesis state has height = -1, first block 0. */
  height: number;
  /** Known unspent outputs, keyed by stealth-address hex. Stores the    *
   *  output's amount commitment AND the block height at which it was   *
   *  first anchored. The commitment is needed so the next spender can  *
   *  include it in a CLSAG ring. The height is needed for gamma-       *
   *  distributed decoy selection — without per-output ages, decoy      *
   *  selection collapses to uniform random, which is statistically     *
   *  distinguishable from real spends.                                  */
  utxo: Map<string, UtxoEntry>;
  /** Spent key images. Used for double-spend detection. */
  spentKeyImages: Set<string>;
  /** Storage commitments anchored on-chain, keyed by their commitment
   *  hash hex. Each entry tracks the commitment object plus the block    *
   *  height at which the commitment was most recently proven via a       *
   *  StorageProof. New entries start with lastProvenAt = anchor height.  */
  storage: Map<string, StorageEntry>;
  /** Accepted block id chain: [genesis_id, block0_id, ...]. */
  blockIds: Uint8Array[];
  /** Active validator set. Fixed at genesis in v0.1; epoch transitions    *
   *  are a future upgrade.                                                */
  validators: Validator[];
  /** Consensus parameters. */
  params: ConsensusParams;
  /** Optional override for the block-emission schedule. Omitting means    *
   *  the chain uses DEFAULT_EMISSION_PARAMS, which is the right answer    *
   *  for testnet and for any chain that wants to inherit the canonical    *
   *  50 → 25 → 12.5 … → 0.195 MFN/block schedule.                         */
  emissionParams?: EmissionParams;
}

export function emptyState(params: ConsensusParams = DEFAULT_CONSENSUS_PARAMS): ChainState {
  return {
    height: -1,
    utxo: new Map(),
    spentKeyImages: new Set(),
    storage: new Map(),
    blockIds: [],
    validators: [],
    params,
  };
}

/* ------------------------------------------------------------------ */
/*  GENESIS                                                            */
/*                                                                     *
 *  Genesis allocates an initial set of stealth outputs and (optionally) *
 *  initial storage anchors. We don't sign these — genesis is part of   *
 *  the protocol's deterministic setup, not a transaction.              */
/* ------------------------------------------------------------------ */

export interface GenesisConfig {
  timestamp: number;
  initialOutputs: { oneTimeAddr: CurvePoint; amount: CurvePoint }[];
  initialStorage: StorageCommitment[];
  /** Initial validator set baked into genesis. Stake weights determine    *
   *  proposer eligibility starting at slot 0. If omitted or empty, the    *
   *  chain runs WITHOUT consensus validation — useful only for tests.     */
  validators?: Validator[];
  /** Consensus parameters; default if omitted. */
  params?: ConsensusParams;
  producerProof?: Uint8Array;
}

export function buildGenesis(cfg: GenesisConfig): Block {
  const header: BlockHeader = {
    version: 1,
    prevHash: new Uint8Array(32),
    height: 0,
    slot: 0,
    timestamp: cfg.timestamp,
    txRoot: new Uint8Array(32),
    storageRoot: storageMerkleRoot(cfg.initialStorage),
    producerProof: cfg.producerProof ?? new Uint8Array(0),
  };
  return { header, txs: [], storageProofs: [], slashings: [] };
}

export function applyGenesis(genesis: Block, cfg: GenesisConfig): ChainState {
  if (genesis.header.height !== 0) throw new Error("genesis height must be 0");
  const state = emptyState(cfg.params ?? DEFAULT_CONSENSUS_PARAMS);
  for (const o of cfg.initialOutputs) {
    state.utxo.set(o.oneTimeAddr.toHex(), { commit: o.amount, height: 0 });
  }
  for (const s of cfg.initialStorage) {
    state.storage.set(bytesToHex(storageCommitmentHash(s)), { commit: s, lastProvenAt: 0 });
  }
  state.height = 0;
  state.blockIds = [blockId(genesis.header)];
  state.validators = cfg.validators ?? [];
  return state;
}

/* ------------------------------------------------------------------ */
/*  BLOCK APPLICATION                                                  */
/* ------------------------------------------------------------------ */

export interface ApplyResult {
  ok: boolean;
  errors: string[];
  /** New state if ok; reference to the input state otherwise. */
  state: ChainState;
  /** Hash of the block applied. */
  blockId: Uint8Array;
}

export function applyBlock(
  state: ChainState,
  block: Block,
  storagesInBlock: Map<string, StorageCommitment> = new Map()
): ApplyResult {
  const errors: string[] = [];

  /* ---- Header sanity ---- */
  if (block.header.height !== state.height + 1) {
    errors.push(
      `bad height: expected ${state.height + 1}, got ${block.header.height}`
    );
  }
  const expectedPrev = state.blockIds[state.blockIds.length - 1];
  if (expectedPrev) {
    if (block.header.prevHash.length !== expectedPrev.length) {
      errors.push("prevHash length mismatch");
    } else {
      for (let i = 0; i < expectedPrev.length; i++) {
        if (expectedPrev[i] !== block.header.prevHash[i]) {
          errors.push("prevHash does not match tip");
          break;
        }
      }
    }
  }

  /* ---- Tx merkle root ---- */
  const expectedTxRoot = txMerkleRoot(block.txs);
  if (!eqBytes(expectedTxRoot, block.header.txRoot)) {
    errors.push("txRoot mismatch");
  }

  /* ---- Producer proof (VRF eligibility + BLS finality) ---- *
   *  When the chain has a validator set baked into genesis, every block   *
   *  at height ≥ 1 MUST carry a valid FinalityProof. When validators is   *
   *  empty (test / legacy mode) the proof is skipped — the chain is then  *
   *  effectively centralized and only useful for development.             *
   *                                                                        *
   *  We capture the verified producer index here for two downstream uses: *
   *    1. Coinbase routing — the producer's payoutAddress determines     *
   *       whether the block must include a coinbase tx (and where its    *
   *       output's stealth address must derive to).                       *
   *    2. Future MEV/fee-burn accounting hooks.                           */
  let producerIdx: number | null = null;
  if (state.validators.length > 0) {
    if (block.header.producerProof.length === 0) {
      errors.push("missing producer proof");
    } else {
      try {
        const fin = decodeFinalityProof(block.header.producerProof);
        const ctx: SlotContext = {
          height: block.header.height,
          slot: block.header.slot,
          prevHash: block.header.prevHash,
        };
        const headerHash = headerSigningHash(block.header);
        const v = verifyFinalityProof(
          ctx,
          fin,
          state.validators,
          state.params.expectedProposersPerSlot,
          state.params.quorumStakeBps,
          headerHash
        );
        if (!v.ok) errors.push(`producer proof: ${v.reason}`);
        else producerIdx = fin.producer.validatorIndex;
      } catch (e) {
        errors.push(`producer proof decode failed: ${(e as Error).message}`);
      }
    }
  }

  /* ---- Tentative state copy (apply if everything passes) ---- */
  const next: ChainState = {
    height: state.height + 1,
    utxo: new Map(state.utxo),
    spentKeyImages: new Set(state.spentKeyImages),
    storage: new Map(state.storage),
    blockIds: [...state.blockIds],
    validators: state.validators,
    params: state.params,
    emissionParams: state.emissionParams,
  };

  // Storage anchors mentioned in the header must be supplied so we can
  // hash them into the storage root. The block format itself only carries
  // the commitment hashes (via outputs); the full StorageCommitment
  // objects are passed alongside via storagesInBlock.
  const newStorages: StorageCommitment[] = [];

  /* ---- Identify producer + decide on coinbase policy ---- *
   *  The producer pays themselves a coinbase iff:                       *
   *    (a) the chain has a producer (verified above), AND               *
   *    (b) that producer's Validator record has a payoutAddress.        *
   *  For backward compat: validator records without payoutAddress       *
   *  (genesis-era / legacy chains) silently skip coinbase. Their fees   *
   *  are not paid out either — they're effectively burned, which is the *
   *  pre-tokenomics behavior. New validators MUST set payoutAddress     *
   *  to claim their share.                                              */
  const producer = producerIdx !== null ? state.validators[producerIdx] : null;
  const requireCoinbase = producer?.payoutAddress !== undefined;

  /* ---- Validate each tx + accumulate fees ---- *
   *  txs[0] may be a coinbase (inputs.length === 0). It's verified by a *
   *  separate code path that does not run CLSAG or balance checks; the  *
   *  rest of the txs go through verifyTransaction as before.            */
  let coinbaseTx: TransactionWire | null = null;
  let feeSum = 0n;

  // Sanity: a coinbase-shaped tx anywhere past position 0 is a protocol
  // violation. Catch it before doing anything else.
  for (let ti = 1; ti < block.txs.length; ti++) {
    if (isCoinbaseShaped(block.txs[ti])) {
      errors.push(`tx[${ti}]: coinbase-shaped tx not allowed past position 0`);
    }
  }

  // Walk every tx. Position 0 routes to coinbase verification when the
  // block declares a coinbase; everything else flows through the regular
  // RingCT verifier.
  for (let ti = 0; ti < block.txs.length; ti++) {
    const tx = block.txs[ti];
    const isCoinbasePos = ti === 0 && isCoinbaseShaped(tx);

    if (isCoinbasePos) {
      coinbaseTx = tx;
      // We DEFER the coinbase amount check until the fee total is known.
      // For now, just add its output to the UTXO set if the rest of the
      // block validates — pessimistic state-change is fine because we
      // throw away `next` on any error.
      for (const out of tx.outputs) {
        next.utxo.set(out.oneTimeAddr.toHex(), {
          commit: out.amount,
          height: block.header.height,
        });
        // Coinbase outputs cannot anchor storage; verifyCoinbase enforces
        // that, so we skip storage handling here.
      }
      continue;
    }

    if (ti === 0 && requireCoinbase) {
      // The chain expects a coinbase but the first tx isn't one.
      errors.push(
        `tx[0]: expected coinbase (inputs.length=0) but got inputs.length=${tx.inputs.length}`
      );
    }

    const v = verifyTransaction(tx);
    if (!v.ok) {
      errors.push(`tx[${ti}] invalid: ${v.errors.join("; ")}`);
      continue;
    }

    // Fees from every regular tx flow to the producer via the coinbase.
    feeSum += tx.fee;

    // Double-spend across the chain.
    for (const ki of v.keyImages) {
      const kiHex = ki.toHex();
      if (next.spentKeyImages.has(kiHex)) {
        errors.push(`tx[${ti}] double-spend: key image ${kiHex.slice(0, 12)}…`);
      } else {
        next.spentKeyImages.add(kiHex);
      }
    }

    // Add new outputs to UTXO set.
    for (const out of tx.outputs) {
      next.utxo.set(out.oneTimeAddr.toHex(), {
        commit: out.amount,
        height: block.header.height,
      });
      if (out.storage) {
        const h = bytesToHex(storageCommitmentHash(out.storage));
        if (!next.storage.has(h)) {
          // First time we see this commitment — anchor it.
          next.storage.set(h, {
            commit: out.storage,
            lastProvenAt: block.header.height,
          });
          newStorages.push(out.storage);
        }
      }
    }
  }

  /* ---- Coinbase deferred until after storage proofs are counted ---- *
   *  The total expected coinbase amount is:                              *
   *      subsidy            ← height-dependent emission                  *
   *    + Σ fees             ← collected from all non-coinbase txs        *
   *    + Σ storageRewards   ← one per accepted storage proof             *
   *                                                                       *
   *  We can't compute it yet because the storage proof loop comes        *
   *  next. The actual verifyCoinbase call happens below, after the       *
   *  proof loop counts how many proofs were accepted. The intervening    *
   *  variable holds onto the coinbase-related state we need.             */

  /* ---- Validate slashing evidence ---- *
   *  Each piece of evidence proves a single validator double-signed at  *
   *  a specific (height, slot). On success we zero their stake in the   *
   *  next state's validator list. Stake is the only field we mutate —   *
   *  the validator's BLS/VRF pubkeys remain for future reference.       */
  const slashedThisBlock = new Set<number>();
  let nextValidators = next.validators;
  for (let si = 0; si < block.slashings.length; si++) {
    const ev = canonicalize(block.slashings[si]);
    if (slashedThisBlock.has(ev.voterIndex)) {
      errors.push(`slashings[${si}]: duplicate evidence for validator ${ev.voterIndex}`);
      continue;
    }
    const v = verifyEvidence(ev, nextValidators);
    if (!v.ok) {
      errors.push(`slashings[${si}]: ${v.reason}`);
      continue;
    }
    slashedThisBlock.add(ev.voterIndex);
    // Lazy-clone validator list on first slash this block.
    if (nextValidators === next.validators) {
      nextValidators = nextValidators.map((vv) => ({ ...vv }));
    }
    nextValidators[ev.voterIndex] = {
      ...nextValidators[ev.voterIndex],
      stake: 0n,
    };
  }
  if (nextValidators !== next.validators) {
    next.validators = nextValidators;
  }

  /* ---- Validate storage proofs (per-block SPoRA audit) ---- *
   *  We also count valid proofs so the coinbase verifier (below) knows  *
   *  exactly how much permanence subsidy the producer is owed. A proof  *
   *  that fails validation contributes ZERO to the producer's reward —  *
   *  no way for a producer to inflate their coinbase by submitting       *
   *  garbage proofs.                                                      */
  const seenProofs = new Set<string>();
  let acceptedStorageProofs = 0;
  for (let pi = 0; pi < block.storageProofs.length; pi++) {
    const proof = block.storageProofs[pi];
    const cHashHex = bytesToHex(proof.commitHash);
    if (seenProofs.has(cHashHex)) {
      errors.push(`storageProof[${pi}]: duplicate proof for ${cHashHex.slice(0, 12)}…`);
      continue;
    }
    seenProofs.add(cHashHex);
    const entry = next.storage.get(cHashHex);
    if (!entry) {
      errors.push(`storageProof[${pi}]: commit ${cHashHex.slice(0, 12)}… not in storage registry`);
      continue;
    }
    const verdict = verifyStorageProof(
      entry.commit,
      block.header.prevHash,
      block.header.slot,
      proof
    );
    if (!verdict.ok) {
      errors.push(`storageProof[${pi}]: ${verdict.reason}`);
      continue;
    }
    next.storage.set(cHashHex, {
      commit: entry.commit,
      lastProvenAt: block.header.height,
    });
    acceptedStorageProofs++;
  }

  /* ---- Coinbase verification (now that fees AND storage proofs are    *
   *  fully accounted for). expectedReward = subsidy + Σ fees + Σ proofs. */
  const emissionParams = state.emissionParams ?? DEFAULT_EMISSION_PARAMS;
  const storageRewardTotal =
    emissionParams.storageProofReward * BigInt(acceptedStorageProofs);

  if (requireCoinbase) {
    if (coinbaseTx === null) {
      errors.push("coinbase required (producer has payoutAddress) but absent");
    } else {
      const subsidy = emissionAtHeight(block.header.height, emissionParams);
      const expectedReward = subsidy + feeSum + storageRewardTotal;
      const cv = verifyCoinbase(
        coinbaseTx,
        block.header.height,
        expectedReward,
        producer!.payoutAddress!
      );
      if (!cv.ok) {
        errors.push(`coinbase invalid: ${cv.errors.join("; ")}`);
      }
    }
  } else if (coinbaseTx !== null) {
    // The chain didn't expect a coinbase but the producer included one.
    errors.push(
      "unexpected coinbase: producer has no payoutAddress; cannot accept block subsidy"
    );
  }

  /* ---- Storage root must match what the txs anchored ---- */
  // Walk the tx outputs in declared order, gather all storage commitments.
  // Sort? No — the producer chooses an order, the verifier re-derives it.
  const expectedStorageRoot = storageMerkleRoot(newStorages);
  if (!eqBytes(expectedStorageRoot, block.header.storageRoot)) {
    errors.push("storageRoot mismatch");
  }
  // The supplied storagesInBlock is a courtesy parameter for callers who
  // want to also verify the block-level storage Merkle tree without the
  // commitments being inside the tx graph (e.g. genesis). For now we
  // ignore it during regular block application — the per-tx outputs are
  // the canonical source.
  void storagesInBlock;

  if (errors.length > 0) {
    return { ok: false, errors, state, blockId: blockId(block.header) };
  }

  next.blockIds.push(blockId(block.header));
  return {
    ok: true,
    errors: [],
    state: next,
    blockId: next.blockIds[next.blockIds.length - 1],
  };
}

/* ------------------------------------------------------------------ */
/*  BLOCK BUILDER  (producer side)                                     */
/* ------------------------------------------------------------------ */

export interface BuildBlockArgs {
  state: ChainState;
  txs: TransactionWire[];
  /** Slot number for this block. Defaults to height (1 slot per height)   *
   *  when omitted — fine for tests, real consensus passes an explicit     *
   *  slot from the network's slot timer.                                   */
  slot?: number;
  timestamp: number;
  /** Pre-encoded FinalityProof bytes (ie. the result of                    *
   *  encodeFinalityProof(...)). Optional only for tests; production blocks *
   *  must always include it.                                                */
  producerProof?: Uint8Array;
  /** Storage proofs the producer is offering this block. Optional;        *
   *  empty list is valid (no slot-audits answered). */
  storageProofs?: StorageProof[];
  /** Slashing evidence to include. */
  slashings?: SlashEvidence[];
  /** Producer payout address. When provided AND the state's validator    *
   *  set has consensus-mode active, buildBlock automatically prepends a  *
   *  coinbase tx paying emission + Σ fees to this address. When omitted, *
   *  no coinbase is emitted (legacy / centralized mode).                  */
  producerPayout?: { viewPub: CurvePoint; spendPub: CurvePoint };
}

/** Build a block header WITHOUT a producer proof. Use this to compute the  *
 *  signing hash a producer + committee will sign over, then attach the     *
 *  encoded FinalityProof and call sealBlock(). */
export function buildUnsealedHeader(args: {
  state: ChainState;
  txs: TransactionWire[];
  slot: number;
  timestamp: number;
}): BlockHeader {
  const newStorages: StorageCommitment[] = [];
  for (const tx of args.txs) {
    for (const out of tx.outputs) if (out.storage) newStorages.push(out.storage);
  }
  const prevHash =
    args.state.blockIds[args.state.blockIds.length - 1] ?? new Uint8Array(32);
  return {
    version: 1,
    prevHash,
    height: args.state.height + 1,
    slot: args.slot,
    timestamp: args.timestamp,
    txRoot: txMerkleRoot(args.txs),
    storageRoot: storageMerkleRoot(newStorages),
    producerProof: new Uint8Array(0),
  };
}

/** Attach an encoded producer/finality proof to a header. */
export function sealBlock(
  header: BlockHeader,
  txs: TransactionWire[],
  producerProof: Uint8Array,
  storageProofs: StorageProof[] = [],
  slashings: SlashEvidence[] = []
): Block {
  return {
    header: { ...header, producerProof },
    txs,
    storageProofs,
    slashings,
  };
}

export function buildBlock(args: BuildBlockArgs): Block {
  const slot = args.slot ?? args.state.height + 1;
  const height = args.state.height + 1;

  // Prepend the coinbase if a producer payout address is provided. The
  // coinbase pays emission(height) + Σ fees + Σ permanence subsidy and
  // matches the applyBlock-side expectation byte-for-byte (verifyCoinbase
  // rechecks). The "permanence subsidy" rewards the producer for each
  // storage proof they're including in this block — the carrot side of
  // the data-permanence incentive structure.
  let txs = args.txs;
  if (args.producerPayout) {
    const emissionParams = args.state.emissionParams ?? DEFAULT_EMISSION_PARAMS;
    const subsidy = emissionAtHeight(height, emissionParams);
    let feeSum = 0n;
    for (const tx of args.txs) feeSum += tx.fee;
    const storageRewardTotal =
      emissionParams.storageProofReward * BigInt((args.storageProofs ?? []).length);
    const total = subsidy + feeSum + storageRewardTotal;
    const cb = buildCoinbase(height, total, args.producerPayout);
    txs = [cb, ...args.txs];
  }

  const header = buildUnsealedHeader({
    state: args.state,
    txs,
    slot,
    timestamp: args.timestamp,
  });
  return sealBlock(
    header,
    txs,
    args.producerProof ?? new Uint8Array(0),
    args.storageProofs ?? [],
    args.slashings ?? []
  );
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

void Point;
void DOMAIN;
