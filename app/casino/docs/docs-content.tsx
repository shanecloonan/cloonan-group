"use client";

import Link from "next/link";
import { useState } from "react";
import { CasinoShell } from "../casino-shell";
import { card, GAME_LABELS, pillGold, type CasinoGameId } from "../casino-ui";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "platform", label: "Platform" },
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
  { id: "poker", label: "Poker" },
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
              MoneyFund Casino runs ten live games on a shared engine: deterministic rules in{" "}
              <code className="text-amber-200/90">lib/casino/</code>, session audit logs, and HMAC-SHA256
              commit-reveal randomness. <strong className="text-white">Dev / Play Money</strong> needs no account —
              you get a random guest name and free chips (+10K / +100K / +1M) from the bottom chip bar. Signed-in users
              on real chains sync to Supabase. On-chain settlement via <code className="text-amber-200/90">CasinoVault.sol</code> is
              Phase 2 (Base L2 first).
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-3">
              <li>Every settled session stores stake, nonces, seeds, and full result JSON.</li>
              <li>
                <Link href="/casino/dashboard" className="text-amber-300 hover:underline">
                  Dashboard
                </Link>{" "}
                — filter your play;{" "}
                <Link href="/casino/history" className="text-amber-300 hover:underline">
                  Activity
                </Link>{" "}
                — your sessions plus global bet log;{" "}
                <Link href="/casino/leaderboard" className="text-amber-300 hover:underline">
                  Leaderboard
                </Link>{" "}
                — opt-in rankings.
              </li>
            </ul>
          </DocSection>

          <DocSection id="platform" title="Platform & navigation">
            <Callout title="Designed for low friction">
              Every route uses the same luxury shell: sticky top nav, gold accent tokens, blur cards, and a
              bottom tab bar on phones (Play, Hub, Bets, Ranks, Vault). Sign in once to sync seeds, balances,
              and leaderboard visibility to Supabase.
            </Callout>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <PlatformCard
                href="/casino/dashboard"
                title="Player dashboard"
                body="Filter by game, source (local/cloud), 7d/30d window, and win/loss. Stats, profile, and a live house feed sidebar."
              />
              <PlatformCard
                href="/casino/leaderboard"
                title="Leaderboard & loserboard"
                body="Top overall winners/losers plus biggest single-hand wins and losses. Named ranks require opt-in; feed still logs all bets."
              />
              <PlatformCard
                href="/casino/history"
                title="Activity log"
                body="Your sessions — merge local and cloud, sort, filter, export JSON/CSV, verify links — plus a global house feed tab with live refresh."
              />
            </div>
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
            <ol className="list-decimal pl-5 space-y-2 mt-3 text-white/70">
              <li>
                Compile: <code className="text-amber-200/90">cd infra/contracts/ethereum</code>, then{" "}
                <code className="text-amber-200/90">forge install OpenZeppelin/openzeppelin-contracts forge-std --no-commit</code>,{" "}
                <code className="text-amber-200/90">forge build</code>.
              </li>
              <li>
                Deploy with <code className="text-amber-200/90">script/DeployCasinoVault.s.sol</code> (owner = multisig,
                operator = hot signer).
              </li>
              <li>
                Set <code className="text-amber-200/90">NEXT_PUBLIC_CASINO_VAULT_*</code> and{" "}
                <code className="text-amber-200/90">CASINO_OPERATOR_KEY</code> for withdraw signing via{" "}
                <code className="text-amber-200/90">/api/casino/withdraw-authorize</code>.
              </li>
              <li>
                Check deployment status: <code className="text-amber-200/90">GET /api/casino/vault-status</code> (also
                surfaced on the Wallet page when a chain is not configured).
              </li>
              <li>
                After a finalized deposit tx, <code className="text-amber-200/90">POST /api/casino/deposit-credit</code>{" "}
                verifies the receipt on-chain and credits the Supabase ledger idempotently by tx hash.
              </li>
              <li>
                Before submitting a withdraw tx, <code className="text-amber-200/90">POST /api/casino/withdraw-lock</code>{" "}
                moves available → locked (JWT). On failure, <code className="text-amber-200/90">POST /api/casino/withdraw-unlock</code>{" "}
                releases the lock.
              </li>
              <li>
                After lock + finalized withdraw tx, <code className="text-amber-200/90">POST /api/casino/withdraw-debit</code>{" "}
                verifies <code className="text-amber-200/90">Withdrawn</code> on-chain and burns locked balance by tx hash.
              </li>
              <li>
                Operator indexer: <code className="text-amber-200/90">POST /api/casino/operator/deposit-credit</code> and{" "}
                <code className="text-amber-200/90">POST /api/casino/operator/withdraw-debit</code> with{" "}
                <code className="text-amber-200/90">Authorization: Bearer CASINO_OPERATOR_SECRET</code> and{" "}
                <code className="text-amber-200/90">userId</code> in the body (idempotent ledger credit/debit by tx hash).
              </li>
              <li>
                Multiplayer poker uses <code className="text-amber-200/90">turn_started_at</code> for the 45s action clock so bot
                updates do not reset the timer.
              </li>
            </ol>
            <p className="mt-3">
              Until vault addresses are configured, use Dev / Play Money on the lobby. Wallet UI at{" "}
              <Link href="/casino/wallet" className="text-amber-300 hover:underline">
                /casino/wallet
              </Link>{" "}
              exercises the full two-step deposit flow when env vars are set. Public activity:{" "}
              <Link href="/casino/history?view=global" className="text-amber-300 hover:underline">
                Activity · global feed
              </Link>
              .
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
                      ["poker", "skill", "1% rake"],
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

          <GameDoc
            id="blackjack"
            title="Blackjack"
            rtp="99.58%"
            rules={[
              "6-deck shoe, S17 (dealer stands soft 17) by default.",
              "Blackjack pays 3:2 unless table config says otherwise.",
              "Double on first two cards; split pairs once; insurance offered vs dealer Ace.",
            ]}
            verify={[
              "Every card dealt consumes HMAC bytes in order; action log stores post-state hashes.",
              "Verifier replays hit/stand/double/split and compares final hands and payout.",
            ]}
          />

          <GameDoc id="coinflip" title="Coinflip" rtp="99.00%" rules={[
            "Pick heads or tails; win pays 1.98× (1% house edge).",
            "Auto-bet and martingale helpers are UI-only — engine still one fair flip per round.",
          ]} verify={[
            "One RNG byte drives the flip; bit 0 maps to heads/tails.",
            "Replay checks prediction vs outcome and published server-seed hash.",
          ]} />

          <GameDoc id="dice" title="Dice / Limbo" rtp="99.00%" rules={[
            "Set win chance 2–98%; payout = 99 / chance (Limbo uses target multiplier with same edge).",
            "Roll under (or over) your threshold; max multiplier capped for display safety.",
          ]} verify={[
            "Roll in basis points and target/direction are frozen in the session config.",
            "Verifier recomputes win/loss from the same HMAC draw.",
          ]} />

          <GameDoc id="roulette" title="Roulette" rtp="97.30%" rules={[
            "European single-zero wheel (37 pockets).",
            "Straight 35:1, splits 17:1, streets 11:1, corners 8:1, six-line 5:1, dozens/columns 2:1, even-money 1:1.",
            "Desktop: gold edges (split/street), violet bar (six-line between columns), corner dots.",
            "La Partage not enabled — zero loses all outside bets.",
            "Mobile: 12-column grid (no overlapping digits); zero rail on the left; tap a pocket then inside bets in the amber bar; hold to clear chips.",
          ]} verify={[
            "Placements freeze at spin; one RNG draw selects the winning pocket.",
            "Verifier replays each bet’s payout (inside + outside) against that pocket.",
          ]} />

          <GameDoc id="slots" title="Slots" rtp="≈96%" rules={[
            "5×3 grid, 20 paylines, wilds, scatters, free-spin triggers.",
            "Paytable published in-game; empirical RTP checked via smoke suite (~96.5% at 100k spins).",
          ]} verify={[
            "Each spin’s reel stops and line wins are logged with nonce order.",
            "Replay rebuilds the grid and scatter/free-spin triggers from the seed stream.",
          ]} />

          <GameDoc id="crash" title="Crash" rtp="99.00%" rules={[
            "Multiplier rises until bust; cash out before bust to win stake × multiplier.",
            "Bust point derived from HMAC stream; auto-cashout honored at tick.",
            "Max multiplier cap applies to UI and payout math.",
          ]} verify={[
            "Bust multiplier is fixed at session open from a 52-bit RNG draw.",
            "Cashout action (manual or auto) is replayed against that bust point.",
          ]} />

          <GameDoc id="plinko" title="Plinko" rtp="99.00%" rules={[
            "16 rows, 3 risk tiers (low / medium / high) with different payout ladders.",
            "Bin chosen by cumulative probability from RNG bytes; RTP verified per configuration.",
          ]} verify={[
            "Each peg step is one RNG bit; the path determines the bin and multiplier.",
            "Rows and risk tier are part of the frozen session config.",
          ]} />

          <GameDoc id="mines" title="Mines" rtp="99.00%" rules={[
            "5×5 grid, 1–24 mines; each safe reveal increases multiplier with flat 1% edge.",
            "Cash out anytime; hit mine loses stake.",
          ]} verify={[
            "Mine positions are shuffled once when the round opens.",
            "Each tile pick is logged; replay exposes the full 25-cell layout at settle.",
          ]} />

          <GameDoc id="hilo" title="HiLo" rtp="99.00%" rules={[
            "13-rank deck; guess higher-or-same / lower-or-same vs current card.",
            "Multipliers compound with 1% edge per step; cash out between rounds.",
          ]} verify={[
            "Card sequence and each pick’s win/loss replay from the action log.",
            "Published probabilities at pick time match the engine’s deck math.",
          ]} />

          <GameDoc
            id="poker"
            title="Poker (6-Max Hold'em)"
            rtp="skill-based · 1% rake"
            rules={[
              "Solo: you (seat 0) vs five AI opponents. Multiplayer: host/join room codes, Supabase Realtime sync, profile display names.",
              "Multiplayer buy-in is locked from your casino balance when you take a seat; settlement credits your seat stack after the hand.",
              "45s turn timer; server auto-folds if time expires (any seated player can trigger).",
              "No-limit betting: fold, check, call, raise (min-raise = big blind).",
              "Blinds scale with buy-in (BB ≈ buy-in / 50). Rake on contested pots at showdown.",
            ]}
            verify={[
              "Shoe order is deterministic from the seed stream; all streets and bot actions are in the session log.",
              "Replay reconstructs community cards and showdown winners.",
            ]}
          />
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
  verify,
}: {
  id: string;
  title: string;
  rtp: string;
  rules: string[];
  verify?: string[];
}) {
  return (
    <DocSection id={id} title={title}>
      <div className={card + " p-4 mb-4 flex flex-wrap items-center justify-between gap-2"}>
        <span className="text-white/50 text-xs uppercase tracking-wider">Published RTP</span>
        <span className="font-mono text-lg text-emerald-300/95">{rtp}</span>
      </div>
      <h3 className="text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mb-2">Rules</h3>
      <ul className="list-disc pl-5 space-y-1.5">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {verify && verify.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-[0.15em] text-white/40 font-semibold mt-4 mb-2">
            Verifiability
          </h3>
          <ul className="list-disc pl-5 space-y-1.5 text-white/65">
            {verify.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-white/50 text-xs border-t border-white/[0.06] pt-3">
        Export session JSON from History or the in-table share link →{" "}
        <Link href="/casino/verify" className="text-amber-300 hover:underline">
          /casino/verify
        </Link>{" "}
        with your revealed server seed.
      </p>
    </DocSection>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={card + " p-4 border-amber-400/20 bg-amber-500/[0.06]"}>
      <div className="text-sm font-semibold text-amber-100 mb-1">{title}</div>
      <div className="text-white/65 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function PlatformCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className={
        card +
        " block p-4 hover:border-amber-400/30 transition-all group"
      }
    >
      <div className="text-sm font-semibold text-white group-hover:text-amber-100">{title}</div>
      <p className="mt-1.5 text-xs text-white/50 leading-relaxed">{body}</p>
      <span className="inline-block mt-2 text-[11px] text-amber-300/80">Open →</span>
    </Link>
  );
}
