/**
 * Consensus-enforced privacy posture for the public testnet.
 * Static labels only — no wallet or address data.
 */
export const PRODUCTION_PRIVACY_POLICY = {
  ringSize: 16,
  minInputs: 2,
  minOutputs: 2,
  signature: "CLSAG",
  txVersion: 2,
  viewTags: true,
  dandelionOptional: true,
  encryptedAmounts: true,
  stealthOutputs: true,
} as const;

export type PrivacyPolicyLabels = typeof PRODUCTION_PRIVACY_POLICY;

export const PRIVACY_SHIELDS: ReadonlyArray<{
  id: string;
  label: string;
  detail: string;
}> = [
  {
    id: "ring16",
    label: "Uniform ring-16",
    detail: "Every spend hides among 16 ring members — consensus rejects smaller rings.",
  },
  {
    id: "clsag",
    label: "CLSAG only",
    detail: "Ring signatures without legacy LSAG in production binaries.",
  },
  {
    id: "stealth",
    label: "Stealth outputs",
    detail: "One-time addresses — no reusable account graph on-chain.",
  },
  {
    id: "enc",
    label: "Encrypted amounts",
    detail: "Bulletproof range proofs; values are not transparent like Ethereum.",
  },
  {
    id: "viewtag",
    label: "View tags (v2)",
    detail: "~256× faster wallet scan without revealing balances publicly.",
  },
  {
    id: "mfer",
    label: "MFER endowment proofs",
    detail: "Upload surplus range proofs bind permanence pricing without opening amounts.",
  },
];
