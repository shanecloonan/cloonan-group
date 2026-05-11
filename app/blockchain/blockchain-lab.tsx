"use client";

/* ================================================================== */
/*  MONEYFUND NETWORK · BLOCKCHAIN LAB                                  */
/*                                                                      */
/*  Live, in-browser cryptographic primitives — the foundation layer    */
/*  of the MoneyFund Network. Every byte you see below is computed by   */
/*  audited @noble/curves running on ed25519. Nothing is mocked.        */
/*                                                                      */
/*  Tabs:                                                               */
/*    1.  Schnorr signatures   (cyan)                                   */
/*    2.  Pedersen commitments (amber)   — RingCT confidential amounts  */
/*    3.  Stealth addresses    (violet)  — CryptoNote one-time outputs  */
/*    4.  LSAG ring signatures (emerald) — Monero-style anonymity       */
/*    5.  Range proofs         (rose)    — bit-decomp confidential v ≥0 */
/*    6.  Storage commitments  (sky)     — content-addressed permanence */
/*    7.  Transactions         (fuchsia) — full RingCT-style tx flow    */
/*    8.  Blocks & state       (lime)    — chain validation, dbl-spend  */
/* ================================================================== */

import { useCallback, useMemo, useState } from "react";
import {
  G,
  H,
  L,
  scalarToHex,
  pointToHex,
  bytesToHex,
  schnorrKeygen,
  schnorrSign,
  schnorrVerify,
  pedersenCommit,
  pedersenSum,
  pedersenBalance,
  stealthGen,
  stealthSendTo,
  stealthDetect,
  stealthSpendKey,
  lsagSign,
  lsagVerify,
  lsagLinked,
  randomScalar,
  type SchnorrKeypair,
  type SchnorrSignature,
  type PedersenCommitment,
  type StealthWallet,
  type StealthOutput,
  type LsagSignature,
  type CurvePoint,
} from "@/lib/network/primitives";
import {
  rangeProve,
  rangeVerify,
  type RangeProof,
} from "@/lib/network/range";
import {
  buildStorageCommitment,
  storageCommitmentHash,
  challengeFromSeed,
  respondToChallenge,
  verifyChallengeResponse,
  type StorageCommitment,
  type MerkleTree,
} from "@/lib/network/storage";
import {
  signTransaction,
  verifyTransaction,
  txId,
  type TransactionWire,
  type InputSpec,
} from "@/lib/network/transaction";
import {
  buildGenesis,
  applyGenesis,
  buildBlock,
  applyBlock,
  blockId,
  type ChainState,
  type Block,
} from "@/lib/network/block";
import {
  bpProve,
  bpVerify,
  bpProofSize,
  type BulletproofRange,
} from "@/lib/network/bulletproofs";
import {
  vrfKeygen,
  vrfProve,
  vrfVerify,
  vrfOutputAsIndex,
  type VrfKeypair,
  type VrfProof,
} from "@/lib/network/vrf";
import {
  blsKeygen,
  blsSign,
  blsVerify,
  aggregateCommitteeVotes,
  verifyCommitteeAggregate,
  type BlsKeypair,
  type CommitteeAggregate,
} from "@/lib/network/bls";
import {
  kzgInsecureSetup,
  kzgCommit,
  kzgOpen,
  kzgVerify,
  polyEval,
  type KzgSrs,
} from "@/lib/network/kzg";
import {
  tryProduceSlot,
  verifyProducerProof,
  pickWinner,
  castVote,
  finalize,
  verifyFinalityProof,
  type Validator,
  type ValidatorSecrets,
  type SlotContext,
  type FinalityProof,
} from "@/lib/network/consensus";

/* ------------------------------------------------------------------ */
/*  DESIGN TOKENS                                                      */
/* ------------------------------------------------------------------ */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

type Accent =
  | "cyan" | "amber" | "violet" | "emerald" | "rose" | "sky" | "fuchsia" | "lime"
  | "teal" | "indigo" | "yellow" | "orange" | "red" | "slate";

const ACCENT: Record<Accent, { text: string; ring: string; bg: string; soft: string; chip: string; glow: string }> = {
  cyan:    { text: "text-cyan-300",    ring: "border-cyan-400/30",    bg: "bg-cyan-500/10",    soft: "from-cyan-500/[0.06] to-transparent",    chip: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",    glow: "shadow-cyan-500/10" },
  amber:   { text: "text-amber-300",   ring: "border-amber-400/30",   bg: "bg-amber-500/10",   soft: "from-amber-500/[0.06] to-transparent",   chip: "bg-amber-500/15 text-amber-200 border-amber-400/30",   glow: "shadow-amber-500/10" },
  violet:  { text: "text-violet-300",  ring: "border-violet-400/30",  bg: "bg-violet-500/10",  soft: "from-violet-500/[0.06] to-transparent",  chip: "bg-violet-500/15 text-violet-200 border-violet-400/30", glow: "shadow-violet-500/10" },
  emerald: { text: "text-emerald-300", ring: "border-emerald-400/30", bg: "bg-emerald-500/10", soft: "from-emerald-500/[0.06] to-transparent", chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30", glow: "shadow-emerald-500/10" },
  rose:    { text: "text-rose-300",    ring: "border-rose-400/30",    bg: "bg-rose-500/10",    soft: "from-rose-500/[0.06] to-transparent",    chip: "bg-rose-500/15 text-rose-200 border-rose-400/30",    glow: "shadow-rose-500/10" },
  sky:     { text: "text-sky-300",     ring: "border-sky-400/30",     bg: "bg-sky-500/10",     soft: "from-sky-500/[0.06] to-transparent",     chip: "bg-sky-500/15 text-sky-200 border-sky-400/30",     glow: "shadow-sky-500/10" },
  fuchsia: { text: "text-fuchsia-300", ring: "border-fuchsia-400/30", bg: "bg-fuchsia-500/10", soft: "from-fuchsia-500/[0.06] to-transparent", chip: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/30", glow: "shadow-fuchsia-500/10" },
  lime:    { text: "text-lime-300",    ring: "border-lime-400/30",    bg: "bg-lime-500/10",    soft: "from-lime-500/[0.06] to-transparent",    chip: "bg-lime-500/15 text-lime-200 border-lime-400/30",    glow: "shadow-lime-500/10" },
  teal:    { text: "text-teal-300",    ring: "border-teal-400/30",    bg: "bg-teal-500/10",    soft: "from-teal-500/[0.06] to-transparent",    chip: "bg-teal-500/15 text-teal-200 border-teal-400/30",    glow: "shadow-teal-500/10" },
  indigo:  { text: "text-indigo-300",  ring: "border-indigo-400/30",  bg: "bg-indigo-500/10",  soft: "from-indigo-500/[0.06] to-transparent",  chip: "bg-indigo-500/15 text-indigo-200 border-indigo-400/30", glow: "shadow-indigo-500/10" },
  yellow:  { text: "text-yellow-300",  ring: "border-yellow-400/30",  bg: "bg-yellow-500/10",  soft: "from-yellow-500/[0.06] to-transparent",  chip: "bg-yellow-500/15 text-yellow-200 border-yellow-400/30", glow: "shadow-yellow-500/10" },
  orange:  { text: "text-orange-300",  ring: "border-orange-400/30",  bg: "bg-orange-500/10",  soft: "from-orange-500/[0.06] to-transparent",  chip: "bg-orange-500/15 text-orange-200 border-orange-400/30", glow: "shadow-orange-500/10" },
  red:     { text: "text-red-300",     ring: "border-red-400/30",     bg: "bg-red-500/10",     soft: "from-red-500/[0.06] to-transparent",     chip: "bg-red-500/15 text-red-200 border-red-400/30",     glow: "shadow-red-500/10" },
  slate:   { text: "text-slate-200",   ring: "border-slate-400/30",   bg: "bg-slate-500/10",   soft: "from-slate-500/[0.06] to-transparent", chip: "bg-slate-500/15 text-slate-200 border-slate-400/30", glow: "shadow-slate-500/10" },
};

/* ------------------------------------------------------------------ */
/*  UI HELPERS                                                         */
/* ------------------------------------------------------------------ */

function shorten(hex: string, head = 8, tail = 6): string {
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Hex display block with copy. */
function HexRow({
  label,
  hex,
  accent = "cyan",
  hint,
}: {
  label: string;
  hex: string;
  accent?: Accent;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const a = ACCENT[accent];

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }, [hex]);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={`text-[10px] tracking-[0.2em] uppercase font-bold ${a.text}`}>
            {label}
          </span>
          {hint && <span className="text-[10px] text-white/30 truncate">{hint}</span>}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="text-[9px] tracking-[0.15em] uppercase text-white/40 hover:text-white/80 font-semibold transition-colors cursor-pointer shrink-0"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <p className="font-mono text-[11px] text-white/70 break-all leading-relaxed">
        {shorten(hex, 18, 12)}
      </p>
    </div>
  );
}

/** Pass/fail status badge. */
function Badge({ ok, label, accent = "cyan" }: { ok: boolean; label: string; accent?: Accent }) {
  const a = ACCENT[accent];
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold tracking-[0.15em] uppercase ${
        ok ? `${a.bg} ${a.text} ${a.ring}` : "bg-rose-500/10 text-rose-300 border-rose-400/30"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? `bg-current` : "bg-rose-400"}`} />
      {ok ? `✓ ${label}` : `✗ ${label} failed`}
    </div>
  );
}

function SectionTitle({ accent, n, title, sub }: { accent: Accent; n: string; title: string; sub: string }) {
  const a = ACCENT[accent];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-3">
        <span className={`text-[10px] font-mono tabular-nums tracking-[0.2em] ${a.text}`}>{n}</span>
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h2>
      </div>
      <p className="text-[12px] text-white/45 leading-relaxed">{sub}</p>
      <div className={`mt-2 h-[2px] w-12 rounded-full ${a.bg}`} />
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  accent = "cyan",
}: {
  onClick: () => void;
  children: React.ReactNode;
  accent?: Accent;
}) {
  const a = ACCENT[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg border ${a.ring} ${a.bg} ${a.text} text-[11px] font-bold tracking-[0.15em] uppercase hover:brightness-125 active:scale-[0.98] transition-all cursor-pointer`}
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-white/70 text-[11px] font-bold tracking-[0.15em] uppercase hover:bg-white/[0.05] hover:text-white hover:border-white/[0.15] active:scale-[0.98] transition-all cursor-pointer"
    >
      {children}
    </button>
  );
}

/* ================================================================== */
/*  PANEL 1 · SCHNORR                                                   */
/* ================================================================== */

function SchnorrPanel() {
  const [keypair, setKeypair] = useState<SchnorrKeypair>(() => schnorrKeygen());
  const [msg, setMsg] = useState<string>("MoneyFund · zk-bridge proof");
  const [sig, setSig] = useState<SchnorrSignature | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [tampered, setTampered] = useState<boolean>(false);

  const msgBytes = useMemo(() => new TextEncoder().encode(msg), [msg]);

  const onRegen = () => {
    setKeypair(schnorrKeygen());
    setSig(null);
    setVerified(null);
    setTampered(false);
  };

  const onSign = () => {
    const s = schnorrSign(msgBytes, keypair);
    setSig(s);
    setVerified(null);
    setTampered(false);
  };

  const onVerify = () => {
    if (!sig) return;
    const checkBytes = tampered
      ? new TextEncoder().encode(msg + " (tampered)")
      : msgBytes;
    setVerified(schnorrVerify(checkBytes, sig, keypair.pubKey));
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="cyan"
        n="01"
        title="Schnorr Signature"
        sub={
          "Discrete-log signature over ed25519. Sign R = r·G, s = r + e·x with e = H(R || P || m). Verify s·G ≟ R + e·P. Foundation primitive — every other module on this page reuses these patterns."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        {/* keypair */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Signer keypair
          </p>
          <PrimaryButton accent="cyan" onClick={onRegen}>
            Regenerate keypair
          </PrimaryButton>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HexRow
            label="x · private key"
            hex={scalarToHex(keypair.privKey)}
            accent="cyan"
            hint="x ∈ Z_L"
          />
          <HexRow
            label="P = x·G · public key"
            hex={pointToHex(keypair.pubKey)}
            accent="cyan"
            hint="32-byte compressed Edwards"
          />
        </div>
      </div>

      {/* message + sign */}
      <div className={`${card} p-5 space-y-4`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
          Message
        </p>
        <textarea
          value={msg}
          onChange={(e) => {
            setMsg(e.target.value);
            setSig(null);
            setVerified(null);
          }}
          className="w-full min-h-[60px] rounded-lg border border-white/[0.08] bg-black/30 text-white/85 text-sm font-mono px-3 py-2 outline-none focus:border-cyan-400/50 transition-colors resize-y"
          placeholder="Type a message to sign…"
        />

        <div className="flex flex-wrap items-center gap-2">
          <PrimaryButton accent="cyan" onClick={onSign}>
            Sign
          </PrimaryButton>
          {sig && <GhostButton onClick={onVerify}>Verify</GhostButton>}
          {sig && (
            <label className="flex items-center gap-2 ml-auto text-[11px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={tampered}
                onChange={(e) => {
                  setTampered(e.target.checked);
                  setVerified(null);
                }}
                className="accent-rose-400"
              />
              Tamper with message before verifying
            </label>
          )}
        </div>

        {sig && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <HexRow label="R = r·G" hex={pointToHex(sig.R)} accent="cyan" hint="public commitment" />
            <HexRow label="s = r + e·x mod L" hex={scalarToHex(sig.s)} accent="cyan" hint="response scalar" />
          </div>
        )}

        {verified !== null && (
          <div className="pt-1">
            <Badge accent="cyan" ok={verified} label="signature verified" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL 2 · PEDERSEN COMMITMENTS                                      */
/* ================================================================== */

function PedersenPanel() {
  const [inputs, setInputs] = useState<PedersenCommitment[]>(() => [
    pedersenCommit(100n),
    pedersenCommit(50n),
  ]);
  const [outputs, setOutputs] = useState<PedersenCommitment[]>(() => []);
  const [showOpen, setShowOpen] = useState<boolean>(false);

  const totalIn = useMemo(() => pedersenSum(inputs), [inputs]);
  const totalOut = useMemo(
    () => (outputs.length ? pedersenSum(outputs) : null),
    [outputs]
  );
  const balanced = totalOut !== null && pedersenBalance(inputs, outputs);

  const addInput = useCallback((value: bigint) => {
    setInputs((prev) => [...prev, pedersenCommit(value)]);
    setOutputs([]);
  }, []);

  const addRandomInput = () => addInput(BigInt(Math.floor(Math.random() * 200) + 1));

  const removeInput = (idx: number) => {
    setInputs((prev) => prev.filter((_, i) => i !== idx));
    setOutputs([]);
  };

  /** Build a single output commitment whose value+blinding equal the sum of inputs.
   *  This is what a RingCT transaction does: it proves the outputs sum to inputs. */
  const buildBalancedOutput = () => {
    setOutputs([
      {
        C: G.multiply(totalIn.blinding).add(H.multiply(totalIn.value)),
        value: totalIn.value,
        blinding: totalIn.blinding,
      },
    ]);
  };

  /** Tamper: build an output with a different value (should fail balance). */
  const buildTamperedOutput = () => {
    const wrong = totalIn.value + 1n;
    setOutputs([
      {
        C: G.multiply(totalIn.blinding).add(H.multiply(wrong)),
        value: wrong,
        blinding: totalIn.blinding,
      },
    ]);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="amber"
        n="02"
        title="Pedersen Commitment"
        sub={
          "C(v, r) = r·G + v·H — perfectly hides the value v while binding the committer to it. Additively homomorphic, which is exactly what RingCT confidential amounts need: prove ∑ inputs = ∑ outputs without revealing any individual amount."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Generators
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HexRow label="G · base point" hex={pointToHex(G)} accent="amber" hint="ed25519 generator" />
          <HexRow label="H = H_p(G)" hex={pointToHex(H)} accent="amber" hint="independent generator" />
        </div>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Input commitments
          </p>
          <div className="flex gap-2">
            <PrimaryButton accent="amber" onClick={addRandomInput}>
              + add random input
            </PrimaryButton>
            <GhostButton onClick={() => setShowOpen((s) => !s)}>
              {showOpen ? "hide secrets" : "reveal v, r"}
            </GhostButton>
          </div>
        </div>

        <div className="space-y-2">
          {inputs.map((c, i) => (
            <div key={i} className="rounded-lg border border-white/[0.06] bg-black/30 p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] text-white/60 font-semibold font-mono">
                  C<sub>{i}</sub>
                  {showOpen && (
                    <span className="ml-2 text-amber-300/80">
                      v={c.value.toString()} · r={shorten(scalarToHex(c.blinding), 6, 4)}
                    </span>
                  )}
                </span>
                {inputs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeInput(i)}
                    className="text-[10px] text-white/30 hover:text-rose-300 cursor-pointer"
                  >
                    remove
                  </button>
                )}
              </div>
              <p className="font-mono text-[11px] text-white/70 break-all leading-relaxed">
                {shorten(pointToHex(c.C), 18, 12)}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-amber-400/15 bg-amber-500/[0.03] p-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-amber-300/80 font-bold mb-2">
            Sum of inputs
          </p>
          <p className="font-mono text-[11px] text-white/70 break-all leading-relaxed">
            {shorten(pointToHex(totalIn.C), 18, 12)}
          </p>
          {showOpen && (
            <p className="text-[10px] text-amber-300/70 mt-2 font-mono">
              ∑ v = {totalIn.value.toString()}
            </p>
          )}
        </div>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Output commitment
          </p>
          <div className="flex gap-2">
            <PrimaryButton accent="amber" onClick={buildBalancedOutput}>
              build balanced output
            </PrimaryButton>
            <GhostButton onClick={buildTamperedOutput}>build tampered output</GhostButton>
          </div>
        </div>

        {outputs.length === 0 ? (
          <p className="text-[11px] text-white/35 italic">
            No output yet. A real RingCT transaction would have one or more outputs whose
            value + blinding-factor sums equal the input sums.
          </p>
        ) : (
          <>
            {outputs.map((c, i) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-black/30 p-3 space-y-1">
                <p className="text-[10px] text-white/40 font-mono">
                  C<sub>out,{i}</sub>
                  {showOpen && (
                    <span className="ml-2 text-amber-300/80">v={c.value.toString()}</span>
                  )}
                </p>
                <p className="font-mono text-[11px] text-white/70 break-all">
                  {shorten(pointToHex(c.C), 18, 12)}
                </p>
              </div>
            ))}
            <div className="pt-1">
              <Badge accent="amber" ok={balanced} label="balance proof: ∑in = ∑out" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL 3 · STEALTH ADDRESS                                           */
/* ================================================================== */

function StealthPanel() {
  const [alice, setAlice] = useState<StealthWallet>(() => stealthGen());
  const [bob, setBob] = useState<StealthWallet>(() => stealthGen());
  const [output, setOutput] = useState<StealthOutput | null>(null);
  const [aliceDetect, setAliceDetect] = useState<boolean | null>(null);
  const [bobDetect, setBobDetect] = useState<boolean | null>(null);
  const [spendKey, setSpendKey] = useState<bigint | null>(null);

  const onRegenWallets = () => {
    setAlice(stealthGen());
    setBob(stealthGen());
    setOutput(null);
    setAliceDetect(null);
    setBobDetect(null);
    setSpendKey(null);
  };

  const onSendToAlice = () => {
    const out = stealthSendTo({ viewPub: alice.viewPub, spendPub: alice.spendPub });
    setOutput(out);
    setAliceDetect(stealthDetect(out, { viewPriv: alice.viewPriv, spendPub: alice.spendPub }));
    setBobDetect(stealthDetect(out, { viewPriv: bob.viewPriv, spendPub: bob.spendPub }));
    setSpendKey(stealthSpendKey(out, { viewPriv: alice.viewPriv, spendPriv: alice.spendPriv }));
  };

  const spendKeyValid = useMemo(() => {
    if (!output || spendKey === null) return false;
    return G.multiply(spendKey).equals(output.oneTimeAddr);
  }, [output, spendKey]);

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="violet"
        n="03"
        title="Stealth Address"
        sub={
          "CryptoNote dual-key wallet (a, b). Sender computes a fresh one-time address P = H_s(r·A)·G + B for every payment. Only the recipient's view-key a can recognize that P is theirs; only their spend-key b can produce x with x·G = P. External observers see uncorrelated outputs."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Wallet keys
          </p>
          <PrimaryButton accent="violet" onClick={onRegenWallets}>
            Regenerate wallets
          </PrimaryButton>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.04] p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-violet-200">Alice</p>
            <HexRow label="A = a·G" hex={pointToHex(alice.viewPub)} accent="violet" hint="public view key" />
            <HexRow label="B = b·G" hex={pointToHex(alice.spendPub)} accent="violet" hint="public spend key" />
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-white/70">Bob (eavesdropper)</p>
            <HexRow label="A = a·G" hex={pointToHex(bob.viewPub)} accent="violet" hint="public view key" />
            <HexRow label="B = b·G" hex={pointToHex(bob.spendPub)} accent="violet" hint="public spend key" />
          </div>
        </div>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Sender → Alice
          </p>
          <PrimaryButton accent="violet" onClick={onSendToAlice}>
            Send payment to Alice
          </PrimaryButton>
        </div>

        {output ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <HexRow label="R = r·G" hex={pointToHex(output.R)} accent="violet" hint="tx public key" />
              <HexRow
                label="P = H_s(r·A)·G + B"
                hex={pointToHex(output.oneTimeAddr)}
                accent="violet"
                hint="one-time output address"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="rounded-lg border border-violet-400/20 bg-violet-500/[0.04] p-3 space-y-1.5">
                <p className="text-[10px] tracking-[0.2em] uppercase text-violet-200/80 font-bold">
                  Alice scans with her view key
                </p>
                {aliceDetect !== null && (
                  <Badge ok={aliceDetect} label="output is mine" accent="violet" />
                )}
              </div>
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-1.5">
                <p className="text-[10px] tracking-[0.2em] uppercase text-white/50 font-bold">
                  Bob scans with his view key
                </p>
                {bobDetect !== null && (
                  <Badge
                    ok={!bobDetect}
                    label={bobDetect ? "BOB detected (would be a bug)" : "output is NOT bob's (correct)"}
                    accent="violet"
                  />
                )}
              </div>
            </div>

            {spendKey !== null && (
              <div className="rounded-lg border border-violet-400/20 bg-violet-500/[0.04] p-4 space-y-2.5">
                <p className="text-[10px] tracking-[0.2em] uppercase text-violet-200/80 font-bold">
                  Alice derives the one-time spend key
                </p>
                <HexRow
                  label="x = H_s(a·R) + b"
                  hex={scalarToHex(spendKey)}
                  accent="violet"
                  hint="one-time private key"
                />
                <Badge ok={spendKeyValid} label="x·G = P (Alice can spend)" accent="violet" />
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-white/35 italic">
            Click <span className="text-violet-300">Send payment to Alice</span> to generate a one-time
            output and walk through the detect / spend flow.
          </p>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL 4 · LSAG RING SIGNATURE                                       */
/* ================================================================== */

interface RingMember {
  pub: CurvePoint;
  priv: bigint;
}

function genRing(n: number): RingMember[] {
  const ring: RingMember[] = [];
  for (let i = 0; i < n; i++) {
    const k = randomScalar();
    ring.push({ pub: G.multiply(k), priv: k });
  }
  return ring;
}

function RingPanel() {
  const [ringSize, setRingSize] = useState<number>(5);
  const [ring, setRing] = useState<RingMember[]>(() => genRing(5));
  const [signerIdx, setSignerIdx] = useState<number>(0);
  const [msg, setMsg] = useState<string>("storage allocation: 1TB · 31 days");
  const [sig, setSig] = useState<LsagSignature | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [secondSig, setSecondSig] = useState<LsagSignature | null>(null);
  const [secondMsg, setSecondMsg] = useState<string>("storage allocation: 1TB · 32 days");
  const [otherSignerIdx, setOtherSignerIdx] = useState<number>(2);
  const [otherSig, setOtherSig] = useState<LsagSignature | null>(null);

  const ringPubs = useMemo(() => ring.map((r) => r.pub), [ring]);

  const onResize = (n: number) => {
    setRingSize(n);
    setRing(genRing(n));
    setSignerIdx(0);
    setOtherSignerIdx(Math.min(2, n - 1));
    setSig(null);
    setVerified(null);
    setSecondSig(null);
    setOtherSig(null);
  };

  const onRegen = () => {
    setRing(genRing(ringSize));
    setSig(null);
    setVerified(null);
    setSecondSig(null);
    setOtherSig(null);
  };

  const onSign = () => {
    const s = lsagSign(new TextEncoder().encode(msg), ringPubs, signerIdx, ring[signerIdx].priv);
    setSig(s);
    setVerified(lsagVerify(new TextEncoder().encode(msg), ringPubs, s));
    setSecondSig(null);
    setOtherSig(null);
  };

  const onSignSecond = () => {
    const s = lsagSign(new TextEncoder().encode(secondMsg), ringPubs, signerIdx, ring[signerIdx].priv);
    setSecondSig(s);
  };

  const onSignAsOther = () => {
    const s = lsagSign(
      new TextEncoder().encode(msg),
      ringPubs,
      otherSignerIdx,
      ring[otherSignerIdx].priv
    );
    setOtherSig(s);
  };

  const linkedSelf = sig && secondSig ? lsagLinked(sig, secondSig) : null;
  const linkedOther = sig && otherSig ? lsagLinked(sig, otherSig) : null;

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="emerald"
        n="04"
        title="LSAG Ring Signature"
        sub={
          "Sign as one of N possible signers without revealing which. Linkable: the same signer always emits the same key image I = x · H_p(P), letting verifiers detect double-spends without identifying the spender. Foundation of Monero RingCT."
        }
      />

      {/* ring builder */}
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Ring size: {ringSize}
          </p>
          <PrimaryButton accent="emerald" onClick={onRegen}>
            Regenerate ring
          </PrimaryButton>
        </div>

        <input
          type="range"
          min={2}
          max={11}
          value={ringSize}
          onChange={(e) => onResize(Number(e.target.value))}
          className="w-full h-1.5 bg-white/[0.08] rounded-full appearance-none cursor-pointer accent-emerald-400"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ring.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setSignerIdx(i);
                setSig(null);
                setVerified(null);
                setSecondSig(null);
                setOtherSig(null);
              }}
              className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${
                i === signerIdx
                  ? "border-emerald-400/40 bg-emerald-500/10"
                  : "border-white/[0.06] bg-black/30 hover:border-white/[0.15] hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <p className={`text-[10px] tracking-[0.2em] uppercase font-bold ${i === signerIdx ? "text-emerald-200" : "text-white/50"}`}>
                  P<sub>{i}</sub>
                </p>
                {i === signerIdx && (
                  <span className="text-[9px] tracking-[0.2em] uppercase font-bold text-emerald-300">
                    SIGNER
                  </span>
                )}
              </div>
              <p className="font-mono text-[10px] text-white/55 break-all leading-snug">
                {shorten(pointToHex(m.pub), 12, 8)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* sign + verify */}
      <div className={`${card} p-5 space-y-4`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
          Sign on behalf of P<sub>{signerIdx}</sub>
        </p>
        <textarea
          value={msg}
          onChange={(e) => {
            setMsg(e.target.value);
            setSig(null);
            setVerified(null);
            setSecondSig(null);
            setOtherSig(null);
          }}
          className="w-full min-h-[60px] rounded-lg border border-white/[0.08] bg-black/30 text-white/85 text-sm font-mono px-3 py-2 outline-none focus:border-emerald-400/50 transition-colors resize-y"
          placeholder="Type a message…"
        />
        <PrimaryButton accent="emerald" onClick={onSign}>
          Produce ring signature
        </PrimaryButton>

        {sig && (
          <div className="space-y-3 pt-1">
            <HexRow
              label="I = x · H_p(P) · key image"
              hex={pointToHex(sig.I)}
              accent="emerald"
              hint="prevents double-spend"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <HexRow label="c₀" hex={scalarToHex(sig.c0)} accent="emerald" hint="ring entry challenge" />
              <HexRow
                label={`s ∈ Z_L^${sig.s.length}`}
                hex={sig.s.map((x) => scalarToHex(x)).join("")}
                accent="emerald"
                hint={`${sig.s.length} response scalars`}
              />
            </div>
            {verified !== null && (
              <Badge ok={verified} label="ring signature verifies" accent="emerald" />
            )}
          </div>
        )}
      </div>

      {/* linkability */}
      {sig && (
        <div className={`${card} p-5 space-y-4`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Linkability test (key-image equality)
          </p>

          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4 space-y-3">
            <p className="text-[11px] text-white/65">
              <span className="text-emerald-300 font-semibold">Same signer, second message.</span>{" "}
              The key image I should be identical — that&apos;s how a verifier detects a
              double-spend without learning the signer&apos;s identity.
            </p>
            <input
              type="text"
              value={secondMsg}
              onChange={(e) => setSecondMsg(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-black/40 text-white/85 text-sm font-mono px-3 py-2 outline-none focus:border-emerald-400/50 transition-colors"
            />
            <GhostButton onClick={onSignSecond}>sign second message as P{signerIdx}</GhostButton>
            {secondSig && (
              <>
                <HexRow
                  label="I (second signature)"
                  hex={pointToHex(secondSig.I)}
                  accent="emerald"
                />
                {linkedSelf !== null && (
                  <Badge ok={linkedSelf} label="key images match (LINKED)" accent="emerald" />
                )}
              </>
            )}
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-4 space-y-3">
            <p className="text-[11px] text-white/65">
              <span className="text-emerald-300 font-semibold">Different signer.</span>{" "}
              The key image must differ — anonymity within the ring is preserved.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-white/40 tracking-[0.2em] uppercase">Sign as</span>
              <select
                value={otherSignerIdx}
                onChange={(e) => setOtherSignerIdx(Number(e.target.value))}
                className="rounded-lg border border-white/[0.08] bg-black/40 text-white/85 text-xs px-3 py-1.5 outline-none focus:border-emerald-400/50 cursor-pointer"
              >
                {ring.map((_, i) =>
                  i === signerIdx ? null : (
                    <option key={i} value={i}>
                      P{i}
                    </option>
                  )
                )}
              </select>
              <GhostButton onClick={onSignAsOther}>sign as P{otherSignerIdx}</GhostButton>
            </div>
            {otherSig && (
              <>
                <HexRow
                  label={`I (P${otherSignerIdx}'s signature)`}
                  hex={pointToHex(otherSig.I)}
                  accent="emerald"
                />
                {linkedOther !== null && (
                  <Badge
                    ok={!linkedOther}
                    label={
                      linkedOther
                        ? "key images match (BUG — different signers should differ)"
                        : "key images differ (NOT linked — correct)"
                    }
                    accent="emerald"
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 5 · RANGE PROOFS                                              */
/* ================================================================== */

function RangePanel() {
  const [value, setValue] = useState<number>(42);
  const [N, setN] = useState<number>(8);
  const [result, setResult] = useState<{
    C: CurvePoint;
    proof: RangeProof;
    blinding: bigint;
    value: bigint;
  } | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [tampered, setTampered] = useState<boolean>(false);

  const max = (1 << N) - 1;
  const clampedValue = Math.min(value, max);

  const onProve = () => {
    const r = randomScalar();
    const { C, proof } = rangeProve(BigInt(clampedValue), r, N);
    setResult({ C, proof, blinding: r, value: BigInt(clampedValue) });
    setVerified(null);
    setTampered(false);
  };

  const onVerify = () => {
    if (!result) return;
    let p = result.proof;
    if (tampered) {
      const newS0 = [...p.s0];
      newS0[0] = (newS0[0] + 1n) % L;
      p = { ...p, s0: newS0 };
    }
    setVerified(rangeVerify(result.C, p));
  };

  const proofBytes = result
    ? 32 + 32 * result.proof.bitCommits.length + 32 + 32 * 3 * result.proof.N
    : 0;

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="rose"
        n="05"
        title="Range Proof"
        sub={
          "Proves a Pedersen commitment C = r·G + v·H hides a value v ∈ [0, 2^N) without revealing v. Without this an attacker could commit to v = L − 1 (negative wraparound) and silently inflate the supply. Bit-decomposition + 1-of-2 sigma OR-proof per bit, batched via Fiat–Shamir."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Hidden value v
            </p>
            <input
              type="range"
              min={0}
              max={max}
              step={1}
              value={clampedValue}
              onChange={(e) => setValue(Number(e.target.value))}
              className="w-full accent-rose-400"
            />
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-2xl font-mono tabular-nums text-rose-300 font-bold">
                {clampedValue}
              </span>
              <span className="text-[11px] text-white/40 font-mono">
                in [0, 2^{N}) = [0, {max + 1})
              </span>
            </div>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Bit width N
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[4, 8, 16, 32].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setN(n);
                    setValue(Math.min(value, (1 << n) - 1));
                    setResult(null);
                    setVerified(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-[0.15em] uppercase cursor-pointer transition-all ${
                    n === N
                      ? "bg-rose-500/15 text-rose-200 border-rose-400/40"
                      : "bg-white/[0.02] text-white/50 border-white/[0.06] hover:text-white/80"
                  }`}
                >
                  N = {n}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/35 mt-2 leading-relaxed">
              Production uses N = 64 (full u64). Smaller N here so the proof
              builds in the browser without long pauses.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <PrimaryButton accent="rose" onClick={onProve}>
            Build range proof
          </PrimaryButton>
          {result && (
            <>
              <GhostButton onClick={onVerify}>Verify</GhostButton>
              <label className="flex items-center gap-2 ml-auto text-[11px] text-white/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tampered}
                  onChange={(e) => {
                    setTampered(e.target.checked);
                    setVerified(null);
                  }}
                  className="accent-rose-400"
                />
                Tamper with one response scalar
              </label>
            </>
          )}
        </div>
      </div>

      {result && (
        <div className={`${card} p-5 space-y-4`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Public commitment + proof
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <HexRow
              label="C = r·G + v·H"
              hex={pointToHex(result.C)}
              accent="rose"
              hint="hides v"
            />
            <HexRow
              label="r · blinding (private)"
              hex={scalarToHex(result.blinding)}
              accent="rose"
              hint="never published"
            />
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[10px] tracking-[0.2em] uppercase text-rose-300 font-bold">
                Bit decomposition
              </p>
              <p className="text-[10px] text-white/35 font-mono">
                {result.proof.N} commitments, ~{proofBytes} bytes total
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: result.proof.N }, (_, i) => {
                const bit = Number(
                  (result.value >> BigInt(result.proof.N - 1 - i)) & 1n
                );
                return (
                  <div
                    key={i}
                    className={`w-7 h-7 rounded-md border flex items-center justify-center text-xs font-mono font-bold ${
                      bit === 1
                        ? "bg-rose-500/20 text-rose-200 border-rose-400/40"
                        : "bg-white/[0.02] text-white/30 border-white/[0.06]"
                    }`}
                    title={`b_${result.proof.N - 1 - i} = ${bit}`}
                  >
                    {bit}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-white/35 mt-2 leading-relaxed font-mono">
              v = Σ b<sub>i</sub>·2<sup>i</sup> = {result.value.toString()}
            </p>
          </div>

          {verified !== null && (
            <Badge ok={verified} label="range proof verifies" accent="rose" />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 6 · STORAGE COMMITMENTS                                       */
/* ================================================================== */

function StoragePanel() {
  const [text, setText] = useState<string>(
    "MoneyFund Network · permanent payload v0.1\n\nThis text is being chunked, hashed, and Merkle-rooted live in your browser. The resulting storage commitment is the on-chain identity of this data — operators store the bytes, the chain stores the root."
  );
  const [chunkBits, setChunkBits] = useState<number>(7); // 128 B
  const [endowment, setEndowment] = useState<string>("1000000");

  const data = useMemo(() => new TextEncoder().encode(text), [text]);

  const built = useMemo(() => {
    try {
      const chunkSize = 1 << chunkBits;
      const e = BigInt(endowment || "0");
      return buildStorageCommitment(data, e, { chunkSize, replication: 3 });
    } catch {
      return null;
    }
  }, [data, chunkBits, endowment]);

  const [auditIdx, setAuditIdx] = useState<number>(0);
  const [auditResult, setAuditResult] = useState<boolean | null>(null);
  const [tamperAudit, setTamperAudit] = useState<boolean>(false);

  const numChunks = built?.commit.numChunks ?? 0;
  const validIdx = Math.min(auditIdx, Math.max(0, numChunks - 1));

  const onAudit = () => {
    if (!built) return;
    const seed = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4]);
    const challenge = challengeFromSeed(built.commit, seed);
    challenge.chunkIndex = validIdx;
    const resp = respondToChallenge(
      data,
      built.tree,
      built.commit.chunkSize,
      challenge
    );
    let respChunk = resp.chunk;
    if (tamperAudit && respChunk.length > 0) {
      respChunk = new Uint8Array(resp.chunk);
      respChunk[0] ^= 0xff;
    }
    setAuditResult(
      verifyChallengeResponse(built.commit, challenge, {
        chunk: respChunk,
        proof: resp.proof,
      })
    );
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="sky"
        n="06"
        title="Storage Commitment"
        sub={
          "The permanence layer. Data is chunked, each chunk hashed, and the chunks Merkle-rooted into a single 32-byte data root. The root + size + replication factor + a Pedersen-committed endowment forms the on-chain storage commitment. SPoRA-style audits later prove operators still hold the bytes."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
          Payload
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAuditResult(null);
          }}
          className="w-full min-h-[120px] rounded-lg border border-white/[0.08] bg-black/30 text-white/85 text-sm font-mono px-3 py-2 outline-none focus:border-sky-400/50 transition-colors resize-y"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Chunk size
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[6, 7, 8, 10].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setChunkBits(b)}
                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold tracking-[0.15em] uppercase cursor-pointer transition-all ${
                    b === chunkBits
                      ? "bg-sky-500/15 text-sky-200 border-sky-400/40"
                      : "bg-white/[0.02] text-white/50 border-white/[0.06] hover:text-white/80"
                  }`}
                >
                  {1 << b} B
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Endowment (hidden)
            </p>
            <input
              type="text"
              value={endowment}
              onChange={(e) => setEndowment(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-full rounded-lg border border-white/[0.08] bg-black/40 text-white/85 text-sm font-mono px-3 py-2 outline-none focus:border-sky-400/50 transition-colors"
            />
            <p className="text-[10px] text-white/35 mt-1">
              Pedersen-committed; verifiers see the binding, not the amount.
            </p>
          </div>
        </div>
      </div>

      {built && (
        <div className={`${card} p-5 space-y-4`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            On-chain storage commitment
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Size
              </p>
              <p className="text-sm font-mono text-white/85">
                {Number(built.commit.sizeBytes).toLocaleString()} B
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Chunks
              </p>
              <p className="text-sm font-mono text-white/85">
                {built.commit.numChunks}
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                @ {built.commit.chunkSize} B each
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Replication
              </p>
              <p className="text-sm font-mono text-white/85">
                {built.commit.replication}×
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                operators slashable on miss
              </p>
            </div>
          </div>

          <HexRow
            label="data root · Merkle"
            hex={bytesToHex(built.commit.dataRoot)}
            accent="sky"
            hint="32 B BLAKE-of-leaves binding the entire payload"
          />
          <HexRow
            label="endowment · Pedersen commit"
            hex={pointToHex(built.commit.endowment)}
            accent="sky"
            hint="amount hidden behind r·G + v·H"
          />
          <HexRow
            label="storage commitment hash"
            hex={bytesToHex(storageCommitmentHash(built.commit))}
            accent="sky"
            hint="this is what blocks Merkle-ize"
          />
        </div>
      )}

      {built && built.commit.numChunks > 0 && (
        <div className={`${card} p-5 space-y-4`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            SPoRA-style audit
          </p>
          <p className="text-[11px] text-white/55 leading-relaxed">
            The protocol challenges a storage operator to produce chunk{" "}
            <span className="font-mono text-sky-300">i</span> along with a
            Merkle path to the data root. An operator who lost the data fails
            the audit and is slashed.
          </p>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-white/40 tracking-[0.2em] uppercase">
              Audit chunk index
            </span>
            <input
              type="number"
              min={0}
              max={numChunks - 1}
              value={validIdx}
              onChange={(e) => {
                setAuditIdx(Number(e.target.value));
                setAuditResult(null);
              }}
              className="w-20 rounded-lg border border-white/[0.08] bg-black/40 text-white/85 text-sm font-mono px-2 py-1.5 outline-none focus:border-sky-400/50"
            />
            <span className="text-[10px] text-white/30 font-mono">
              of {numChunks}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <PrimaryButton accent="sky" onClick={onAudit}>
              Run audit
            </PrimaryButton>
            <label className="flex items-center gap-2 ml-auto text-[11px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={tamperAudit}
                onChange={(e) => {
                  setTamperAudit(e.target.checked);
                  setAuditResult(null);
                }}
                className="accent-rose-400"
              />
              Operator tampers with one byte before responding
            </label>
          </div>

          {auditResult !== null && (
            <Badge
              ok={auditResult}
              label={
                auditResult ? "audit passed" : "audit failed (slash event)"
              }
              accent="sky"
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 7 · TRANSACTIONS                                              */
/* ================================================================== */

interface TxScenario {
  sender: StealthWallet;
  recipient: StealthWallet;
  fundingOutput: StealthOutput;
  spendPriv: bigint;
  inputValue: bigint;
  inputBlinding: bigint;
  inputCommit: CurvePoint;
  ringP: CurvePoint[];
  ringC: CurvePoint[];
  signerIdx: number;
  recipientOut: StealthOutput;
}

function makeScenario(): TxScenario {
  const sender = stealthGen();
  const recipient = stealthGen();
  const fundingOutput = stealthSendTo(sender);
  const spendPriv = stealthSpendKey(fundingOutput, sender);

  const inputValue = 100n;
  const inputBlinding = randomScalar();
  const inputCommit = pedersenCommit(inputValue, inputBlinding).C;

  const ringP: CurvePoint[] = [];
  const ringC: CurvePoint[] = [];
  for (let i = 0; i < 4; i++) {
    const dummy = stealthGen();
    const out = stealthSendTo(dummy);
    ringP.push(out.oneTimeAddr);
    ringC.push(pedersenCommit(BigInt(50 + i), randomScalar()).C);
  }
  const signerIdx = 2;
  ringP.splice(signerIdx, 0, fundingOutput.oneTimeAddr);
  ringC.splice(signerIdx, 0, inputCommit);

  const recipientOut = stealthSendTo(recipient);

  return {
    sender,
    recipient,
    fundingOutput,
    spendPriv,
    inputValue,
    inputBlinding,
    inputCommit,
    ringP,
    ringC,
    signerIdx,
    recipientOut,
  };
}

function TxPanel() {
  const [scenario, setScenario] = useState<TxScenario>(() => makeScenario());
  const [signed, setSigned] = useState<{
    tx: TransactionWire;
  } | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    errors: string[];
  } | null>(null);
  const [doubleSpendResult, setDoubleSpendResult] = useState<boolean | null>(null);

  const onRegen = () => {
    setScenario(makeScenario());
    setSigned(null);
    setVerifyResult(null);
    setDoubleSpendResult(null);
  };

  const onSign = () => {
    const inputs: InputSpec[] = [
      {
        ring: { P: scenario.ringP, C: scenario.ringC },
        signerIdx: scenario.signerIdx,
        spendPriv: scenario.spendPriv,
        value: scenario.inputValue,
        blinding: scenario.inputBlinding,
      },
    ];
    const result = signTransaction(
      inputs,
      [{ oneTimeAddr: scenario.recipientOut.oneTimeAddr, value: 99n }],
      1n
    );
    setSigned({ tx: result.tx });
    setVerifyResult(null);
    setDoubleSpendResult(null);
  };

  const onVerify = () => {
    if (!signed) return;
    const v = verifyTransaction(signed.tx);
    setVerifyResult({ ok: v.ok, errors: v.errors });
  };

  const onDoubleSpend = () => {
    if (!signed) return;
    // Sign a SECOND tx spending the same input — different output.
    const recipient2 = stealthGen();
    const out2 = stealthSendTo(recipient2);
    const inputs: InputSpec[] = [
      {
        ring: { P: scenario.ringP, C: scenario.ringC },
        signerIdx: scenario.signerIdx,
        spendPriv: scenario.spendPriv,
        value: scenario.inputValue,
        blinding: scenario.inputBlinding,
      },
    ];
    const second = signTransaction(
      inputs,
      [{ oneTimeAddr: out2.oneTimeAddr, value: 99n }],
      1n
    );
    const ki1 = signed.tx.inputs[0].sig.I;
    const ki2 = second.tx.inputs[0].sig.I;
    setDoubleSpendResult(ki1.equals(ki2));
  };

  const tx = signed?.tx;
  const ki = tx?.inputs[0].sig.I;
  const txid = tx ? bytesToHex(txId(tx)) : null;

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="fuchsia"
        n="07"
        title="Confidential Transaction"
        sub={
          "Full RingCT-style ceremony: stealth wallets · ring of decoys · CLSAG ring signature · range proof on every output amount · Pedersen balance check (Σ pseudo − Σ out − fee·H = 0). Spending the same input twice yields the same key image — that's how the chain catches double-spends without learning the spender."
        }
      />

      {/* Scenario */}
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Scenario · 1 input → 1 output, fee 1, ring of 5 (1 real + 4 decoys)
          </p>
          <PrimaryButton accent="fuchsia" onClick={onRegen}>
            Reroll wallets &amp; ring
          </PrimaryButton>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HexRow
            label="sender · funding output P"
            hex={pointToHex(scenario.fundingOutput.oneTimeAddr)}
            accent="fuchsia"
            hint="stealth address of the input being spent"
          />
          <HexRow
            label="recipient · one-time P"
            hex={pointToHex(scenario.recipientOut.oneTimeAddr)}
            accent="fuchsia"
            hint="fresh, unlinkable to recipient's wallet"
          />
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-fuchsia-300 font-bold mb-2">
            Anonymity ring (signer hidden among decoys)
          </p>
          <div className="space-y-1.5">
            {scenario.ringP.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-2 font-mono text-[11px]"
              >
                <span
                  className={`shrink-0 w-7 text-[10px] tracking-[0.15em] uppercase font-bold ${
                    i === scenario.signerIdx
                      ? "text-fuchsia-300"
                      : "text-white/30"
                  }`}
                >
                  P{i}
                </span>
                <span
                  className={`truncate ${
                    i === scenario.signerIdx ? "text-fuchsia-200" : "text-white/45"
                  }`}
                >
                  {shorten(pointToHex(p), 14, 8)}
                </span>
                {i === scenario.signerIdx && (
                  <span className="text-[9px] text-fuchsia-300 tracking-[0.2em] uppercase font-bold">
                    real
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/35 mt-2">
            (You can see which entry is real because this is a demo; on-chain
            the position is uniformly random and indistinguishable.)
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent="fuchsia" onClick={onSign}>
            Sign transaction
          </PrimaryButton>
          {signed && (
            <>
              <GhostButton onClick={onVerify}>Verify</GhostButton>
              <GhostButton onClick={onDoubleSpend}>
                Attempt double-spend
              </GhostButton>
            </>
          )}
        </div>
      </div>

      {tx && ki && txid && (
        <div className={`${card} p-5 space-y-4`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Signed transaction
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Inputs
              </p>
              <p className="text-sm font-mono text-white/85">{tx.inputs.length}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Outputs
              </p>
              <p className="text-sm font-mono text-white/85">{tx.outputs.length}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
              <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                Fee
              </p>
              <p className="text-sm font-mono text-white/85">
                {tx.fee.toString()}
              </p>
            </div>
          </div>

          <HexRow label="tx id" hex={txid} accent="fuchsia" hint="blocks Merkle-ize this" />
          <HexRow
            label="key image I = x · H_p(P_π)"
            hex={pointToHex(ki)}
            accent="fuchsia"
            hint="any future tx with the same I = double-spend"
          />
          <HexRow
            label="output amount commitment C_out"
            hex={pointToHex(tx.outputs[0].amount)}
            accent="fuchsia"
            hint="value hidden; range proof attached"
          />
          <HexRow
            label="pseudo commitment C_pseudo"
            hex={pointToHex(tx.inputs[0].cPseudo)}
            accent="fuchsia"
            hint="links input commitment to balance proof"
          />

          {verifyResult && (
            <div className="space-y-2">
              <Badge
                ok={verifyResult.ok}
                label={verifyResult.ok ? "tx valid" : "tx invalid"}
                accent="fuchsia"
              />
              {verifyResult.errors.length > 0 && (
                <ul className="text-[11px] text-rose-300/80 list-disc list-inside">
                  {verifyResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {doubleSpendResult !== null && (
            <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3 space-y-2">
              <Badge
                ok={doubleSpendResult}
                label={
                  doubleSpendResult
                    ? "key images match — chain rejects 2nd spend"
                    : "key images differ — bug"
                }
                accent="fuchsia"
              />
              <p className="text-[11px] text-white/55 leading-relaxed">
                A second transaction spending the same input — even with a
                different output, different ring decoys, different recipient —
                produces the <span className="font-mono text-fuchsia-300">same I</span>.
                Validators reject the second one without learning who you are.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 8 · BLOCKS & STATE                                            */
/* ================================================================== */

interface ChainSnapshot {
  state: ChainState;
  lastBlock: Block | null;
}

function BlockPanel() {
  const [snapshot, setSnapshot] = useState<ChainSnapshot>(() => {
    const cfg = { timestamp: 0, initialOutputs: [], initialStorage: [] };
    const genesis = buildGenesis(cfg);
    const state = applyGenesis(genesis, cfg);
    return { state, lastBlock: genesis };
  });
  const [error, setError] = useState<string | null>(null);
  const [doubleSpendError, setDoubleSpendError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<TransactionWire | null>(null);

  const onMintBlock = useCallback(() => {
    setError(null);
    setDoubleSpendError(null);

    // Build a fresh "funded" wallet + tx that spends to a recipient.
    const fundOwner = stealthGen();
    const fundOut = stealthSendTo(fundOwner);
    const x = stealthSpendKey(fundOut, fundOwner);
    const v = 100n;
    const r = randomScalar();
    const c = pedersenCommit(v, r).C;
    const ring = { P: [fundOut.oneTimeAddr], C: [c] };
    const recipient = stealthGen();
    const recipientOut = stealthSendTo(recipient);

    const signed = signTransaction(
      [
        {
          ring,
          signerIdx: 0,
          spendPriv: x,
          value: v,
          blinding: r,
        },
      ],
      [{ oneTimeAddr: recipientOut.oneTimeAddr, value: 99n }],
      1n
    );

    const block = buildBlock({
      state: snapshot.state,
      txs: [signed.tx],
      timestamp: Math.floor(Date.now() / 1000),
    });
    const result = applyBlock(snapshot.state, block);
    if (!result.ok) {
      setError(result.errors.join("; "));
      return;
    }
    setSnapshot({ state: result.state, lastBlock: block });
    setLastTx(signed.tx);
  }, [snapshot.state]);

  const onAttemptReplay = useCallback(() => {
    setDoubleSpendError(null);
    if (!lastTx) {
      setDoubleSpendError("Mint at least one block first.");
      return;
    }
    const block = buildBlock({
      state: snapshot.state,
      txs: [lastTx],
      timestamp: Math.floor(Date.now() / 1000),
    });
    const result = applyBlock(snapshot.state, block);
    setDoubleSpendError(
      result.ok ? "(unexpected: replay accepted)" : result.errors.join("; ")
    );
  }, [lastTx, snapshot.state]);

  const onReset = () => {
    const cfg = { timestamp: 0, initialOutputs: [], initialStorage: [] };
    const genesis = buildGenesis(cfg);
    const state = applyGenesis(genesis, cfg);
    setSnapshot({ state, lastBlock: genesis });
    setError(null);
    setDoubleSpendError(null);
    setLastTx(null);
  };

  const tip = snapshot.lastBlock;
  const tipId = tip ? bytesToHex(blockId(tip.header)) : "";

  return (
    <div className="space-y-5">
      <SectionTitle
        accent="lime"
        n="08"
        title="Blocks &amp; Chain State"
        sub={
          "Pure state transition: applyBlock(state, block) → state' or error. Validates every transaction, every range proof, every CLSAG, every balance, plus chain-wide double-spend across all key images ever spent. Re-execute it on any node and you get the same answer — that's consensus."
        }
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
            <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
              Tip height
            </p>
            <p className="text-2xl font-mono tabular-nums text-lime-300 font-bold">
              {snapshot.state.height}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
            <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
              UTXO set
            </p>
            <p className="text-2xl font-mono tabular-nums text-lime-300 font-bold">
              {snapshot.state.utxo.size}
            </p>
            <p className="text-[10px] text-white/35 mt-0.5">unspent outputs</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
            <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
              Spent key images
            </p>
            <p className="text-2xl font-mono tabular-nums text-lime-300 font-bold">
              {snapshot.state.spentKeyImages.size}
            </p>
            <p className="text-[10px] text-white/35 mt-0.5">double-spend filter</p>
          </div>
        </div>

        {tip && (
          <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3 space-y-2">
            <p className="text-[10px] tracking-[0.2em] uppercase text-lime-300 font-bold">
              Tip block
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-white/40">id  </span>
                <span className="text-white/80">{shorten(tipId, 14, 10)}</span>
              </div>
              <div>
                <span className="text-white/40">height  </span>
                <span className="text-white/80">{tip.header.height}</span>
              </div>
              <div>
                <span className="text-white/40">prev  </span>
                <span className="text-white/80">
                  {shorten(bytesToHex(tip.header.prevHash), 14, 10)}
                </span>
              </div>
              <div>
                <span className="text-white/40">txs  </span>
                <span className="text-white/80">{tip.txs.length}</span>
              </div>
              <div>
                <span className="text-white/40">tx-root  </span>
                <span className="text-white/80">
                  {shorten(bytesToHex(tip.header.txRoot), 14, 10)}
                </span>
              </div>
              <div>
                <span className="text-white/40">storage-root  </span>
                <span className="text-white/80">
                  {shorten(bytesToHex(tip.header.storageRoot), 14, 10)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <PrimaryButton accent="lime" onClick={onMintBlock}>
            Build &amp; apply block
          </PrimaryButton>
          {lastTx && (
            <GhostButton onClick={onAttemptReplay}>
              Replay last tx (double-spend)
            </GhostButton>
          )}
          <GhostButton onClick={onReset}>Reset to genesis</GhostButton>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3">
            <p className="text-[10px] tracking-[0.2em] uppercase text-rose-300 font-bold mb-1">
              Block rejected
            </p>
            <p className="text-[11px] text-rose-200/80 font-mono break-all">{error}</p>
          </div>
        )}

        {doubleSpendError && (
          <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 p-3">
            <p className="text-[10px] tracking-[0.2em] uppercase text-fuchsia-300 font-bold mb-1">
              Double-spend filter caught it
            </p>
            <p className="text-[11px] text-fuchsia-200/80 font-mono break-all">
              {doubleSpendError}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL 9 · BULLETPROOFS                                              */
/* ================================================================== */

function BulletproofsPanel() {
  const ACC: Accent = "teal";
  const [N, setN] = useState<number>(8);
  const [valueStr, setValueStr] = useState<string>("42");
  const [busy, setBusy] = useState<boolean>(false);
  const [proof, setProof] = useState<BulletproofRange | null>(null);
  const [proveMs, setProveMs] = useState<number>(0);
  const [verifyMs, setVerifyMs] = useState<number>(0);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [tampered, setTampered] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const valueValid = useMemo(() => {
    try {
      const v = BigInt(valueStr);
      return v >= 0n && v < 1n << BigInt(N);
    } catch {
      return false;
    }
  }, [valueStr, N]);

  const onProve = async () => {
    setError(null);
    if (!valueValid) {
      setError(`value must be in [0, 2^${N}) = [0, ${(1n << BigInt(N)).toString()})`);
      return;
    }
    setBusy(true);
    setProof(null);
    setVerified(null);
    setTampered(false);

    await new Promise((r) => setTimeout(r, 0));
    try {
      const t0 = performance.now();
      const v = BigInt(valueStr);
      const blinding = randomScalar();
      const { proof: p } = bpProve(v, blinding, N);
      const t1 = performance.now();
      setProveMs(t1 - t0);
      setProof(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = () => {
    if (!proof) return;
    const t0 = performance.now();
    const target = tampered
      ? { ...proof, tHat: (proof.tHat + 1n) % L }
      : proof;
    const r = bpVerify(target);
    const t1 = performance.now();
    setVerifyMs(t1 - t0);
    setVerified(r);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        accent={ACC}
        n="09"
        title="Bulletproofs · O(log N) Range Proofs"
        sub="A logarithmic-size successor to the Borromean range proofs in tab 5. At N=64 bits the proof shrinks from ~8.2 KB to 672 bytes — same security, no trusted setup. The exact construction every modern privacy chain ships."
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              N (bits)
            </label>
            <select
              value={N}
              onChange={(e) => { setN(Number(e.target.value)); setProof(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm"
            >
              {[4, 8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              v ∈ [0, 2^{N})
            </label>
            <input
              value={valueStr}
              onChange={(e) => { setValueStr(e.target.value); setProof(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
            />
            {!valueValid && (
              <p className="text-[10px] text-rose-300 mt-1">out of range</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Proof size</p>
            <p className={`text-sm font-mono ${ACCENT[ACC].text}`}>{bpProofSize(N)} B</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Borromean equiv.</p>
            <p className="text-sm font-mono text-white/40">~{32 + 32 * 3 * N}B</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Prove time</p>
            <p className="text-sm font-mono text-white/70">{proveMs > 0 ? `${proveMs.toFixed(0)} ms` : "—"}</p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Verify time</p>
            <p className="text-sm font-mono text-white/70">{verifyMs > 0 ? `${verifyMs.toFixed(0)} ms` : "—"}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent={ACC} onClick={onProve}>
            {busy ? "proving…" : "Generate Bulletproof"}
          </PrimaryButton>
          <PrimaryButton accent={ACC} onClick={onVerify}>
            Verify
          </PrimaryButton>
          <GhostButton onClick={() => setTampered(!tampered)}>
            {tampered ? "✓ tampered" : "Tamper"}
          </GhostButton>
        </div>

        {error && <p className="text-[12px] text-rose-300">{error}</p>}
      </div>

      {proof && (
        <div className={`${card} p-5 space-y-3`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">Proof bytes</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <HexRow label="V · commitment" hex={pointToHex(proof.V)} accent={ACC} />
            <HexRow label="A" hex={pointToHex(proof.A)} accent={ACC} />
            <HexRow label="S" hex={pointToHex(proof.S)} accent={ACC} />
            <HexRow label="T₁" hex={pointToHex(proof.T1)} accent={ACC} />
            <HexRow label="T₂" hex={pointToHex(proof.T2)} accent={ACC} />
            <HexRow label="t̂" hex={scalarToHex(proof.tHat)} accent={ACC} />
            <HexRow label="τ_x" hex={scalarToHex(proof.taux)} accent={ACC} />
            <HexRow label="μ" hex={scalarToHex(proof.mu)} accent={ACC} />
          </div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mt-4">
            IPA · {proof.ipa.Lvec.length} rounds · log₂({N}) = {Math.log2(N)}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {proof.ipa.Lvec.map((Lp, i) => (
              <HexRow key={`L${i}`} label={`L_${i}`} hex={pointToHex(Lp)} accent={ACC} />
            ))}
            {proof.ipa.Rvec.map((Rp, i) => (
              <HexRow key={`R${i}`} label={`R_${i}`} hex={pointToHex(Rp)} accent={ACC} />
            ))}
            <HexRow label="a · final" hex={scalarToHex(proof.ipa.a)} accent={ACC} />
            <HexRow label="b · final" hex={scalarToHex(proof.ipa.b)} accent={ACC} />
          </div>
          {verified !== null && (
            <div className="pt-2">
              <Badge
                ok={verified}
                label={tampered ? "rejects tampered proof" : "proof verifies"}
                accent={ACC}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 10 · VRF                                                      */
/* ================================================================== */

function VrfPanel() {
  const ACC: Accent = "indigo";
  const [kp, setKp] = useState<VrfKeypair>(() => vrfKeygen());
  const [seed, setSeed] = useState<string>("slot:42");
  const [proof, setProof] = useState<VrfProof | null>(null);
  const [output, setOutput] = useState<Uint8Array | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [tampered, setTampered] = useState<boolean>(false);

  const onRegen = () => {
    setKp(vrfKeygen());
    setProof(null);
    setOutput(null);
    setVerified(null);
    setTampered(false);
  };

  const onProve = () => {
    const seedBytes = new TextEncoder().encode(seed);
    const { proof: p, output: o } = vrfProve(kp, seedBytes);
    setProof(p);
    setOutput(o);
    setVerified(null);
  };

  const onVerify = () => {
    if (!proof) return;
    const target = tampered
      ? { ...proof, s: (proof.s + 1n) % L }
      : proof;
    const r = vrfVerify(kp.pk, new TextEncoder().encode(seed), target);
    setVerified(r.ok);
  };

  // Distribution demo: 1024 different seeds bucketed into 16 boxes.
  const distribution = useMemo(() => {
    const buckets = new Array(16).fill(0);
    for (let i = 0; i < 1024; i++) {
      const m = new TextEncoder().encode(`bucket-seed-${i}`);
      const r = vrfProve(kp, m);
      buckets[vrfOutputAsIndex(r.output, 16)]++;
    }
    return buckets;
  }, [kp]);

  return (
    <div className="space-y-5">
      <SectionTitle
        accent={ACC}
        n="10"
        title="Verifiable Random Function (ECVRF)"
        sub="Deterministic, unpredictable, publicly verifiable randomness. The cryptographic basis for slot leader election, ring decoy selection, and storage audit challenges. RFC-9381-style over ed25519."
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Validator keypair
          </p>
          <PrimaryButton accent={ACC} onClick={onRegen}>
            Regenerate
          </PrimaryButton>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HexRow label="sk · seed" hex={bytesToHex(kp.sk)} accent={ACC} />
          <HexRow label="pk = x·G" hex={pointToHex(kp.pk)} accent={ACC} />
        </div>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
          Slot input (e.g. concat of prevHash + slot number)
        </p>
        <input
          value={seed}
          onChange={(e) => { setSeed(e.target.value); setProof(null); setVerified(null); }}
          className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
        />
        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent={ACC} onClick={onProve}>Prove (deterministic)</PrimaryButton>
          <PrimaryButton accent={ACC} onClick={onVerify}>Verify</PrimaryButton>
          <GhostButton onClick={() => setTampered(!tampered)}>
            {tampered ? "✓ tampered" : "Tamper"}
          </GhostButton>
        </div>

        {proof && output && (
          <div className="space-y-3 pt-2">
            <HexRow label="β · VRF output" hex={bytesToHex(output)} accent={ACC} hint="32 B uniform" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <HexRow label="Γ · proof point" hex={pointToHex(proof.Gamma)} accent={ACC} />
              <HexRow label="c · challenge" hex={scalarToHex(proof.c)} accent={ACC} />
              <HexRow label="s · response" hex={scalarToHex(proof.s)} accent={ACC} />
            </div>
            {verified !== null && (
              <Badge ok={verified} label={tampered ? "rejects tampered" : "VRF verifies"} accent={ACC} />
            )}
          </div>
        )}
      </div>

      <div className={`${card} p-5 space-y-3`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
          Distribution check · 1024 distinct seeds → 16 buckets
        </p>
        <div className="grid grid-cols-16 gap-1" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
          {distribution.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div
                className={`w-full ${ACCENT[ACC].bg} ${ACCENT[ACC].ring} border rounded`}
                style={{ height: `${Math.max(4, c * 0.6)}px` }}
                title={`${c}`}
              />
              <span className="text-[8px] text-white/30 font-mono">{c}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-white/40">
          Expected ~64 per bucket (ideal uniform). Any honest validator's VRF passes this test.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PANEL 11 · BLS                                                      */
/* ================================================================== */

function BlsPanel() {
  const ACC: Accent = "yellow";
  const [N, setN] = useState<number>(8);
  const [keypairs, setKeypairs] = useState<BlsKeypair[]>(() =>
    Array.from({ length: 8 }, () => blsKeygen())
  );
  const [msg, setMsg] = useState<string>("BLOCK_HEADER · MoneyFund #1");
  const [voted, setVoted] = useState<boolean[]>(() => new Array(8).fill(true));
  const [agg, setAgg] = useState<CommitteeAggregate | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const ensureSize = (n: number) => {
    setKeypairs((kps) => {
      if (kps.length === n) return kps;
      if (kps.length < n) {
        return [...kps, ...Array.from({ length: n - kps.length }, () => blsKeygen())];
      }
      return kps.slice(0, n);
    });
    setVoted(() => new Array(n).fill(true));
    setAgg(null);
    setVerified(null);
  };

  const onAggregate = () => {
    const msgBytes = new TextEncoder().encode(msg);
    const votes = keypairs
      .map((kp, i) => ({ index: i, kp }))
      .filter(({ index }) => voted[index])
      .map(({ index, kp }) => ({ index, sig: blsSign(msgBytes, kp.sk) }));
    if (votes.length === 0) return;
    const a = aggregateCommitteeVotes(msgBytes, votes, keypairs.length);
    setAgg(a);
    setVerified(null);
  };

  const onVerify = () => {
    if (!agg) return;
    setVerified(verifyCommitteeAggregate(agg, keypairs.map((k) => k.pk)));
  };

  const sigBytes = useMemo(() => {
    if (!agg) return null;
    return agg.aggSig.toBytes();
  }, [agg]);

  return (
    <div className="space-y-5">
      <SectionTitle
        accent={ACC}
        n="11"
        title="BLS12-381 · Aggregate Signatures"
        sub="N validators sign the same block header; their signatures compress into a single 96-byte aggregate. Verification is one pairing check regardless of N. The math that makes 100k-validator finality scale."
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Committee size
            </label>
            <select
              value={N}
              onChange={(e) => { const n = Number(e.target.value); setN(n); ensureSize(n); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm"
            >
              {[4, 8, 16, 32].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Block header msg
            </label>
            <input
              value={msg}
              onChange={(e) => { setMsg(e.target.value); setAgg(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
            Validator votes (toggle to abstain)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {voted.map((on, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setVoted((v) => v.map((x, j) => (j === i ? !x : x)));
                  setAgg(null);
                  setVerified(null);
                }}
                className={`w-9 h-9 rounded text-[10px] font-mono font-bold border transition-all ${
                  on
                    ? `${ACCENT[ACC].bg} ${ACCENT[ACC].text} ${ACCENT[ACC].ring}`
                    : "bg-white/[0.02] text-white/30 border-white/[0.06]"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/40 mt-2">
            {voted.filter(Boolean).length}/{voted.length} voted
            {" · "}quorum 2/3 = {Math.ceil((voted.length * 2) / 3)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent={ACC} onClick={onAggregate}>Aggregate signatures</PrimaryButton>
          <PrimaryButton accent={ACC} onClick={onVerify}>Verify aggregate</PrimaryButton>
          <GhostButton onClick={() => { setKeypairs(Array.from({ length: N }, () => blsKeygen())); setAgg(null); setVerified(null); }}>
            Regenerate validators
          </GhostButton>
        </div>
      </div>

      {agg && sigBytes && (
        <div className={`${card} p-5 space-y-3`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Aggregate output · {sigBytes.length} bytes total (vs {voted.filter(Boolean).length * 96}B if not aggregated)
          </p>
          <HexRow label="bitmap · who voted" hex={bytesToHex(agg.bitmap)} accent={ACC} />
          <HexRow label="aggSig · single 96B point" hex={bytesToHex(sigBytes)} accent={ACC} />
          {verified !== null && (
            <Badge
              ok={verified}
              label="aggregate sig verifies against bitmap-selected pks"
              accent={ACC}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 12 · KZG                                                      */
/* ================================================================== */

function KzgPanel() {
  const ACC: Accent = "orange";
  const SETUP_DEG = 16;
  const [srs] = useState<KzgSrs>(() => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) seed[i] = (i * 31 + 7) & 0xff;
    return kzgInsecureSetup(SETUP_DEG, seed);
  });
  const [polyStr, setPolyStr] = useState<string>("1, 2, 3, 4");
  const [xStr, setXStr] = useState<string>("5");
  const [busy, setBusy] = useState<boolean>(false);
  const [commitment, setCommitment] = useState<Uint8Array | null>(null);
  const [proof, setProof] = useState<Uint8Array | null>(null);
  const [yValue, setYValue] = useState<bigint | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poly = useMemo(() => {
    try {
      return polyStr.split(",").map((s) => BigInt(s.trim()));
    } catch { return null; }
  }, [polyStr]);

  const onProve = async () => {
    setError(null);
    if (!poly) { setError("invalid polynomial"); return; }
    if (poly.length > SETUP_DEG + 1) { setError(`degree exceeds SRS max (${SETUP_DEG})`); return; }
    let x: bigint;
    try { x = BigInt(xStr); } catch { setError("invalid x"); return; }
    setBusy(true);
    setCommitment(null);
    setProof(null);
    setVerified(null);

    await new Promise((r) => setTimeout(r, 0));
    try {
      const C = kzgCommit(srs, poly);
      const op = kzgOpen(srs, poly, x);
      setCommitment(C.toBytes());
      setProof(op.proof.toBytes());
      setYValue(op.y);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const onVerify = async () => {
    if (!poly || commitment === null || proof === null || yValue === null) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const C = (await import("@noble/curves/bls12-381.js")).bls12_381.G1.Point.fromBytes(commitment);
      const proofPt = (await import("@noble/curves/bls12-381.js")).bls12_381.G1.Point.fromBytes(proof);
      const x = BigInt(xStr);
      const ok = kzgVerify(srs, C, { x, y: yValue, proof: proofPt });
      setVerified(ok);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const expected = poly && (() => {
    try { return polyEval(poly, BigInt(xStr)); } catch { return null; }
  })();

  return (
    <div className="space-y-5">
      <SectionTitle
        accent={ACC}
        n="12"
        title="KZG Polynomial Commitments"
        sub={`Commit to a polynomial of degree ≤ ${SETUP_DEG} with one G1 point. Open at any x with one G1 proof. Verifier checks p(x) = y in constant time via a pairing equation. The cryptographic spine of Plonk, KZG-DA, and most modern zk-SNARKs.`}
      />

      <div className={`${card} p-5 space-y-3`}>
        <p className="text-[10px] tracking-[0.2em] uppercase text-amber-300 font-bold">
          ⚠ Trusted-setup notice
        </p>
        <p className="text-[12px] text-white/55 leading-relaxed">
          The SRS used here is locally generated for demonstration. In production the network would
          consume a multi-party powers-of-tau ceremony output. The math is identical; only the SRS source differs.
        </p>
      </div>

      <div className={`${card} p-5 space-y-4`}>
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
            Polynomial coefficients (ascending: c₀, c₁, c₂, …)
          </label>
          <input
            value={polyStr}
            onChange={(e) => { setPolyStr(e.target.value); setCommitment(null); setVerified(null); }}
            className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Evaluation point x
            </label>
            <input
              value={xStr}
              onChange={(e) => { setXStr(e.target.value); setCommitment(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
            />
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Expected p(x)</p>
            <p className="text-sm font-mono text-white/70 truncate">{expected !== null ? expected.toString() : "—"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent={ACC} onClick={onProve}>{busy ? "computing…" : "Commit + Open"}</PrimaryButton>
          <PrimaryButton accent={ACC} onClick={onVerify}>Verify pairing</PrimaryButton>
        </div>
        {error && <p className="text-[12px] text-rose-300">{error}</p>}
      </div>

      {commitment && proof && yValue !== null && (
        <div className={`${card} p-5 space-y-3`}>
          <HexRow label="C · commitment (48B G1)" hex={bytesToHex(commitment)} accent={ACC} />
          <HexRow label="π · opening proof (48B G1)" hex={bytesToHex(proof)} accent={ACC} />
          <HexRow label="y = p(x)" hex={"0x" + yValue.toString(16)} accent={ACC} />
          {verified !== null && (
            <Badge
              ok={verified}
              label="e(C − y·G₁, G₂) = e(π, τ·G₂ − x·G₂)"
              accent={ACC}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL 13 · CONSENSUS                                                */
/* ================================================================== */

function ConsensusPanel() {
  const ACC: Accent = "red";
  const NUM_VAL = 8;
  const [secrets] = useState<ValidatorSecrets[]>(() =>
    Array.from({ length: NUM_VAL }, (_, i) => ({
      index: i,
      vrf: vrfKeygen(),
      bls: blsKeygen(),
    }))
  );
  const stakes = useMemo<bigint[]>(() => [200n, 100n, 100n, 80n, 80n, 60n, 60n, 50n], []);
  const validators = useMemo<Validator[]>(
    () => secrets.map((s, i) => ({ index: i, vrfPk: s.vrf.pk, blsPk: s.bls.pk, stake: stakes[i] })),
    [secrets, stakes]
  );
  const totalStake = useMemo(() => stakes.reduce((a, b) => a + b, 0n), [stakes]);

  const [slot, setSlot] = useState<number>(0);
  const [F, setF] = useState<number>(2.0);
  const [eligible, setEligible] = useState<{ idx: number; beta: Uint8Array }[]>([]);
  const [winner, setWinner] = useState<number | null>(null);
  const [votes, setVotes] = useState<number>(0);
  const [finProof, setFinProof] = useState<FinalityProof | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const ctx: SlotContext = useMemo(() => ({
    height: 1,
    slot,
    prevHash: new Uint8Array(32).fill(0xa1),
  }), [slot]);

  const headerHash = useMemo(() => {
    const h = new Uint8Array(32);
    h[0] = slot & 0xff;
    h[1] = (slot >> 8) & 0xff;
    return h;
  }, [slot]);

  const onRunSlot = () => {
    const elig: { idx: number; beta: Uint8Array }[] = [];
    let win = null;
    for (let i = 0; i < NUM_VAL; i++) {
      const cand = tryProduceSlot(ctx, secrets[i], validators[i], totalStake, F, headerHash);
      if (cand) elig.push({ idx: i, beta: cand.beta });
    }
    setEligible(elig);

    const allCands = elig
      .map(({ idx }) => tryProduceSlot(ctx, secrets[idx], validators[idx], totalStake, F, headerHash))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const w = pickWinner(allCands);
    win = w?.validatorIndex ?? null;
    setWinner(win);
    setFinProof(null);
    setVerified(null);

    if (w) {
      const wValidator = validators[w.validatorIndex];
      const committeeVotes = secrets.map((sec) => {
        try {
          return castVote(headerHash, sec, ctx, w, wValidator, totalStake, F);
        } catch { return null; }
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      setVotes(committeeVotes.length);
      const fin = finalize(headerHash, committeeVotes, NUM_VAL);
      let signedStake = 0n;
      for (let i = 0; i < NUM_VAL; i++) {
        if ((fin.bitmap[i >> 3] & (1 << (i & 7))) !== 0) signedStake += stakes[i];
      }
      setFinProof({ producer: w, finality: fin, signingStake: signedStake });
    }
  };

  const onVerifyFinality = () => {
    if (!finProof) return;
    const r = verifyFinalityProof(ctx, finProof, validators, F, 6667, headerHash);
    setVerified(r.ok);
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        accent={ACC}
        n="13"
        title="Slot-Based PoS · VRF leader + BLS finality"
        sub="The actual consensus layer. Each validator's VRF output decides eligibility (stake-weighted lottery). The smallest β wins. Committee BLS-signs; a stake-weighted ≥ 2/3 quorum gives the block instant finality. Equivocation is BLS-provable and slashable."
      />

      <div className={`${card} p-5 space-y-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Slot number
            </label>
            <input
              type="number"
              value={slot}
              onChange={(e) => { setSlot(Number(e.target.value || 0)); setEligible([]); setWinner(null); setFinProof(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
              Expected proposers per slot
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="8"
              value={F}
              onChange={(e) => { setF(Number(e.target.value || 1)); setEligible([]); setWinner(null); setFinProof(null); setVerified(null); }}
              className="w-full bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold mb-2">
            Validator stakes
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {validators.map((v) => (
              <div
                key={v.index}
                className={`rounded text-[10px] font-mono text-center px-2 py-1.5 border ${
                  winner === v.index
                    ? `${ACCENT[ACC].bg} ${ACCENT[ACC].text} ${ACCENT[ACC].ring}`
                    : eligible.find((e) => e.idx === v.index)
                      ? "bg-white/[0.06] text-white/80 border-white/[0.15]"
                      : "bg-white/[0.02] text-white/40 border-white/[0.05]"
                }`}
              >
                <div className="font-bold">v{v.index}</div>
                <div className="text-[9px]">{v.stake.toString()}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/40 mt-2">
            Total stake {totalStake.toString()} · highlighted = eligible · solid = winner
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PrimaryButton accent={ACC} onClick={onRunSlot}>Run slot</PrimaryButton>
          <PrimaryButton accent={ACC} onClick={onVerifyFinality}>Verify finality</PrimaryButton>
        </div>
      </div>

      {eligible.length > 0 && (
        <div className={`${card} p-5 space-y-3`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Eligible candidates (VRF β below stake-weighted threshold)
          </p>
          <div className="space-y-1.5">
            {eligible.map((e) => (
              <div
                key={e.idx}
                className={`flex items-center justify-between rounded border px-3 py-1.5 ${
                  e.idx === winner ? `${ACCENT[ACC].bg} ${ACCENT[ACC].ring}` : "border-white/[0.06] bg-black/20"
                }`}
              >
                <span className="font-mono text-[11px] text-white/70">v{e.idx}</span>
                <span className="font-mono text-[10px] text-white/50 truncate">{bytesToHex(e.beta).slice(0, 24)}…</span>
                {e.idx === winner && (
                  <span className={`text-[9px] tracking-[0.15em] uppercase font-bold ${ACCENT[ACC].text}`}>
                    winner
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {finProof && (
        <div className={`${card} p-5 space-y-3`}>
          <p className="text-[10px] tracking-[0.2em] uppercase text-white/40 font-bold">
            Finality bundle
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Producer</p>
              <p className="text-sm font-mono text-white/80">v{finProof.producer.validatorIndex}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
              <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 font-bold">Voters</p>
              <p className="text-sm font-mono text-white/80">{votes}/{NUM_VAL} · stake {finProof.signingStake.toString()}/{totalStake.toString()}</p>
            </div>
          </div>
          <HexRow label="aggSig · 96B BLS aggregate" hex={bytesToHex(finProof.finality.aggSig.toBytes())} accent={ACC} />
          <HexRow label="bitmap" hex={bytesToHex(finProof.finality.bitmap)} accent={ACC} />
          {verified !== null && (
            <Badge
              ok={verified}
              label={verified ? "block FINAL · ≥ 2/3 stake-weighted quorum" : "below quorum"}
              accent={ACC}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  PANEL · DOCS                                                        */
/*                                                                       */
/*  High-level overview of the MoneyFund architecture, what's already   */
/*  built, and what's planned. Includes a one-click download of the     */
/*  full design doc as a Markdown file (rendered by any GitHub-style    */
/*  viewer, easy to fork into a real whitepaper).                       */
/* ================================================================== */

type DocLayer = {
  name: string;
  desc: string;
  items: string[];
  accent: Accent;
};

const IMPLEMENTED_LAYERS: DocLayer[] = [
  {
    name: "Application",
    desc: "Wallets, CLI, RPC clients — the user-facing surface.",
    accent: "cyan",
    items: [
      "Wallet (stealth keys, chain scanner, balance, persistence)",
      "Wallet.buildSpend — real CLSAG+BP txs with gamma-distributed decoys",
      "Wallet.buildUpload — anchor data with the consensus-enforced endowment fee",
      "JSON-RPC server + typed client (info, getBlock, getTx, submitTx, getDecoyPool)",
      "CLI binaries: mfbn-node (daemon), mfbn-wallet (client)",
    ],
  },
  {
    name: "Node + Mempool",
    desc: "Slot driver, in-process gossip, bounded mempool, SQLite-backed chain store.",
    accent: "violet",
    items: [
      "ConsensusNode (slot-begin → propose → vote → seal)",
      "InProcessGossipBus (synchronous in-memory message bus for multi-node sim)",
      "Mempool (bounded validated tx pool with replay rejection)",
      "ChainStore (SQLite-persisted block log; state rebuilds deterministically on restore)",
    ],
  },
  {
    name: "Consensus",
    desc: "Slot-based proof-of-stake with VRF leader election + BLS aggregate finality.",
    accent: "red",
    items: [
      "ECVRF leader election (stake-weighted lottery per slot)",
      "BLS12-381 aggregate signatures (one 96-byte sig commits ≥ ⅔ stake)",
      "Slashable equivocation evidence (validators caught double-signing have stake → 0)",
      "Deterministic FinalityProof bundle in every block header",
    ],
  },
  {
    name: "Privacy",
    desc: "Monero-parity confidentiality, with a forward upgrade path to log-size proofs.",
    accent: "emerald",
    items: [
      "RingCT-style transactions (Σ pseudo_in − Σ C_out − fee·H = 0)",
      "CLSAG ring signatures with linkable key images (double-spend protection)",
      "Stealth addresses (Monero CryptoNote, indexed for multi-output txs)",
      "Encrypted output amounts (RingCT mask: stealth shared-secret-derived blob)",
      "Bulletproofs range proofs (O(log N), 64-bit range)",
      "Gamma-distributed decoy selection (age-weighted, anti-clustering)",
    ],
  },
  {
    name: "UTXO Accumulator",
    desc: "Zcash-style incremental Merkle tree — the substrate for log-size ring sigs.",
    accent: "indigo",
    items: [
      "Fixed depth = 32 (≈ 4.29 × 10⁹ output capacity)",
      "Append-only with O(D) inserts and O(D) membership proofs",
      "Domain-separated leaf hash binds (oneTimeAddr, amountCommit, anchorHeight)",
      "Header field utxoRoot is consensus-checked on every block",
      "Light clients verify membership with a 32-byte root + 32 × 32-byte siblings",
    ],
  },
  {
    name: "Permanence (SPoRA)",
    desc: "Content-addressed Merkle storage with random-access chunk audits.",
    accent: "sky",
    items: [
      "Storage commitments (dataRoot, sizeBytes, chunkSize, numChunks, replication, endowment)",
      "Per-slot StorageChallenge derived from (prevHash, slot, commitHash)",
      "StorageProof = (chunkBytes, Merkle path) — verified against the on-chain dataRoot",
      "On-chain registry tracks lastProvenAt for every anchored commitment",
      "Upload-tx enforcement: tx.fee × 90% ≥ requiredEndowment(size, replication)",
    ],
  },
  {
    name: "Tokenomics",
    desc: "Two-sided fee market: privacy pays for permanence; emission backstops both.",
    accent: "amber",
    items: [
      "Emission schedule: 50 → 25 → 12.5 … → tail ≈ 0.195 MFN/block (8 halvings)",
      "Endowment math: E₀ = C₀ · (1+i) / (r−i), with 30 ppb fixed-point precision",
      "Coinbase tx (synthetic, deterministic ephemeral key, single output)",
      "Fee split: 90 % → permanence treasury, 10 % → producer tip (basis-point param)",
      "Storage rewards drain treasury first; emission mints the shortfall as backstop",
      "treasury balance is on-chain state, exposed via RPC info()",
    ],
  },
  {
    name: "Crypto Primitives",
    desc: "Everything above sits on a few audited building blocks.",
    accent: "teal",
    items: [
      "ed25519 (via @noble/curves) — Pedersen base + Schnorr + CLSAG + stealth",
      "BLS12-381 (via @noble/curves) — aggregate sigs + KZG polynomial commitments",
      "SHA-512 (via @noble/hashes) — backbone of dhash(domain, ...)",
      "KZG polynomial commitments (trusted-setup-free Verkle path)",
      "Domain-separated hashing (MFBN-1 codec, ≈ 30 DOMAIN constants)",
      "Bulletproofs inner-product argument (the range-proof engine)",
    ],
  },
];

const PLANNED_TIERS: { tier: string; title: string; accent: Accent; items: { name: string; why: string }[] }[] = [
  {
    tier: "Tier 2b",
    title: "Log-size ring signatures (privacy moonshot)",
    accent: "fuchsia",
    items: [
      {
        name: "Triptych / Spats / Lelantus log-size CLSAG successor",
        why: "Ring size 256 → 1024 with ~5 KB proofs. Anonymity set = the entire UTXO accumulator. ≈ 64× larger than Monero's 16-member ring; uniform across the whole chain history.",
      },
      {
        name: "Seraphis-style forward-secret stealth addresses",
        why: "View-tags for fast wallet scan; rotation under HD-wallet derivation; defense against key-exposure backwards-deanonymization.",
      },
      {
        name: "Dandelion++ gossip + Tor relay support",
        why: "Closes the network-level anonymity gap that ring sigs alone don't cover — a spender's tx broadcast no longer leaks their IP / first-relay identity.",
      },
    ],
  },
  {
    tier: "Tier 3a",
    title: "Recursive proof aggregation",
    accent: "rose",
    items: [
      {
        name: "Nova-style folding scheme over BLS12-381",
        why: "Fold every spend in a block into a single recursive instance. Verifier complexity is O(1) regardless of how many txs the block carries.",
      },
      {
        name: "Halo2 / IPA universal SNARK (no trusted setup)",
        why: "Compile the spend circuit (CLSAG / Triptych) into a transparent SNARK. ~200-byte proofs verifiable in milliseconds; pure hash-based assumptions.",
      },
    ],
  },
  {
    tier: "Tier 3b",
    title: "zk-STARK storage proofs (permanence moonshot)",
    accent: "lime",
    items: [
      {
        name: "FRI-based STARK proof of full-data possession",
        why: "Replace per-chunk Merkle audits with a single STARK proving \"I hold every chunk of root R.\" Hash-based, post-quantum, no trusted setup; verifier cost O(polylog N).",
      },
      {
        name: "Proof-of-Replication seals",
        why: "Bind each replica to a specific prover identity + time-lock seal so the chain can prove N independent copies physically exist, not one party serving N audits.",
      },
      {
        name: "Erasure-coded sharding (Reed-Solomon / RaptorQ)",
        why: "Store N data shards + K parity shards. Network tolerates ≥ N − 1 prover failures before any data is lost — fundamentally stronger than naive replication.",
      },
      {
        name: "PIR-style anonymous retrieval",
        why: "Reading a stored object reveals nothing about WHICH object was read. Closes the read-side metadata leak that even Arweave doesn't address.",
      },
    ],
  },
  {
    tier: "Tier 4",
    title: "Full zk-rollup of the privacy layer",
    accent: "yellow",
    items: [
      {
        name: "Recursive block-validity proof",
        why: "L1 stores only the accumulator root + a constant-size SNARK proving every tx in the block was valid. Light clients verify a block with a single pairing.",
      },
      {
        name: "Storage-provider staking + slashing registry",
        why: "Provers stake MFN to register; failing audits or serving wrong data → slashed. Aligns the permanence layer with the chain's security budget instead of relying on altruism.",
      },
      {
        name: "Endowment-proportional proof rewards",
        why: "Per-proof payout scales with the commitment's endowment (yield-per-slot from the whitepaper formula). Big-data uploads earn provers proportionally more — kills the current uniform-reward perverse incentive.",
      },
      {
        name: "Verkle tree UTXO accumulator (KZG-vector form)",
        why: "Replace the 32-deep binary Merkle with a KZG-vector-commit Verkle tree at depth ≈ log_256 N. Stateless block validation; ~95 % smaller membership proofs.",
      },
    ],
  },
];

function ArchDiagram() {
  const layers = IMPLEMENTED_LAYERS.map((l) => ({ name: l.name, accent: l.accent }));
  return (
    <svg
      viewBox="0 0 760 480"
      className="w-full h-auto"
      role="img"
      aria-label="MoneyFund architecture stack"
    >
      <defs>
        <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect width="760" height="480" fill="#0b0c12" rx="14" />
      {/* Subtle grid */}
      {Array.from({ length: 11 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={70 + i * 62}
          y1={20}
          x2={70 + i * 62}
          y2={460}
          stroke="#ffffff"
          strokeOpacity="0.03"
        />
      ))}
      {/* Title row */}
      <text x={50} y={36} fill="#94a3b8" fontFamily="ui-sans-serif" fontSize="11" fontWeight="700" letterSpacing="3">
        MONEYFUND NETWORK · LAYERED ARCHITECTURE
      </text>
      <text x={50} y={56} fill="#475569" fontFamily="ui-sans-serif" fontSize="10" letterSpacing="2">
        privacy ▸ permanence ▸ consensus — every layer built on top of audited @noble curves
      </text>
      {/* Layer stack */}
      {layers.map((l, i) => {
        const y = 80 + i * 48;
        const tier = ACCENT[l.accent];
        const fillByAccent: Record<Accent, string> = {
          cyan: "#67e8f9", amber: "#fcd34d", violet: "#c4b5fd", emerald: "#6ee7b7",
          rose: "#fda4af", sky: "#7dd3fc", fuchsia: "#f0abfc", lime: "#bef264",
          teal: "#5eead4", indigo: "#a5b4fc", yellow: "#fde047", orange: "#fdba74",
          red: "#fca5a5", slate: "#cbd5e1",
        };
        const c = fillByAccent[l.accent];
        return (
          <g key={l.name}>
            <rect
              x={50}
              y={y}
              width={660}
              height={36}
              rx={8}
              fill={c}
              fillOpacity={0.08}
              stroke={c}
              strokeOpacity={0.32}
            />
            <circle cx={70} cy={y + 18} r={4} fill={c} fillOpacity={0.85} />
            <text x={86} y={y + 22} fill="#e2e8f0" fontFamily="ui-sans-serif" fontSize="13" fontWeight="700" letterSpacing="0.5">
              {l.name}
            </text>
            <text x={86 + l.name.length * 8 + 10} y={y + 22} fill="#64748b" fontFamily="ui-sans-serif" fontSize="11">
              {`L${layers.length - i}`}
            </text>
            <text x={690} y={y + 22} fill={c} fillOpacity={0.7} fontFamily="ui-monospace" fontSize="10" textAnchor="end" letterSpacing="2">
              IMPL
            </text>
          </g>
        );
      })}
      {/* Side bracket */}
      <path d="M 30 80 L 38 80 L 38 460 L 30 460" fill="none" stroke="#475569" strokeOpacity="0.35" strokeWidth="1.5" />
      <text x={20} y={272} fill="#64748b" fontFamily="ui-sans-serif" fontSize="10" letterSpacing="3" transform="rotate(-90 20 272)">
        DETERMINISTIC STATE MACHINE
      </text>
    </svg>
  );
}

function DocsPanel() {
  const ACC: Accent = "slate";
  const a = ACCENT[ACC];

  const doc = useMemo(() => buildDocsMarkdown(), []);
  const onDownload = useCallback(() => {
    try {
      const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "moneyfund-architecture.md";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // ignore — most browsers will accept the above
    }
  }, [doc]);

  return (
    <div className="space-y-6">
      <SectionTitle
        accent={ACC}
        n="14"
        title="Docs · Architecture & Roadmap"
        sub="A high-level overview of MoneyFund's design, what's already built into the live primitives above, and what's coming next. Downloadable as a single Markdown document."
      />

      {/* Vision card */}
      <div className={`${card} p-6 space-y-3`}>
        <p className={`text-[10px] tracking-[0.2em] uppercase font-bold ${a.text}`}>
          The Vision
        </p>
        <p className="text-[15px] leading-relaxed text-white/85">
          MoneyFund is a single L1 that fuses{" "}
          <span className="text-emerald-300 font-semibold">greater financial privacy than Monero</span> with{" "}
          <span className="text-sky-300 font-semibold">greater data permanence than Arweave</span>.
          The two properties aren't independent — they fund each other: privacy-tx fees flow into a permanence
          treasury that pays storage provers, and storage uploaders pay into the same pool. The result is a
          self-sustaining two-sided market where each side strengthens the other.
        </p>
        <p className="text-[13px] leading-relaxed text-white/55">
          Below is the live state of the codebase plus the cutting-edge upgrades on the roadmap.
          Everything in <span className={a.text}>Implemented</span> is real code you can exercise in the tabs
          above; everything in <span className="text-fuchsia-300">Planned</span> is targeted for upcoming
          commits.
        </p>
      </div>

      {/* Architecture diagram */}
      <div className={`${card} p-5 space-y-3`}>
        <p className={`text-[10px] tracking-[0.2em] uppercase font-bold ${a.text}`}>
          Layered architecture
        </p>
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3 overflow-hidden">
          <ArchDiagram />
        </div>
        <p className="text-[11px] text-white/40 leading-relaxed">
          Each layer is a deterministic pure-function module that only reads the layer below.
          State transitions (applyBlock) recompute every layer's invariants from scratch on every block, so
          any node — even one starting from the genesis config alone — converges on the same chain state.
        </p>
      </div>

      {/* Implemented */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-bold tracking-[0.2em] uppercase text-white/80">
            Implemented · live in the codebase
          </p>
          <p className="text-[10px] tracking-[0.2em] uppercase text-emerald-300/70 font-mono">
            8 layers · ~50 modules
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {IMPLEMENTED_LAYERS.map((l) => {
            const al = ACCENT[l.accent];
            return (
              <div
                key={l.name}
                className={`rounded-xl border ${al.ring} bg-gradient-to-b ${al.soft} p-4 space-y-2`}
              >
                <p className={`text-[11px] font-bold tracking-[0.2em] uppercase ${al.text}`}>
                  {l.name}
                </p>
                <p className="text-[12px] text-white/55 leading-relaxed">{l.desc}</p>
                <ul className="space-y-1 pt-1">
                  {l.items.map((it) => (
                    <li
                      key={it}
                      className="text-[12px] text-white/75 leading-relaxed flex gap-2"
                    >
                      <span className={`${al.text} shrink-0`}>›</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Planned */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-bold tracking-[0.2em] uppercase text-white/80">
            Planned · roadmap
          </p>
          <p className="text-[10px] tracking-[0.2em] uppercase text-fuchsia-300/70 font-mono">
            4 tiers · cutting-edge crypto
          </p>
        </div>
        <div className="space-y-4">
          {PLANNED_TIERS.map((t) => {
            const at = ACCENT[t.accent];
            return (
              <div
                key={t.tier}
                className={`rounded-xl border ${at.ring} bg-gradient-to-r ${at.soft} p-4 space-y-3`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-3">
                    <span className={`text-[10px] font-mono tabular-nums tracking-[0.2em] ${at.text}`}>
                      {t.tier}
                    </span>
                    <h3 className="text-base font-bold text-white tracking-tight">{t.title}</h3>
                  </div>
                  <span
                    className={`text-[9px] tracking-[0.2em] uppercase font-bold px-2 py-0.5 rounded ${at.chip} border`}
                  >
                    planned
                  </span>
                </div>
                <ul className="space-y-2">
                  {t.items.map((it) => (
                    <li
                      key={it.name}
                      className="rounded-lg border border-white/[0.05] bg-black/20 p-3 space-y-1"
                    >
                      <p className={`text-[12px] font-bold ${at.text}`}>{it.name}</p>
                      <p className="text-[11.5px] text-white/65 leading-relaxed">{it.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Download */}
      <div className={`${card} p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4`}>
        <div className="space-y-1">
          <p className={`text-[10px] tracking-[0.2em] uppercase font-bold ${a.text}`}>
            Take the doc with you
          </p>
          <p className="text-[13px] text-white/70 leading-relaxed">
            One Markdown file with the full overview, every implemented layer, and every planned upgrade.
            Render it in any Markdown viewer — or use it as the seed of a real whitepaper.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <PrimaryButton onClick={onDownload} accent={ACC}>
            ⤓ Download .md
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function buildDocsMarkdown(): string {
  const lines: string[] = [];
  lines.push("# MoneyFund Network — Architecture & Roadmap");
  lines.push("");
  lines.push(`_generated ${new Date().toISOString().slice(0, 10)} from the live codebase_`);
  lines.push("");
  lines.push("## Vision");
  lines.push("");
  lines.push(
    "MoneyFund is a single L1 that fuses **greater financial privacy than Monero** with **greater data permanence than Arweave**. " +
      "The two properties aren't independent — they fund each other: privacy-transaction fees flow into a permanence treasury " +
      "that pays storage provers, and storage uploaders pay into the same pool via the protocol-enforced endowment formula. " +
      "The result is a self-sustaining two-sided market where each side strengthens the other."
  );
  lines.push("");
  lines.push("## High-level architecture");
  lines.push("");
  lines.push("```");
  lines.push("┌───────────────────────────────────────────────────────┐");
  lines.push("│  L8  Application      Wallets · CLI · RPC clients     │");
  lines.push("│  L7  Node + Mempool   ConsensusNode · gossip · store  │");
  lines.push("│  L6  Consensus        VRF leader + BLS finality       │");
  lines.push("│  L5  Privacy          CLSAG · stealth · Bulletproofs  │");
  lines.push("│  L4  UTXO Accumulator depth-32 Merkle, light-client   │");
  lines.push("│  L3  Permanence       SPoRA Merkle audits + registry  │");
  lines.push("│  L2  Tokenomics       emission · treasury · endowment │");
  lines.push("│  L1  Crypto Primitives ed25519 · BLS12-381 · KZG · SHA│");
  lines.push("└───────────────────────────────────────────────────────┘");
  lines.push("```");
  lines.push("");
  lines.push("Each layer is a deterministic pure-function module that only reads the layer below. ");
  lines.push("State transitions (`applyBlock`) recompute every layer's invariants from scratch on every block, ");
  lines.push("so any node — even one starting from the genesis config alone — converges on the same chain state.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Implemented · live in the codebase");
  lines.push("");
  for (const l of IMPLEMENTED_LAYERS) {
    lines.push(`### ${l.name}`);
    lines.push("");
    lines.push(`_${l.desc}_`);
    lines.push("");
    for (const it of l.items) lines.push(`- ${it}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Planned · roadmap");
  lines.push("");
  for (const t of PLANNED_TIERS) {
    lines.push(`### ${t.tier} — ${t.title}`);
    lines.push("");
    for (const it of t.items) {
      lines.push(`- **${it.name}**`);
      lines.push(`  - ${it.why}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("## Economic model in one paragraph");
  lines.push("");
  lines.push(
    "Block emission follows a Monero-style schedule (50 → 25 → 12.5 → … → tail ≈ 0.195 MFN/block over 8 halvings) " +
      "and funds block-producer security. Every regular transaction's fee splits 90/10: 90% flows into the on-chain " +
      "permanence treasury, 10% to the producer as a priority tip. Uploads must pay a consensus-enforced minimum fee " +
      "such that their treasury share covers `requiredEndowment(sizeBytes, replication) = C₀·(1+i)/(r−i)`. Storage " +
      "providers earn rewards per accepted SPoRA proof; rewards drain the treasury first, with emission minting any " +
      "shortfall as a transitional backstop. As privacy demand grows, the treasury becomes self-sustaining and the " +
      "backstop fades to zero — without ever leaving providers unpaid."
  );
  lines.push("");
  lines.push("## Privacy model in one paragraph");
  lines.push("");
  lines.push(
    "Every spend is a RingCT-style transaction: inputs reference previous outputs through a CLSAG ring (with gamma-" +
      "distributed decoys), each input carries a Pedersen pseudo-output, each new output is a Monero-style stealth " +
      "address with a Bulletproofs-protected hidden amount. Encrypted-amount blobs let only the recipient open their " +
      "share. Spent outputs are tracked by their key images (Σ key-images-seen across the chain is the only spent-set " +
      "the verifier needs). The full UTXO history is committed into a depth-32 incremental Merkle accumulator whose " +
      "root sits in every block header, providing the cryptographic substrate for log-size ring signatures (Tier 2b) " +
      "and zk-rollup composition (Tier 4)."
  );
  lines.push("");
  return lines.join("\n");
}

/* ================================================================== */
/*  TAB SHELL                                                           */
/* ================================================================== */

const TABS: { id: string; label: string; accent: Accent; component: React.FC }[] = [
  { id: "schnorr", label: "Schnorr", accent: "cyan", component: SchnorrPanel },
  { id: "pedersen", label: "Pedersen", accent: "amber", component: PedersenPanel },
  { id: "stealth", label: "Stealth", accent: "violet", component: StealthPanel },
  { id: "ring", label: "Ring Sigs", accent: "emerald", component: RingPanel },
  { id: "range", label: "Range", accent: "rose", component: RangePanel },
  { id: "storage", label: "Storage", accent: "sky", component: StoragePanel },
  { id: "tx", label: "Transaction", accent: "fuchsia", component: TxPanel },
  { id: "block", label: "Blocks", accent: "lime", component: BlockPanel },
  { id: "bp", label: "Bulletproofs", accent: "teal", component: BulletproofsPanel },
  { id: "vrf", label: "VRF", accent: "indigo", component: VrfPanel },
  { id: "bls", label: "BLS", accent: "yellow", component: BlsPanel },
  { id: "kzg", label: "KZG", accent: "orange", component: KzgPanel },
  { id: "consensus", label: "Consensus", accent: "red", component: ConsensusPanel },
  { id: "docs", label: "Docs", accent: "slate", component: DocsPanel },
];

export default function BlockchainLab() {
  const [tab, setTab] = useState<string>("schnorr");
  const Active = TABS.find((t) => t.id === tab)?.component ?? SchnorrPanel;

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-16 space-y-10">
        {/* Hero */}
        <section className="pt-6 text-center">
          <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">
            MoneyFund Blockchain Primitives
          </h1>
        </section>

        {/* Tabs */}
        <nav className="sticky top-14 z-20 -mx-4 sm:-mx-8 px-4 sm:px-8 py-2 backdrop-blur-md bg-[#08090e]/90 border-b border-white/[0.05]">
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 scrollbar-hide">
            {TABS.map((t) => {
              const a = ACCENT[t.accent];
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-4 py-2 rounded-lg border text-[11px] font-bold tracking-[0.15em] uppercase transition-all cursor-pointer ${
                    active
                      ? `${a.bg} ${a.text} ${a.ring}`
                      : "bg-white/[0.02] text-white/50 border-white/[0.06] hover:bg-white/[0.05] hover:text-white/80"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Active panel */}
        <section className="space-y-4">
          <Active />
        </section>

        {/* Footer */}
        <section className="pt-4">
          <div className="text-center space-y-2">
            <p className="text-[10px] tracking-[0.3em] uppercase text-white/30">
              foundation layer · v0.1
            </p>
            <p className="text-[10px] text-white/20">
              Reference implementation. Round-trip tested. Not yet audited for production.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
