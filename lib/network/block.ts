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
  /** SLOT (not height) at which this commitment was last proven. Used   *
   *  by the endowment-proportional reward accumulator below — slots,    *
   *  not heights, are the natural time-unit for per-slot yield. On a    *
   *  perfectly-active chain slot ≈ height; under leader-misses they    *
   *  diverge and slot is the correct one (height undercounts). At       *
   *  anchor time, initialized to the slot of the block that included   *
   *  the upload tx.                                                     */
  lastProvenSlot: bigint;
  /** Sub-base-unit yield accumulator, in PPB. Carries the fractional    *
   *  per-slot yield across proofs so even commitments with payouts <<   *
   *  1 base unit per slot eventually earn integer base units. Initial   *
   *  value 0 at anchor; reset to (totalPpb mod PPB) after each proof    *
   *  payout. See `accrueProofReward` in endowment.ts.                   */
  pendingYieldPpb: bigint;
}
import {
  DOMAIN,
  Writer,
  Reader,
  dhash,
  bytesToHex,
} from "./codec";
import { bondMerkleRoot, type BondOp } from "./bond";
import {
  epochIdForHeight,
  validateStake,
  tryRegisterEntryChurn,
  DEFAULT_BONDING_PARAMS,
  type BondingParams,
} from "./bonding";
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
import {
  DEFAULT_ENDOWMENT_PARAMS,
  requiredEndowment,
  validateEndowmentParams,
  accrueProofReward,
  type EndowmentParams,
} from "./endowment";
import {
  emptyUtxoTree,
  appendUtxo,
  utxoTreeRoot,
  utxoLeafHash,
  type UtxoTreeState,
} from "./utxo-tree";

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
  /** Merkle root of [`Block.bondOps`] (omit or zero when empty). */
  bondRoot?: Uint8Array;
  /** MFBN-encoded FinalityProof: VRF eligibility + BLS aggregate finality.
   *  Genesis is the only block where this is allowed to be empty. */
  producerProof: Uint8Array;
  /** Cryptographic UTXO accumulator root at the END of this block — the   *
   *  32-byte hash committing to every output the chain has ever anchored. *
   *  Light clients use this to verify membership without downloading the  *
   *  full UTXO set, and log-size ring signatures (Triptych and beyond)   *
   *  prove their inputs are members of this accumulator. Optional in the  *
   *  header wire format for backward compat with pre-accumulator chains;  *
   *  new blocks SHOULD always include it.                                 */
  utxoRoot?: Uint8Array;
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
  /** Validator bonding / rotation operations (M1). Verified against      *
   *  `header.bondRoot` before mutating the validator set.                */
  bondOps?: BondOp[];
}

/* ------------------------------------------------------------------ */
/*  HASHING                                                            */
/* ------------------------------------------------------------------ */

/** Full header bytes for [`blockId`] — matches `mfn-consensus` `block_header_bytes`
 *  (including `bondRoot` after `storageRoot`, length-prefixed `producerProof`,
 *  then 32-byte `utxoRoot`). */
export function blockHeaderBytes(h: BlockHeader): Uint8Array {
  const w = new Writer();
  w.varint(h.version);
  w.push(h.prevHash);
  w.u32(h.height);
  w.u32(h.slot);
  w.u64(BigInt(h.timestamp));
  w.push(h.txRoot);
  w.push(h.storageRoot);
  w.push(headerBondRootBytes(h));
  w.blob(h.producerProof);
  w.push(h.utxoRoot ?? new Uint8Array(32));
  return w.bytes();
}

function headerBondRootBytes(h: BlockHeader): Uint8Array {
  return h.bondRoot ?? new Uint8Array(32);
}

/** Decode a canonical block header (MFBN-1 layout with bond root + utxo root). */
export function decodeBlockHeader(bytes: Uint8Array): BlockHeader {
  const r = new Reader(bytes);
  const version = Number(r.varint());
  const prevHash = r.bytes(32);
  const height = r.u32();
  const slot = r.u32();
  const timestamp = Number(r.u64());
  const txRoot = r.bytes(32);
  const storageRoot = r.bytes(32);
  const bondRoot = r.bytes(32);
  const producerProof = r.blob();
  const utxoRoot = r.bytes(32);
  return {
    version,
    prevHash,
    height,
    slot,
    timestamp,
    txRoot,
    storageRoot,
    bondRoot,
    producerProof,
    utxoRoot,
  };
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
  w.push(headerBondRootBytes(h));
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
  /** Optional override for the storage endowment formula. Defaulted to    *
   *  DEFAULT_ENDOWMENT_PARAMS (2 × 10⁻⁴ base units per byte-year per      *
   *  replica, i = 2% storage cost inflation, r = 4% real treasury yield). *
   *  Applied per-upload tx to enforce the protocol-required treasury     *
   *  contribution.                                                        */
  endowmentParams?: EndowmentParams;
  /** On-chain permanence treasury balance, in MFN base units. Filled by   *
   *  the storage-funding share of every tx fee (and, in a future tx-       *
   *  type upgrade, by required upload endowments). Drained per accepted   *
   *  storage proof to pay the producer's permanence subsidy. When the     *
   *  treasury can't cover a block's storage rewards, the remainder is     *
   *  MINTED via emission as a backstop — see fee-accounting in applyBlock.*
   *                                                                        *
   *  Invariant: treasury >= 0 at all times.                                */
  treasury: bigint;
  /** Cryptographic UTXO accumulator state. Every output the chain has     *
   *  ever anchored is appended (in deterministic order) to this fixed-     *
   *  depth Merkle tree. The 32-byte root is committed into each block     *
   *  header (header.utxoRoot) so light clients and log-size ring          *
   *  signatures can prove membership against a single 32-byte digest.    *
   *                                                                        *
   *  Append order is canonical: for each accepted block, outputs are     *
   *  appended in (tx-index, output-index) order. The coinbase (tx 0     *
   *  when present) comes first.                                            */
  utxoTree: UtxoTreeState;
  /** Bonding / rotation parameters (M1). */
  bondingParams: BondingParams;
  /** Epoch id (`floor(height / slots_per_epoch)`) for `bondEpochEntryCount`. */
  bondEpochId: bigint;
  /** Validators registered via bond ops in the current epoch. */
  bondEpochEntryCount: number;
  /** Next validator `index` for a newly bonded validator. */
  nextValidatorIndex: number;
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
    treasury: 0n,
    utxoTree: emptyUtxoTree(),
    bondingParams: DEFAULT_BONDING_PARAMS,
    bondEpochId: 0n,
    bondEpochEntryCount: 0,
    nextValidatorIndex: 0,
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
  // Pre-compute the UTXO accumulator root for the initial outputs so the
  // genesis header commits to the chain's start-of-time UTXO set. Every
  // subsequent block extends the same tree.
  let tree = emptyUtxoTree();
  for (const o of cfg.initialOutputs) {
    tree = appendUtxo(tree, utxoLeafHash(o.oneTimeAddr, o.amount, 0));
  }
  const header: BlockHeader = {
    version: 1,
    prevHash: new Uint8Array(32),
    height: 0,
    slot: 0,
    timestamp: cfg.timestamp,
    txRoot: new Uint8Array(32),
    storageRoot: storageMerkleRoot(cfg.initialStorage),
    bondRoot: new Uint8Array(32),
    producerProof: cfg.producerProof ?? new Uint8Array(0),
    utxoRoot: utxoTreeRoot(tree),
  };
  return { header, txs: [], storageProofs: [], slashings: [], bondOps: [] };
}

export function applyGenesis(genesis: Block, cfg: GenesisConfig): ChainState {
  if (genesis.header.height !== 0) throw new Error("genesis height must be 0");
  const state = emptyState(cfg.params ?? DEFAULT_CONSENSUS_PARAMS);
  for (const o of cfg.initialOutputs) {
    state.utxo.set(o.oneTimeAddr.toHex(), { commit: o.amount, height: 0 });
    // Genesis outputs are appended to the accumulator in the order listed,
    // so every chain participant arrives at the same tree root from the
    // genesis config alone.
    state.utxoTree = appendUtxo(
      state.utxoTree,
      utxoLeafHash(o.oneTimeAddr, o.amount, 0)
    );
  }
  for (const s of cfg.initialStorage) {
    state.storage.set(bytesToHex(storageCommitmentHash(s)), {
      commit: s,
      lastProvenAt: 0,
      lastProvenSlot: 0n,
      pendingYieldPpb: 0n,
    });
  }
  state.height = 0;
  state.blockIds = [blockId(genesis.header)];
  state.validators = cfg.validators ?? [];
  const vs = state.validators;
  state.nextValidatorIndex =
    vs.length === 0 ? 0 : Math.max(...vs.map((v) => v.index)) + 1;
  state.bondingParams = DEFAULT_BONDING_PARAMS;
  state.bondEpochId = 0n;
  state.bondEpochEntryCount = 0;
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

interface BondApplyDelta {
  bondEpochId: bigint;
  bondEpochEntryCount: number;
  nextValidatorIndex: number;
  newValidators: Validator[];
}

function simulateBondOps(
  height: number,
  bondEpochId: bigint,
  bondEpochEntryCount: number,
  nextValidatorIndex: number,
  validators: readonly Validator[],
  bondingParams: BondingParams,
  ops: readonly BondOp[]
):
  | { ok: true; delta: BondApplyDelta }
  | { ok: false; index: number; message: string } {
  let bEpoch = bondEpochId;
  let bec = bondEpochEntryCount;
  let nvi = nextValidatorIndex;
  let eid: bigint;
  try {
    eid = epochIdForHeight(height, bondingParams.slotsPerEpoch);
  } catch (e) {
    return { ok: false, index: 0, message: (e as Error).message };
  }
  if (eid !== bEpoch) {
    bEpoch = eid;
    bec = 0;
  }
  const seenVrf = new Set(validators.map((v) => v.vrfPk.toHex()));
  const newValidators: Validator[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.kind !== "register") {
      return { ok: false, index: i, message: "unknown bond op kind" };
    }
    try {
      validateStake(op.stake, bondingParams);
    } catch (e) {
      return { ok: false, index: i, message: (e as Error).message };
    }
    const vrfH = op.vrfPk.toHex();
    if (seenVrf.has(vrfH)) {
      return { ok: false, index: i, message: "duplicate vrf_pk" };
    }
    seenVrf.add(vrfH);
    try {
      bec = tryRegisterEntryChurn(bec, bondingParams);
    } catch (e) {
      return { ok: false, index: i, message: (e as Error).message };
    }
    const idx = nvi;
    nvi += 1;
    newValidators.push({
      index: idx,
      vrfPk: op.vrfPk,
      blsPk: op.blsPk,
      stake: op.stake,
      ...(op.payout
        ? {
            payoutAddress: {
              viewPub: op.payout.viewPub,
              spendPub: op.payout.spendPub,
            },
          }
        : {}),
    });
  }
  return {
    ok: true,
    delta: {
      bondEpochId: bEpoch,
      bondEpochEntryCount: bec,
      nextValidatorIndex: nvi,
      newValidators,
    },
  };
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

  const expectedBondRoot = bondMerkleRoot(block.bondOps ?? []);
  if (!eqBytes(expectedBondRoot, headerBondRootBytes(block.header))) {
    errors.push("bondRoot mismatch");
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
    endowmentParams: state.endowmentParams,
    treasury: state.treasury,
    utxoTree: state.utxoTree,
    bondingParams: state.bondingParams,
    bondEpochId: state.bondEpochId,
    bondEpochEntryCount: state.bondEpochEntryCount,
    nextValidatorIndex: state.nextValidatorIndex,
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
        // Append into the cryptographic UTXO accumulator. Coinbase outputs
        // are included so that providers paid via coinbase can later spend
        // them through log-size ring signatures, same as any other output.
        next.utxoTree = appendUtxo(
          next.utxoTree,
          utxoLeafHash(out.oneTimeAddr, out.amount, block.header.height)
        );
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

    /* ---- Storage upload endowment enforcement ----                       *
     *                                                                       *
     *  This is the spam-resistance and economic-soundness check on uploads. *
     *  For every storage commitment this tx introduces as a NEW anchor      *
     *  (not already in the registry), the tx must contribute at least the  *
     *  protocol-required endowment to the treasury.                         *
     *                                                                       *
     *  Burden is computed as:                                               *
     *    burden = Σ requiredEndowment(commit.sizeBytes, commit.replication) *
     *                                                                       *
     *  Constraint: tx.fee × feeToTreasuryBps / 10000  ≥  burden             *
     *                                                                       *
     *  Rationale: the producer keeps the (1 − feeToTreasuryBps) tip, so we *
     *  only count the treasury-bound share toward the endowment. Producers *
     *  earn their share separately as a normal fee tip. Subsequent re-      *
     *  references to an already-anchored commitment are free (the first    *
     *  anchor already paid). The replication factor is also bounded here   *
     *  to enforce min/max-replica policy from EndowmentParams.              */
    const epp = state.endowmentParams ?? DEFAULT_ENDOWMENT_PARAMS;
    validateEndowmentParams(epp);
    let txBurden = 0n;
    let txStorageOk = true;
    for (let oi = 0; oi < tx.outputs.length && txStorageOk; oi++) {
      const out = tx.outputs[oi];
      if (!out.storage) continue;
      const h = bytesToHex(storageCommitmentHash(out.storage));
      // Only NEW anchors incur burden — duplicates are inert.
      if (next.storage.has(h)) continue;
      const repl = out.storage.replication;
      if (repl < epp.minReplication) {
        errors.push(
          `tx[${ti}].outputs[${oi}]: storage replication ${repl} < minReplication ${epp.minReplication}`
        );
        txStorageOk = false;
        break;
      }
      if (repl > epp.maxReplication) {
        errors.push(
          `tx[${ti}].outputs[${oi}]: storage replication ${repl} > maxReplication ${epp.maxReplication}`
        );
        txStorageOk = false;
        break;
      }
      if (out.storage.sizeBytes < 0n) {
        errors.push(`tx[${ti}].outputs[${oi}]: storage sizeBytes < 0`);
        txStorageOk = false;
        break;
      }
      txBurden += requiredEndowment(out.storage.sizeBytes, repl, epp);
    }
    if (!txStorageOk) continue;
    if (txBurden > 0n) {
      const epm = state.emissionParams ?? DEFAULT_EMISSION_PARAMS;
      const txTreasuryShare =
        (tx.fee * BigInt(epm.feeToTreasuryBps)) / 10000n;
      if (txTreasuryShare < txBurden) {
        errors.push(
          `tx[${ti}]: storage endowment burden ${txBurden} exceeds tx treasury-fee share ${txTreasuryShare} ` +
            `(fee=${tx.fee}, feeToTreasuryBps=${epm.feeToTreasuryBps}); upload underfunded`
        );
        continue;
      }
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

    // Add new outputs to UTXO set + accumulator. Order matters for the
    // accumulator: outputs are appended in (tx-index, output-index) order
    // across the whole block, with the coinbase always at position 0.
    for (const out of tx.outputs) {
      next.utxo.set(out.oneTimeAddr.toHex(), {
        commit: out.amount,
        height: block.header.height,
      });
      next.utxoTree = appendUtxo(
        next.utxoTree,
        utxoLeafHash(out.oneTimeAddr, out.amount, block.header.height)
      );
      if (out.storage) {
        const h = bytesToHex(storageCommitmentHash(out.storage));
        if (!next.storage.has(h)) {
          // First time we see this commitment — anchor it. lastProvenSlot
          // starts at this block's slot (so the first proof one slot later
          // earns one slot's worth of yield, not a huge backlog).
          next.storage.set(h, {
            commit: out.storage,
            lastProvenAt: block.header.height,
            lastProvenSlot: BigInt(block.header.slot),
            pendingYieldPpb: 0n,
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

  /* ---- Validate storage proofs (per-block SPoRA audit) AND accrue    *
   *       per-proof endowment-proportional bonus via the PPB           *
   *       accumulator. Each accepted proof earns:                      *
   *                                                                     *
   *         baseReward = emissionParams.storageProofReward             *
   *                      (flat, fixed by chain config — keeps tiny    *
   *                       commits incentivized to be proven)          *
   *                                                                     *
   *         + bonus = accrueProofReward(commit, pending, last, now)   *
   *           (endowment-proportional yield, accumulated in PPB so    *
   *            even sub-base-unit per-slot yields eventually pay out) *
   *                                                                     *
   *       Garbage proofs contribute zero (they hit `continue`).       */
  const seenProofs = new Set<string>();
  let acceptedStorageProofs = 0;
  let storageBonusTotal = 0n;
  const epForReward = state.endowmentParams ?? DEFAULT_ENDOWMENT_PARAMS;
  const currentSlotBig = BigInt(block.header.slot);
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
    const accrual = accrueProofReward({
      sizeBytes: entry.commit.sizeBytes,
      replication: entry.commit.replication,
      pendingPpb: entry.pendingYieldPpb,
      lastProvenSlot: entry.lastProvenSlot,
      currentSlot: currentSlotBig,
      params: epForReward,
    });
    next.storage.set(cHashHex, {
      commit: entry.commit,
      lastProvenAt: block.header.height,
      lastProvenSlot: currentSlotBig,
      pendingYieldPpb: accrual.newPendingPpb,
    });
    acceptedStorageProofs++;
    storageBonusTotal += accrual.payout;
  }

  /* ---- Bond ops (M1): append validators; runs after storage proofs,   *
   *      before fee / coinbase settlement (mirrors permawrite ordering   *
   *      relative to economic checks).                                    */
  const bondOps = block.bondOps ?? [];
  const bondSim = simulateBondOps(
    block.header.height,
    next.bondEpochId,
    next.bondEpochEntryCount,
    next.nextValidatorIndex,
    next.validators,
    next.bondingParams,
    bondOps
  );
  if (!bondSim.ok) {
    errors.push(`bond_ops[${bondSim.index}]: ${bondSim.message}`);
  } else {
    next.bondEpochId = bondSim.delta.bondEpochId;
    next.bondEpochEntryCount = bondSim.delta.bondEpochEntryCount;
    next.nextValidatorIndex = bondSim.delta.nextValidatorIndex;
    if (bondSim.delta.newValidators.length > 0) {
      next.validators = [...next.validators, ...bondSim.delta.newValidators];
    }
  }

  /* ---- Two-sided economic settlement ----                              *
   *                                                                       *
   *  Now that we know Σ fees AND the number of accepted storage proofs,  *
   *  we can run the full economic update:                                *
   *                                                                       *
   *    1. Split fees: treasuryFee = feeSum · feeToTreasuryBps / 10000    *
   *                    producerFee = feeSum − treasuryFee                *
   *    2. Treasury gains treasuryFee.                                    *
   *    3. Storage rewards drain from the treasury first; any shortfall  *
   *       is minted via emission as a backstop. (Backstop is what keeps *
   *       the chain functional in pre-fee-traffic eras; once usage      *
   *       grows, the chain becomes self-sustaining.)                    *
   *    4. The coinbase pays producer = subsidy + producerFee +          *
   *       storageRewardTotal. The producer doesn't care WHERE the       *
   *       storage reward came from — they always receive the full       *
   *       per-proof amount.                                              */
  const emissionParams = state.emissionParams ?? DEFAULT_EMISSION_PARAMS;
  // Total storage reward = flat base (per accepted proof) + endowment-
  // proportional bonus (accumulated above in storageBonusTotal). Both are
  // sourced from the treasury first; emission backstops any shortfall.
  const storageRewardTotal =
    emissionParams.storageProofReward * BigInt(acceptedStorageProofs)
    + storageBonusTotal;

  const treasuryFee =
    (feeSum * BigInt(emissionParams.feeToTreasuryBps)) / 10000n;
  const producerFee = feeSum - treasuryFee;

  // First add this block's treasury inflow, then drain the storage reward.
  let pendingTreasury = next.treasury + treasuryFee;
  let storageFromTreasury: bigint;
  if (pendingTreasury >= storageRewardTotal) {
    storageFromTreasury = storageRewardTotal;
  } else {
    storageFromTreasury = pendingTreasury;
  }
  pendingTreasury -= storageFromTreasury;
  // The remaining storage reward (if any) is minted as a transitional
  // backstop. The producer always receives the full storageRewardTotal.
  // Treasury balance never goes negative.
  next.treasury = pendingTreasury;

  if (requireCoinbase) {
    if (coinbaseTx === null) {
      errors.push("coinbase required (producer has payoutAddress) but absent");
    } else {
      const subsidy = emissionAtHeight(block.header.height, emissionParams);
      const expectedReward = subsidy + producerFee + storageRewardTotal;
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

  /* ---- UTXO accumulator root must match what we computed ----          *
   *  This is the new consensus rule that makes light clients + log-      *
   *  size ring signatures possible. The header MAY omit utxoRoot for     *
   *  backward compat (the field is optional in the wire), but if it is   *
   *  present, it MUST equal the locally-computed post-block tree root.  *
   *  Any divergence indicates either a non-determinism bug or a bad-     *
   *  faith producer fabricating the accumulator commitment.              */
  if (block.header.utxoRoot) {
    const computedRoot = utxoTreeRoot(next.utxoTree);
    if (!eqBytes(block.header.utxoRoot, computedRoot)) {
      errors.push(
        `utxoRoot mismatch: header says ${bytesToHex(block.header.utxoRoot).slice(0, 16)}…, ` +
          `chain computed ${bytesToHex(computedRoot).slice(0, 16)}…`
      );
    }
  }

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
  /** Validator bond operations (M1). */
  bondOps?: BondOp[];
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
  bondOps?: BondOp[];
  slot: number;
  timestamp: number;
}): BlockHeader {
  const bondOps = args.bondOps ?? [];
  const newStorages: StorageCommitment[] = [];
  for (const tx of args.txs) {
    for (const out of tx.outputs) if (out.storage) newStorages.push(out.storage);
  }
  const prevHash =
    args.state.blockIds[args.state.blockIds.length - 1] ?? new Uint8Array(32);
  const height = args.state.height + 1;

  // Compute the post-block UTXO accumulator root by mirroring applyBlock's
  // append order: every output (coinbase output first if present, then
  // tx-by-tx, output-by-output) is appended in declaration order. This
  // must match applyBlock byte-for-byte or the header verification fails.
  let projectedTree = args.state.utxoTree;
  for (const tx of args.txs) {
    for (const out of tx.outputs) {
      projectedTree = appendUtxo(
        projectedTree,
        utxoLeafHash(out.oneTimeAddr, out.amount, height)
      );
    }
  }
  return {
    version: 1,
    prevHash,
    height,
    slot: args.slot,
    timestamp: args.timestamp,
    txRoot: txMerkleRoot(args.txs),
    storageRoot: storageMerkleRoot(newStorages),
    bondRoot: bondMerkleRoot(bondOps),
    producerProof: new Uint8Array(0),
    utxoRoot: utxoTreeRoot(projectedTree),
  };
}

/** Attach an encoded producer/finality proof to a header. */
export function sealBlock(
  header: BlockHeader,
  txs: TransactionWire[],
  producerProof: Uint8Array,
  storageProofs: StorageProof[] = [],
  slashings: SlashEvidence[] = [],
  bondOps: BondOp[] = []
): Block {
  return {
    header: { ...header, producerProof },
    txs,
    storageProofs,
    slashings,
    bondOps,
  };
}

export function buildBlock(args: BuildBlockArgs): Block {
  const slot = args.slot ?? args.state.height + 1;
  const height = args.state.height + 1;

  // Prepend the coinbase if a producer payout address is provided. The
  // coinbase amount must match applyBlock's two-sided settlement exactly:
  //   coinbase = emission(height)                (security subsidy)
  //            + producerFee                      (10% tip from fee market)
  //            + storageProofReward × N_accepted  (flat permanence subsidy)
  //            + Σ accrueProofReward(commit)      (endowment-proportional
  //                                                bonus via PPB accumulator)
  //   90% of fees → on-chain treasury; storage rewards drain treasury
  //   first, with emission minting the shortfall as a backstop.
  let txs = args.txs;
  if (args.producerPayout) {
    const emissionParams = args.state.emissionParams ?? DEFAULT_EMISSION_PARAMS;
    const endowmentParams = args.state.endowmentParams ?? DEFAULT_ENDOWMENT_PARAMS;
    const subsidy = emissionAtHeight(height, emissionParams);
    let feeSum = 0n;
    for (const tx of args.txs) feeSum += tx.fee;
    const treasuryFee =
      (feeSum * BigInt(emissionParams.feeToTreasuryBps)) / 10000n;
    const producerFee = feeSum - treasuryFee;
    // Mirror applyBlock's accrual exactly. Must walk proofs in the same
    // order, dedup on commitHash, skip unregistered commits, and use the
    // SAME (pendingYieldPpb, lastProvenSlot, currentSlot) inputs.
    const seenForReward = new Set<string>();
    let storageBonusTotal = 0n;
    let acceptedCount = 0;
    const currentSlotBig = BigInt(slot);
    for (const sp of args.storageProofs ?? []) {
      const cHashHex = bytesToHex(sp.commitHash);
      if (seenForReward.has(cHashHex)) continue;
      seenForReward.add(cHashHex);
      const entry = args.state.storage.get(cHashHex);
      if (!entry) continue;
      const accrual = accrueProofReward({
        sizeBytes: entry.commit.sizeBytes,
        replication: entry.commit.replication,
        pendingPpb: entry.pendingYieldPpb,
        lastProvenSlot: entry.lastProvenSlot,
        currentSlot: currentSlotBig,
        params: endowmentParams,
      });
      storageBonusTotal += accrual.payout;
      acceptedCount++;
    }
    const flatTotal = emissionParams.storageProofReward * BigInt(acceptedCount);
    const total = subsidy + producerFee + flatTotal + storageBonusTotal;
    const cb = buildCoinbase(height, total, args.producerPayout);
    txs = [cb, ...args.txs];
  }

  const header = buildUnsealedHeader({
    state: args.state,
    txs,
    bondOps: args.bondOps,
    slot,
    timestamp: args.timestamp,
  });
  return sealBlock(
    header,
    txs,
    args.producerProof ?? new Uint8Array(0),
    args.storageProofs ?? [],
    args.slashings ?? [],
    args.bondOps ?? []
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

