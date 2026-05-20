"use client";

import Link from "next/link";
import { useState } from "react";
import { CasinoShell } from "../casino-shell";
import { card, GAME_LABELS, pillGold, type CasinoGameId } from "../casino-ui";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "fairness", label: "Provable fairness" },
  { id: "crypto", label: "Crypto & vault" },
  { id: "house", label: "House edge" },
  { id: "blackjack", label: "Blackjack" },
  { id: "coinflip", label: "Coinflip" },
  { id: "dice", label: "Dice / Limbo" },
  { id: "roulette", label: "Roulette" },
  { id: "slots", label: "Slots" },
  { id: "crash", label: "Crash" },
  { id: "plinko", label: "Plinko" },
  { id: "mines", label: "Mines" },
  { id: "hilo", label: "HiLo" },
] as const;

export default function DocsContent() {
  const [active, setActive] = useState<string>("overview");

  return (
    <CasinoShell
      badge="Official reference"
      title="Casino documentation"
      subtitle="Rules, published RTP targets, verification steps, and settlement architecture — updated as games ship."
    >
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
        <nav className="lg:sticky lg:top-28 h-fit space-y-1">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActive(s.id)}
              className={
                "block px-3 py-2 rounded-lg text-sm transition-colors " +
                (active === s.id
                  ? "bg-amber-500/15 text-amber-100 border border-amber-400/25"
                  : "text-white/55 hover:text-white hover:bg-white/[0.04]")
              }
            >
              {s.label}
            </a>
          ))}
          <Link
            href="/casino/verify"
            className="block mt-4 px-3 py-2 text-sm text-amber-300 hover:text-amber-200"
          >
            Open verifier →
          </Link>
        </nav>

        <div className="space-y-10 text-white/75 leading-relaxed text-sm">
          <DocSection id="overview" title="Overview">
            <p>
              MoneyFund Casino runs nine live games on a shared engine: deterministic rules in{" "}
              <code className="text-amber-200/90">lib/casino/</code>, session audit logs, and HMAC-SHA256
              commit-reveal randomness. Dev-money mode uses an in-browser ledger; signed-in users sync to
              Supabase. On-chain settlement via <code className="text-amber-200/90">CasinoVault.sol</code> is
              Phase 2 (Base L2 first).
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-3">
              <li>Every settled session stores stake, nonces, seeds, and full result JSON.</li>
              <li>
                <Link href="/casino/dashboard" className="text-amber-300 hover:underline">
                  Dashboard
                </Link>{" "}
                — filter your play;{" "}
                <Link href="/casino/leaderboard" className="text-amber-300 hover:underline">
                  Leaderboard
                </Link>{" "}
                — opt-in rankings;{" "}
                <Link href="/casino/history" className="text-amber-300 hover:underline">
                  History
                </Link>{" "}
                — export & verify links.
              </li>
            </ul>
          </DocSection>

          <DocSection id="fairness" title="Provable fairness">
            <p>
              Before play, you see <strong className="text-white">server_seed_hash = SHA-256(server_seed)</strong>.
              Each action advances a monotonic nonce. Outcomes use{" "}
              <code className="text-amber-200/90">HMAC-SHA256(server_seed, client_seed:nonce:…)</code> as a byte
              stream — never raw floating RNG.
            </p>
            <ol className="list-decimal pl-5 space-y-2 mt-3">
              <li>Export or copy the settled session JSON from History or the in-table share button.</li>
              <li>
                Paste into{" "}
                <Link href="/casino/verify" className="text-amber-300 hover:underline">
                  /casino/verify
                </Link>{" "}
                with the revealed server seed (shown when you rotate seeds).
              </li>
              <li>The browser replays every action; green means the operator could not have biased that hand.</li>
            </ol>
          </DocSection>

          <DocSection id="crypto" title="Crypto & vault">
            <p>
              Specification: <code className="text-amber-200/90">infra/contracts/ethereum/CasinoVault.sol</code>.
              Players deposit ERC-20 (USDC on Base); the hot operator signs EIP-712 withdrawal vouchers; players
              submit <code className="text-amber-200/90">withdraw()</code> themselves. Deposits can pause; withdrawals
              cannot — rescue path. Per-token daily caps and multisig timelock on admin functions.
            </p>
            <p className="mt-2">
              Until vault addresses are configured, use Dev / Play Money on the lobby. Wallet UI at{" "}
              <Link href="/casino/wallet" className="text-amber-300 hover:underline">
                /casino/wallet
              </Link>{" "}
              exercises the full two-step deposit flow when env vars are set.
            </p>
          </DocSection>

          <DocSection id="house" title="House edge summary">
            <div className={card + " overflow-hidden mt-3"}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[10px] uppercase tracking-wider text-white/40">
                    <th className="text-left p-3">Game</th>
                    <th className="text-right p-3">Target RTP</th>
                    <th className="text-right p-3">Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["blackjack", "99.58%", "0.42%"],
                      ["coinflip", "99.00%", "1.00%"],
                      ["dice", "99.00%", "1.00%"],
                      ["crash", "99.00%", "1.00%"],
                      ["plinko", "99.00%", "1.00%"],
                      ["mines", "99.00%", "1.00%"],
                      ["hilo", "99.00%", "1.00%"],
                      ["roulette", "97.30%", "2.70%"],
                      ["slots", "≈96%", "≈4%"],
                    ] as const
                  ).map(([g, rtp, edge]) => (
                    <tr key={g} className="border-b border-white/[0.04]">
                      <td className="p-3 text-white/85">{GAME_LABELS[g as CasinoGameId]}</td>
                      <td className="p-3 text-right font-mono text-emerald-300/90">{rtp}</td>
                      <td className="p-3 text-right font-mono text-white/50">{edge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DocSection>

          <GameDoc id="blackjack" title="Blackjack" rtp="99.58%" rules={[
            "6-deck shoe, S17 (dealer stands soft 17) by default.",
            "Blackjack pays 3:2 unless table config says otherwise.",
            "Double on first two cards; split pairs once; insurance offered vs dealer Ace.",
            "Full action log + card order reproducible from seed stream.",
          ]} />

          <GameDoc id="coinflip" title="Coinflip" rtp="99.00%" rules={[
            "Pick heads or tails; win pays 1.98× (1% house edge).",
            "Auto-bet and martingale helpers are UI-only — engine still one fair flip per round.",
          ]} />

          <GameDoc id="dice" title="Dice / Limbo" rtp="99.00%" rules={[
            "Set win chance 2–98%; payout = 99 / chance (Limbo uses target multiplier with same edge).",
            "Roll under (or over) your threshold; max multiplier capped for display safety.",
          ]} />

          <GameDoc id="roulette" title="Roulette" rtp="97.30%" rules={[
            "European single-zero wheel (37 pockets).",
            "Straight 35:1, splits 17:1, streets 11:1, corners 8:1, six-line 5:1, dozens/columns 2:1, even-money 1:1.",
            "La Partage not enabled — zero loses all outside bets.",
          ]} />

          <GameDoc id="slots" title="Slots" rtp="≈96%" rules={[
            "5×3 grid, 20 paylines, wilds, scatters, free-spin triggers.",
            "Paytable published in-game; empirical RTP checked via smoke suite (~96.5% at 100k spins).",
          ]} />

          <GameDoc id="crash" title="Crash" rtp="99.00%" rules={[
            "Multiplier rises until bust; cash out before bust to win stake × multiplier.",
            "Bust point derived from HMAC stream; auto-cashout honored at tick.",
            "Max multiplier cap applies to UI and payout math.",
          ]} />

          <GameDoc id="plinko" title="Plinko" rtp="99.00%" rules={[
            "16 rows, 3 risk tiers (low / medium / high) with different payout ladders.",
            "Bin chosen by cumulative probability from RNG bytes; RTP verified per configuration.",
          ]} />

          <GameDoc id="mines" title="Mines" rtp="99.00%" rules={[
            "5×5 grid, 1–24 mines; each safe reveal increases multiplier with flat 1% edge.",
            "Cash out anytime; hit mine loses stake.",
          ]} />

          <GameDoc id="hilo" title="HiLo" rtp="99.00%" rules={[
            "13-rank deck; guess higher-or-same / lower-or-same vs current card.",
            "Multipliers compound with 1% edge per step; cash out between rounds.",
          ]} />
        </div>
      </div>
    </CasinoShell>
  );
}

function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="font-heading text-2xl font-semibold text-white mb-3 flex items-center gap-2">
        {title}
        <span className={pillGold}>Live</span>
      </h2>
      {children}
    </section>
  );
}

function GameDoc({
  id,
  title,
  rtp,
  rules,
}: {
  id: string;
  title: string;
  rtp: string;
  rules: string[];
}) {
  return (
    <DocSection id={id} title={title}>
      <p className="text-amber-200/90 font-mono text-xs mb-2">Published RTP {rtp}</p>
      <ul className="list-disc pl-5 space-y-1">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-3 text-white/50 text-xs">
        Verify any session: export JSON →{" "}
        <Link href="/casino/verify" className="text-amber-300 hover:underline">
          verifier
        </Link>
        .
      </p>
    </DocSection>
  );
}
