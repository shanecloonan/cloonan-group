/* tslint:disable */
/* eslint-disable */

/**
 * Recompute `block_id` from header wire hex (does not trust RPC-supplied ids).
 */
export function blockIdFromHeaderHex(header_hex: string): string;

/**
 * Build a SPoRA storage proof from seed, payload bytes, and commitment wire hex.
 */
export function buildStorageProof(seed_hex: string, data: Uint8Array, prev_block_id_hex: string, slot: number, commitment_wire_hex: string): string;

/**
 * Build and sign a storage upload tx; `plan_json` describes inputs, anchor, decoys, fee.
 */
export function buildStorageUpload(seed_hex: string, data: Uint8Array, plan_json: string): string;

/**
 * Build and sign a CLSAG transfer; `plan_json` matches the Rust [`TransferPlanJson`] shape.
 */
export function buildTransferJson(plan_json: string): string;

/**
 * Cross-check a trusted summary JSON against a signed checkpoint log (**F12** phase 3).
 */
export function checkpointLogCrossCheck(summary_json: string, log_jsonl: string): string;

/**
 * Verify a signed checkpoint log JSONL in the browser (**F12** phase 3).
 */
export function checkpointLogVerify(log_jsonl: string): string;

/**
 * Derive the MFCL claiming public key from the same wallet seed.
 */
export function claimPubkeyFromSeedHex(seed_hex: string): string;

/**
 * Preview a decoy pool from a JSON array of `{height, one_time_addr_hex, commit_hex}`.
 */
export function decoyPoolPreviewJson(decoy_utxos_json: string, exclude_one_time_addrs_hex: string[]): string;

/**
 * Apply validator-set evolution after header verify; returns updated checkpoint hex.
 */
export function lightChainApplyEvolution(checkpoint_hex: string, header_hex: string, evolution_json: string): string;

/**
 * Build a genesis light-follower checkpoint from `get_chain_params` JSON.
 */
export function lightChainBootstrapCheckpoint(trust_json: string): string;

/**
 * Weak-subjectivity digest of a light-follower checkpoint (**M4.14**).
 */
export function lightChainCheckpointSummary(checkpoint_hex: string): string;

/**
 * Verify a header against a light-follower checkpoint (evolving trusted set).
 */
export function lightChainVerifyHeader(checkpoint_hex: string, header_hex: string): string;

/**
 * Compare a trusted summary JSON against a checkpoint (**M4.14**).
 */
export function lightChainWeakSubjectivity(trusted_summary_json: string, checkpoint_hex: string): string;

/**
 * Require multiple `get_light_follow` batches to agree row-for-row (**M4.14**).
 */
export function lightFollowQuorum(batches_json: string): string;

/**
 * Scan a wire-encoded block (hex) for outputs owned by the wallet seed.
 */
export function scanBlockHex(seed_hex: string, block_hex: string, owned_key_images_hex: string[]): string;

/**
 * Scan wire-encoded transactions at `height` without downloading the full block body.
 */
export function scanBlockTxsHex(seed_hex: string, height: number, tx_hexes: string[], owned_key_images_hex: string[]): string;

/**
 * Scan a wire-encoded transaction (hex) for outputs owned by the wallet seed.
 *
 * `owned_key_images_hex` is a JS array of 64-hex-char key images for outputs
 * already known to be unspent (empty array if none).
 */
export function scanTransactionHex(seed_hex: string, tx_hex: string, height: number, owned_key_images_hex: string[]): string;

/**
 * Extract one chunk of payload data as hex for HTTP replication.
 */
export function storageChunkHex(data: Uint8Array, chunk_size: number, index: number): string;

/**
 * Chunk payload bytes and return storage commitment preview JSON.
 *
 * `replication` is the on-chain replication factor (≥ 1).
 */
export function storageUploadPreview(data: Uint8Array, replication: number): string;

/**
 * Minimum mempool fee for a storage upload (returns JSON number).
 */
export function uploadMinFee(data_len: number, replication: number, fee_to_treasury_bps: number): string;

/**
 * Verify BLS finality + validator-root binding on a header wire hex.
 *
 * `validators_json` / `consensus_json` match [`get_chain_params`] RPC fields.
 */
export function verifyHeaderHex(header_hex: string, validators_json: string, consensus_json: string): string;

/**
 * Verify a SPoRA storage proof; returns JSON `{ valid, check }`.
 */
export function verifyStorageProof(commitment_wire_hex: string, prev_block_id_hex: string, slot: number, proof_wire_hex: string): string;

/**
 * Derive stealth address public keys from a 64-hex-char wallet seed.
 *
 * Returns a JSON string: `{"view_pub":"…","spend_pub":"…"}`.
 */
export function walletAddressFromSeedHex(seed_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly blockIdFromHeaderHex: (a: number, b: number) => [number, number, number, number];
    readonly buildStorageProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly buildStorageUpload: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly buildTransferJson: (a: number, b: number) => [number, number, number, number];
    readonly checkpointLogCrossCheck: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly checkpointLogVerify: (a: number, b: number) => [number, number, number, number];
    readonly claimPubkeyFromSeedHex: (a: number, b: number) => [number, number, number, number];
    readonly decoyPoolPreviewJson: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly lightChainApplyEvolution: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly lightChainBootstrapCheckpoint: (a: number, b: number) => [number, number, number, number];
    readonly lightChainCheckpointSummary: (a: number, b: number) => [number, number, number, number];
    readonly lightChainVerifyHeader: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly lightChainWeakSubjectivity: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly lightFollowQuorum: (a: number, b: number) => [number, number, number, number];
    readonly scanBlockHex: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly scanBlockTxsHex: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly scanTransactionHex: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly storageChunkHex: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly storageUploadPreview: (a: number, b: number, c: number) => [number, number, number, number];
    readonly uploadMinFee: (a: number, b: number, c: number) => [number, number, number, number];
    readonly verifyHeaderHex: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly verifyStorageProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly walletAddressFromSeedHex: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
