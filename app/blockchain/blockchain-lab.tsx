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
/* ================================================================== */

import { useCallback, useMemo, useState } from "react";
import {
  G,
  H,
  L,
  scalarToHex,
  pointToHex,
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

/* ------------------------------------------------------------------ */
/*  DESIGN TOKENS                                                      */
/* ------------------------------------------------------------------ */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

type Accent = "cyan" | "amber" | "violet" | "emerald";

const ACCENT: Record<Accent, { text: string; ring: string; bg: string; soft: string; chip: string; glow: string }> = {
  cyan:    { text: "text-cyan-300",    ring: "border-cyan-400/30",    bg: "bg-cyan-500/10",    soft: "from-cyan-500/[0.06] to-transparent",    chip: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",    glow: "shadow-cyan-500/10" },
  amber:   { text: "text-amber-300",   ring: "border-amber-400/30",   bg: "bg-amber-500/10",   soft: "from-amber-500/[0.06] to-transparent",   chip: "bg-amber-500/15 text-amber-200 border-amber-400/30",   glow: "shadow-amber-500/10" },
  violet:  { text: "text-violet-300",  ring: "border-violet-400/30",  bg: "bg-violet-500/10",  soft: "from-violet-500/[0.06] to-transparent",  chip: "bg-violet-500/15 text-violet-200 border-violet-400/30", glow: "shadow-violet-500/10" },
  emerald: { text: "text-emerald-300", ring: "border-emerald-400/30", bg: "bg-emerald-500/10", soft: "from-emerald-500/[0.06] to-transparent", chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30", glow: "shadow-emerald-500/10" },
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
/*  TAB SHELL                                                           */
/* ================================================================== */

const TABS: { id: string; label: string; accent: Accent; component: React.FC }[] = [
  { id: "schnorr", label: "Schnorr", accent: "cyan", component: SchnorrPanel },
  { id: "pedersen", label: "Pedersen", accent: "amber", component: PedersenPanel },
  { id: "stealth", label: "Stealth", accent: "violet", component: StealthPanel },
  { id: "ring", label: "Ring Sigs", accent: "emerald", component: RingPanel },
];

export default function BlockchainLab() {
  const [tab, setTab] = useState<string>("schnorr");
  const Active = TABS.find((t) => t.id === tab)?.component ?? SchnorrPanel;

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-16 space-y-10">
        {/* Hero */}
        <section className="space-y-4 pt-6">
          <div className="text-center space-y-3">
            <p className="text-[10px] tracking-[0.4em] uppercase text-emerald-400/70 font-semibold">
              MoneyFund · Blockchain · Foundations
            </p>
            <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">
              Cryptographic Lab
            </h1>
            <p className="text-[13px] text-white/50 max-w-2xl mx-auto leading-relaxed">
              Live, in-browser implementation of the Tier-1 primitives from §4 of the
              whitepaper. Every byte below is computed by audited{" "}
              <span className="font-mono text-emerald-300/80">@noble/curves</span> running
              over <span className="font-mono text-emerald-300/80">ed25519</span>. Click
              anything — it really runs.
            </p>
            <div className="mx-auto mt-2 w-24 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/40 via-amber-500/40 via-violet-500/40 to-emerald-500/40" />
          </div>

          {/* Curve constants */}
          <div className={`${card} p-4 sm:p-5`}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
                <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                  Curve
                </p>
                <p className="text-sm font-mono text-white/85">ed25519 (Edwards)</p>
                <p className="text-[10px] text-white/35 mt-1">
                  prime-order subgroup, cofactor 8
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
                <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                  Subgroup order L
                </p>
                <p className="text-[11px] font-mono text-white/65 break-all leading-snug">
                  {shorten(L.toString(16), 14, 12)}
                </p>
                <p className="text-[10px] text-white/35 mt-1">
                  2<sup>252</sup> + 27742317…6493
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3">
                <p className="text-[9px] tracking-[0.25em] uppercase text-white/40 font-bold mb-1">
                  Hash family
                </p>
                <p className="text-sm font-mono text-white/85">SHA-512</p>
                <p className="text-[10px] text-white/35 mt-1">
                  H_s · scalar · H_p · point (try-and-increment)
                </p>
              </div>
            </div>
          </div>
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
