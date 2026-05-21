"use client";

/* ===========================================================================
 *  Public verification page — /casino/verify
 *  ---------------------------------------------------------------------------
 *  Anyone (player, journalist, auditor) can paste a settled session +
 *  revealed server seed and have their **own browser** re-derive every card
 *  / roll / flip. The verification result either turns green ✓ (provably
 *  fair) or red ✗ (the operator cheated).
 *
 *  Two ways to load a session:
 *    1. Paste a JSON dump of the `Session` object (we accept the exact
 *       shape `/casino` writes to `localStorage` and to Supabase).
 *    2. Open this page with a `?session=<base64-json>` URL query — the
 *       in-game "share verification link" button uses this format so the
 *       link itself contains the entire hand state.
 *
 *  The replay logic lives in `lib/casino/verify.ts` — this page is pure
 *  presentation.
 * ========================================================================= */

import { useMemo, useState } from "react";
import { CasinoShell } from "../casino-shell";
import {
  baccaratGame,
  blackjackGame,
  cardLabel,
  coinflipGame,
  formatBaccaratCards,
  cardFromIndex,
  crashGame,
  describePlacement,
  diceGame,
  hiloGame,
  pokerGame,
  videoPokerGame,
  kenoGame,
  wheelGame,
  sicBoGame,
  sicBoBetLabel,
  dragonTigerGame,
  casinoWarGame,
  redDogGame,
  threeCardPokerGame,
  formatThreeCardHand,
  threeCardHandLabel,
  andarBaharGame,
  caribbeanStudGame,
  formatCaribbeanStudHand,
  casinoHoldemGame,
  formatCasinoHoldemCards,
  letItRideGame,
  formatLetItRideCards,
  mississippiStudGame,
  formatMississippiStudCards,
  chuckALuckGame,
  ultimateTexasHoldemGame,
  formatUltimateHoldemCards,
  crapsGame,
  formatCrapsRoll,
  describeScore,
  minesGame,
  plinkoGame,
  rouletteGame,
  slotsGame,
  SYMBOL_GLYPH,
  verifySession,
  type BaccaratAction,
  type BaccaratState,
  type BlackjackAction,
  type BlackjackState,
  type CoinflipAction,
  type CoinflipState,
  type CrashAction,
  type CrashState,
  type DiceAction,
  type DiceState,
  type GameId,
  type HiloAction,
  type HiloState,
  type PokerAction,
  type PokerState,
  type VideoPokerAction,
  type VideoPokerState,
  type KenoAction,
  type KenoState,
  type WheelAction,
  type WheelState,
  type SicBoAction,
  type SicBoState,
  type DragonTigerAction,
  type DragonTigerState,
  type CasinoWarAction,
  type CasinoWarState,
  type RedDogAction,
  type RedDogState,
  type ThreeCardPokerAction,
  type ThreeCardPokerState,
  type AndarBaharAction,
  type AndarBaharState,
  type CaribbeanStudAction,
  type CaribbeanStudState,
  type CasinoHoldemAction,
  type CasinoHoldemState,
  type LetItRideAction,
  type LetItRideState,
  type MississippiStudAction,
  type MississippiStudState,
  type ChuckALuckAction,
  type ChuckALuckState,
  type UltimateTexasHoldemAction,
  type UltimateTexasHoldemState,
  type CrapsAction,
  type CrapsState,
  type MinesAction,
  type MinesState,
  type PlinkoAction,
  type PlinkoState,
  type RouletteAction,
  type RoulettePlacement,
  type RouletteState,
  type Session,
  type SlotsAction,
  type SlotsState,
} from "@/lib/casino";

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls = "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls = "w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";

const SUPPORTED_GAMES: { id: GameId; label: string; hint: string }[] = [
  {
    id: "blackjack",
    label: "Blackjack",
    hint: "Replay deals from the shoe; every hit/stand/double is logged with a state hash.",
  },
  {
    id: "baccarat",
    label: "Baccarat",
    hint: "8-deck shoe with standard third-card tableau; Player vs Banker totals mod 10.",
  },
  {
    id: "coinflip",
    label: "Coinflip",
    hint: "One RNG byte decides the flip; check byte & 1 matches heads/tails.",
  },
  {
    id: "dice",
    label: "Dice / Limbo",
    hint: "Roll in basis points vs your target; win-count table is deterministic from the seed.",
  },
  {
    id: "roulette",
    label: "Roulette",
    hint: "Winning pocket + each placement (straight/split/street/corner/outside) settles from frozen bets.",
  },
  {
    id: "slots",
    label: "Slots",
    hint: "Every spin’s reel stops and line wins replay from the same nonce chain.",
  },
  {
    id: "crash",
    label: "Crash",
    hint: "Bust multiplier is derived from a 52-bit draw; cashout vs bust is in the action log.",
  },
  {
    id: "plinko",
    label: "Plinko",
    hint: "Each peg bounce is one RNG bit; path → bin → multiplier is fully replayable.",
  },
  {
    id: "mines",
    label: "Mines",
    hint: "Mine layout is shuffled once at open; each safe tile pick advances the nonce.",
  },
  {
    id: "hilo",
    label: "HiLo",
    hint: "Card sequence and each higher/lower pick replay with logged probabilities.",
  },
  {
    id: "poker",
    label: "Poker",
    hint: "Deck order, streets, and bot/human actions rebuild the same showdown.",
  },
  {
    id: "video-poker",
    label: "Video Poker",
    hint: "Initial deal + hold mask + draw replacements replay from the shoe.",
  },
  {
    id: "keno",
    label: "Keno",
    hint: "20-number draw without replacement; hits vs your picks are replayable.",
  },
  {
    id: "wheel",
    label: "Money Wheel",
    hint: "Segment index from one RNG draw; landing multiplier vs your bet is replayable.",
  },
  {
    id: "sic-bo",
    label: "Sic Bo",
    hint: "Three dice from three RNG draws; Big/Small/Triple/Total bets replay from the seed.",
  },
  {
    id: "dragon-tiger",
    label: "Dragon Tiger",
    hint: "Two card draws from the shoe; Ace-low rank comparison is replayable.",
  },
  {
    id: "casino-war",
    label: "Casino War",
    hint: "Initial deal plus optional war burn and re-deal replay from the shoe.",
  },
  {
    id: "red-dog",
    label: "Red Dog",
    hint: "Two boundary cards plus optional third draw; spread payout is replayable.",
  },
  {
    id: "three-card-poker",
    label: "Three Card Poker",
    hint: "Six card draws plus fold/play; Queen-Six qualify and 3-card ranks replay.",
  },
  {
    id: "andar-bahar",
    label: "Andar Bahar",
    hint: "Joker draw then alternating piles until rank match; side bet replays.",
  },
  {
    id: "caribbean-stud",
    label: "Caribbean Stud",
    hint: "Ten card draws plus fold/raise; 5-card poker ranks and Ace-King qualify replay.",
  },
  {
    id: "casino-holdem",
    label: "Casino Hold'em",
    hint: "Nine card draws plus fold/call; 7-card best hand and pair-of-4s qualify replay.",
  },
  {
    id: "let-it-ride",
    label: "Let It Ride",
    hint: "Five card draws plus pull/ride; pair-of-10s pay table replay.",
  },
  {
    id: "mississippi-stud",
    label: "Mississippi Stud",
    hint: "Five card draws plus fold/street bets; pair-of-6s pay table replay.",
  },
  {
    id: "chuck-a-luck",
    label: "Chuck-a-Luck",
    hint: "Three dice plus face pick; match-count payout replay.",
  },
  {
    id: "ultimate-texas-holdem",
    label: "Ultimate Texas Hold'em",
    hint: "Nine card draws plus check/play streets; dealer pair qualify replay.",
  },
  {
    id: "craps",
    label: "Craps",
    hint: "Pass-line dice sequence until win/loss; full roll log replay.",
  },
];

type AnyAction =
  | BaccaratAction
  | BlackjackAction
  | CoinflipAction
  | DiceAction
  | RouletteAction
  | SlotsAction
  | CrashAction
  | PlinkoAction
  | MinesAction
  | HiloAction
  | PokerAction
  | VideoPokerAction
  | KenoAction
  | WheelAction
  | SicBoAction
  | DragonTigerAction
  | CasinoWarAction
  | RedDogAction
  | ThreeCardPokerAction
  | AndarBaharAction
  | CaribbeanStudAction
  | CasinoHoldemAction
  | LetItRideAction
  | MississippiStudAction
  | ChuckALuckAction
  | UltimateTexasHoldemAction
  | CrapsAction;
type AnyState =
  | BaccaratState
  | BlackjackState
  | CoinflipState
  | DiceState
  | RouletteState
  | SlotsState
  | CrashState
  | PlinkoState
  | MinesState
  | HiloState
  | PokerState
  | VideoPokerState
  | KenoState
  | WheelState
  | SicBoState
  | DragonTigerState
  | CasinoWarState
  | RedDogState
  | ThreeCardPokerState
  | AndarBaharState
  | CaribbeanStudState
  | CasinoHoldemState
  | LetItRideState
  | MississippiStudState
  | ChuckALuckState
  | UltimateTexasHoldemState
  | CrapsState;

/* ---------------------------------------------------------------------------
 *  Helpers
 * ------------------------------------------------------------------------- */

/**
 * BigInts go through a JSON round-trip in our persisted format as strings.
 * This reviver coerces strings that LOOK like numeric stake values back to
 * bigints so the engine math still works.
 */
function bigIntReviver(_k: string, v: unknown): unknown {
  // We only coerce specific fields known to be bigints. Generic coercion
  // is dangerous (we'd accidentally turn version strings into bigints).
  return v;
}

function fromUrlBase64(b64: string): string | null {
  if (!b64) return null;
  try {
    const pad = b64.replace(/-/g, "+").replace(/_/g, "/");
    return atob(pad);
  } catch {
    return null;
  }
}

function getQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get(name);
}

/**
 * Coerce string bigints in the session payload back to actual bigints
 * (recursively). We only touch known-bigint paths so we don't accidentally
 * corrupt e.g. seed-hash hex strings.
 */
function reviveSession(raw: unknown): Session<AnyAction, AnyState> {
  const tryBig = (s: unknown): bigint => {
    if (typeof s === "bigint") return s;
    if (typeof s === "string" && /^-?\d+$/.test(s)) return BigInt(s);
    if (typeof s === "number") return BigInt(s);
    return 0n;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (!r || typeof r !== "object") throw new Error("Not a session object.");
  r.stake = tryBig(r.stake);

  // state.* bigints
  if (r.state) {
    if (r.state.stake !== undefined) r.state.stake = tryBig(r.state.stake);
    if (r.state.baseStake !== undefined) r.state.baseStake = tryBig(r.state.baseStake);
    if (r.state.totalStaked !== undefined) r.state.totalStaked = tryBig(r.state.totalStaked);
    if (r.state.insuranceStake !== undefined) r.state.insuranceStake = tryBig(r.state.insuranceStake);
    if (Array.isArray(r.state.hands)) {
      for (const h of r.state.hands) h.stake = tryBig(h.stake);
    }
    if (r.state.multiplierNum !== undefined) r.state.multiplierNum = tryBig(r.state.multiplierNum);
    if (r.state.multiplierDen !== undefined) r.state.multiplierDen = tryBig(r.state.multiplierDen);
    if (r.state.payoutNum !== undefined) r.state.payoutNum = tryBig(r.state.payoutNum);
    if (r.state.payoutDen !== undefined) r.state.payoutDen = tryBig(r.state.payoutDen);
    // roulette
    if (r.state.totalStake !== undefined) r.state.totalStake = tryBig(r.state.totalStake);
    if (r.state.totalPayout !== undefined) r.state.totalPayout = tryBig(r.state.totalPayout);
    if (Array.isArray(r.state.placements)) {
      for (const p of r.state.placements) p.amount = tryBig(p.amount);
    }
    if (Array.isArray(r.state.perPlacement)) {
      for (const p of r.state.perPlacement) {
        p.amount = tryBig(p.amount);
        p.payout = tryBig(p.payout);
      }
    }
    // slots
    if (r.state.perLineStake !== undefined) r.state.perLineStake = tryBig(r.state.perLineStake);
    if (Array.isArray(r.state.spins)) {
      for (const sp of r.state.spins) {
        if (sp.totalPayout !== undefined) sp.totalPayout = tryBig(sp.totalPayout);
        if (sp.scatterPayout !== undefined) sp.scatterPayout = tryBig(sp.scatterPayout);
        if (Array.isArray(sp.lineWins)) {
          for (const lw of sp.lineWins) lw.payout = tryBig(lw.payout);
        }
      }
    }
    // crash
    if (r.state.rngDraw !== undefined) r.state.rngDraw = tryBig(r.state.rngDraw);
    // mines
    if (r.state.multiplierMicro !== undefined) r.state.multiplierMicro = tryBig(r.state.multiplierMicro);
  }
  // result.* bigints
  if (r.result) {
    r.result.totalStakedUnits = tryBig(r.result.totalStakedUnits);
    r.result.totalPayoutUnits = tryBig(r.result.totalPayoutUnits);
    r.result.pnlUnits = tryBig(r.result.pnlUnits);
    if (Array.isArray(r.result.breakdown)) {
      for (const b of r.result.breakdown) {
        b.stakedUnits = tryBig(b.stakedUnits);
        b.payoutUnits = tryBig(b.payoutUnits);
        b.pnlUnits = tryBig(b.pnlUnits);
      }
    }
  }
  return r as Session<AnyAction, AnyState>;
}

interface VerifyOutcome {
  hashOk: boolean;
  finalStateMatches: boolean;
  stepMatches: boolean[];
  display?: { label: string; value: string }[];
}

/* ---------------------------------------------------------------------------
 *  Page
 * ------------------------------------------------------------------------- */

export default function VerifyContent() {
  // Initialize from URL if provided.
  const initialFromUrl = useMemo(() => {
    if (typeof window === "undefined") return { json: "", seed: "" };
    const b64 = getQueryParam("session");
    const sessionStr = b64 ? fromUrlBase64(b64) : null;
    const seed = getQueryParam("seed") ?? "";
    return { json: sessionStr ?? "", seed };
  }, []);

  const [sessionJson, setSessionJson] = useState<string>(initialFromUrl.json);
  const [serverSeed, setServerSeed] = useState<string>(initialFromUrl.seed);
  const [error, setError] = useState<string | null>(null);

  /**
   * Parse the session JSON, run the verifier. All-or-nothing so the UI
   * shows useful diagnostics on the first failed step.
   */
  const result = useMemo(() => {
    setError(null);
    if (!sessionJson.trim() || !serverSeed.trim()) return null;
    try {
      const parsed = JSON.parse(sessionJson, bigIntReviver) as unknown;
      const session = reviveSession(parsed);
      const game = pickGame(session.gameId);
      if (!game) throw new Error(`Game "${session.gameId}" not yet supported by this verifier.`);

      const v = verifySession({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        game: game.module as any,
        serverSeed: serverSeed.trim(),
        serverSeedHash: session.serverSeedHash,
        clientSeed: session.clientSeed,
        startNonce: session.startNonce,
        bet: {
          sessionId: session.id,
          userId: session.userId,
          gameId: session.gameId,
          chainId: session.chainId,
          token: session.token,
          stake: session.stake,
          config: configFromSession(session),
        },
        actions: session.actions.map((a) => ({ ordinal: a.ordinal, action: a.action, actor: a.actor })),
        expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
      });

      const outcome: VerifyOutcome = {
        hashOk: v.hashOk,
        finalStateMatches: v.finalStateMatches,
        stepMatches: v.stepMatches,
        display: game.renderState(v.replayedState),
      };
      return { outcome, session };
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [sessionJson, serverSeed]);

  const allOk =
    result &&
    result.outcome.hashOk &&
    result.outcome.finalStateMatches &&
    result.outcome.stepMatches.every(Boolean);

  return (
    <CasinoShell
      badge="Provable fairness"
      title="Verify any hand"
      subtitle="Paste a settled session and the revealed server seed. Your browser re-derives every outcome with HMAC-SHA256 — locally, with zero trust in this site."
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <section className={card + " p-6 space-y-4"}>
          <h2 className="text-lg font-semibold">Inputs</h2>

          <div>
            <label className={labelCls}>Server seed (hex, revealed after seed rotation)</label>
            <input
              type="text"
              className={inputCls + " font-mono"}
              placeholder="64 hex chars — paste the seed you got when you rotated"
              value={serverSeed}
              onChange={(e) => setServerSeed(e.target.value.trim())}
            />
          </div>

          <div>
            <label className={labelCls}>Session JSON</label>
            <textarea
              rows={14}
              spellCheck={false}
              className={inputCls + " font-mono text-[11px] leading-relaxed"}
              placeholder='{"id":"…","gameId":"blackjack","serverSeedHash":"…","clientSeed":"…","actions":[…],"state":{…}}'
              value={sessionJson}
              onChange={(e) => setSessionJson(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2 text-[11px] text-white/40">
              <span>Tip:</span>
              <span>
                In any game table, click <code className="text-emerald-300">verify →</code> on a
                settled hand to get a pre-filled link.
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="text-[11px] text-white/40 leading-relaxed">
            <strong className="text-white/60">Privacy:</strong> Everything happens in your browser.
            The session text and seed never leave this device.
          </div>
        </section>

        {/* Output */}
        <section className={card + " p-6 space-y-4"}>
          <h2 className="text-lg font-semibold">Verification</h2>

          {!result ? (
            <div className="text-[13px] text-white/50">
              Awaiting inputs. Paste both fields on the left to run the replay.
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <CheckRow ok={result.outcome.hashOk} label="SHA-256(server_seed) == published hash" />
                <CheckRow ok={result.outcome.finalStateMatches} label="Replayed final state matches recorded fingerprint" />
                <CheckRow
                  ok={result.outcome.stepMatches.every(Boolean)}
                  label={`All ${result.outcome.stepMatches.length} per-step hashes match`}
                />
              </div>

              <div
                className={
                  "text-center py-3 rounded-lg font-semibold text-lg " +
                  (allOk
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                    : "bg-rose-500/15 text-rose-300 border border-rose-400/30")
                }
              >
                {allOk ? "✓ Verified provably fair" : "✗ Verification failed"}
              </div>

              {result.outcome.display && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-2">
                    Replayed game state
                  </div>
                  <div className="space-y-1.5">
                    {result.outcome.display.map((d, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[12px]"
                      >
                        <span className="text-white/50">{d.label}</span>
                        <span className="font-mono text-white/90 text-right break-all">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[11px] text-white/40 leading-relaxed">
                Replay is fully local — Open DevTools → Sources → see{" "}
                <code className="text-emerald-300">lib/casino/verify.ts</code> for the implementation.
              </div>
            </>
          )}
        </section>
      </div>
      <section className={card + " p-6 mt-10"}>
          <h2 className="text-lg font-semibold mb-3">Supported games</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SUPPORTED_GAMES.map((g) => (
              <div key={g.id} className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-sm font-semibold">{g.label}</div>
                <div className="text-[11px] text-white/40 mt-0.5">{g.id}</div>
                <p className="text-[11px] text-white/55 mt-2 leading-relaxed">{g.hint}</p>
                <div className="text-[11px] text-emerald-300/90 mt-2">
                  Replayed locally via HMAC-SHA256
                </div>
              </div>
            ))}
          </div>
        </section>
    </CasinoShell>
  );
}

/* ---------------------------------------------------------------------------
 *  Game-specific glue
 * ------------------------------------------------------------------------- */

function pickGame(id: string):
  | {
      module:
        | typeof baccaratGame
        | typeof blackjackGame
        | typeof coinflipGame
        | typeof diceGame
        | typeof rouletteGame
        | typeof slotsGame
        | typeof crashGame
        | typeof plinkoGame
        | typeof minesGame
        | typeof hiloGame
        | typeof pokerGame
        | typeof videoPokerGame
        | typeof kenoGame
        | typeof wheelGame
        | typeof sicBoGame
        | typeof dragonTigerGame
        | typeof casinoWarGame
        | typeof redDogGame
        | typeof threeCardPokerGame
        | typeof andarBaharGame
        | typeof caribbeanStudGame
        | typeof casinoHoldemGame
        | typeof letItRideGame
        | typeof mississippiStudGame
        | typeof chuckALuckGame
        | typeof ultimateTexasHoldemGame
        | typeof crapsGame;
      renderState: (s: unknown) => { label: string; value: string }[];
    }
  | null {
  if (id === "blackjack") {
    return {
      module: blackjackGame,
      renderState: (raw: unknown) => {
        const s = raw as BlackjackState;
        return [
          { label: "Dealer", value: s.dealer.map(cardLabel).join(" ") },
          ...s.hands.map((h, i) => ({
            label: `Hand ${i + 1}`,
            value: `${h.cards.map(cardLabel).join(" ")} (${h.busted ? "bust" : h.surrendered ? "surrender" : h.stood ? "stand" : "active"})`,
          })),
        ];
      },
    };
  }
  if (id === "baccarat") {
    return {
      module: baccaratGame,
      renderState: (raw: unknown) => {
        const s = raw as BaccaratState;
        return [
          { label: "Bet", value: s.betSpot },
          { label: "Winner", value: s.winner },
          { label: "Player", value: `${s.playerTotal} — ${formatBaccaratCards(s.playerCards)}` },
          { label: "Banker", value: `${s.bankerTotal} — ${formatBaccaratCards(s.bankerCards)}` },
          { label: "Natural", value: s.natural ? "yes" : "no" },
        ];
      },
    };
  }
  if (id === "coinflip") {
    return {
      module: coinflipGame,
      renderState: (raw: unknown) => {
        const s = raw as CoinflipState;
        return [
          { label: "Called", value: s.prediction },
          { label: "Landed", value: s.result },
          { label: "RNG byte", value: `${s.resultByte} (byte & 1 = ${s.resultByte & 1})` },
        ];
      },
    };
  }
  if (id === "dice") {
    return {
      module: diceGame,
      renderState: (raw: unknown) => {
        const s = raw as DiceState;
        return [
          { label: "Roll", value: (s.rollBps / 100).toFixed(2) },
          { label: "Target", value: `${(s.targetBps / 100).toFixed(2)} (${s.direction})` },
          { label: "Won", value: s.won ? "yes" : "no" },
          { label: "Win count / 10000", value: String(s.winCount) },
        ];
      },
    };
  }
  if (id === "roulette") {
    return {
      module: rouletteGame,
      renderState: (raw: unknown) => {
        const s = raw as RouletteState;
        const rows: { label: string; value: string }[] = [
          { label: "Winning pocket", value: String(s.pocket) },
          { label: "Winning color", value: s.pocketColor },
          { label: "Total stake", value: String(s.totalStake) },
          { label: "Total payout", value: String(s.totalPayout) },
        ];
        for (let i = 0; i < (s.perPlacement?.length ?? 0); i++) {
          const p = s.perPlacement[i];
          rows.push({
            label: `Placement ${i + 1}`,
            value: `${describePlacement(p as unknown as RoulettePlacement)} — stake ${p.amount}, payout ${p.payout} (${p.won ? "win" : "loss"})`,
          });
        }
        return rows;
      },
    };
  }
  if (id === "slots") {
    return {
      module: slotsGame,
      renderState: (raw: unknown) => {
        const s = raw as SlotsState;
        const rows: { label: string; value: string }[] = [
          { label: "Total stake", value: String(s.totalStake) },
          { label: "Total payout", value: String(s.totalPayout) },
          { label: "Spins played", value: String(s.spins.length) },
          {
            label: "Free spins",
            value: s.freeSpinsTriggered ? `Yes (${s.freeSpinsPlayed})` : "No",
          },
        ];
        for (let i = 0; i < s.spins.length; i++) {
          const sp = s.spins[i];
          const gridLine = sp.grid
            .map((row) => row.map((sym) => SYMBOL_GLYPH[sym]).join(""))
            .join(" / ");
          rows.push({
            label: `Spin ${i + 1}${sp.isFree ? " (free)" : ""}`,
            value: `stops [${sp.stops.join(",")}] · ${sp.lineWins.length} line wins · ${sp.scatterCount} scatters · payout ${sp.totalPayout} · grid: ${gridLine}`,
          });
        }
        return rows;
      },
    };
  }
  if (id === "plinko") {
    return {
      module: plinkoGame,
      renderState: (raw: unknown) => {
        const s = raw as PlinkoState;
        return [
          { label: "Rows", value: String(s.config.rows) },
          { label: "Risk", value: s.config.risk },
          { label: "Bin", value: `${s.bin} / ${s.config.rows}` },
          { label: "Multiplier", value: `${s.multiplier.toFixed(2)}×` },
          { label: "Path", value: s.path.map((b) => (b ? "R" : "L")).join("") },
        ];
      },
    };
  }
  if (id === "mines") {
    return {
      module: minesGame,
      renderState: (raw: unknown) => {
        const s = raw as MinesState;
        return [
          { label: "Outcome", value: s.phase },
          { label: "Mines", value: `${s.config.mines} / 25` },
          { label: "Safe picks", value: String(s.picks) },
          { label: "Multiplier", value: `${s.multiplier.toFixed(2)}×` },
          { label: "Mine layout", value: s.mineLayout.join(", ") },
          { label: "Revealed (order)", value: s.revealed.join(", ") || "—" },
          { label: "Hit mine", value: s.hitMine === null ? "—" : `tile ${s.hitMine}` },
        ];
      },
    };
  }
  if (id === "poker") {
    return {
      module: pokerGame,
      renderState: (raw: unknown) => {
        const s = raw as PokerState;
        return [
          { label: "Phase", value: s.phase },
          { label: "Pot", value: String(s.pot) },
          { label: "Community", value: s.community.map(cardLabel).join(" ") || "—" },
          ...s.players.map((p) => ({
            label: p.name,
            value: `${p.hole.map(cardLabel).join(" ")} · stack ${p.stack}`,
          })),
        ];
      },
    };
  }
  if (id === "video-poker") {
    return {
      module: videoPokerGame,
      renderState: (raw: unknown) => {
        const s = raw as VideoPokerState;
        const holdStr = s.hold ? s.hold.map((h) => (h ? "H" : "—")).join("") : "—";
        return [
          { label: "Hand", value: s.handLabel ?? "—" },
          { label: "Pay", value: `${s.payMultiplier}×` },
          { label: "Hold mask", value: holdStr },
          { label: "Cards", value: formatBaccaratCards(s.cards) },
        ];
      },
    };
  }
  if (id === "keno") {
    return {
      module: kenoGame,
      renderState: (raw: unknown) => {
        const s = raw as KenoState;
        return [
          { label: "Hits", value: `${s.hits} / ${s.picks.length}` },
          { label: "Pay", value: `${s.payMultiplier}×` },
          { label: "Picks", value: s.picks.join(", ") },
          { label: "Drawn", value: s.drawn.join(", ") },
        ];
      },
    };
  }
  if (id === "wheel") {
    return {
      module: wheelGame,
      renderState: (raw: unknown) => {
        const s = raw as WheelState;
        return [
          { label: "Bet on", value: `${s.betOn}×` },
          { label: "Landed", value: `${s.landedMult}×` },
          { label: "Segment", value: `#${s.segmentIndex + 1}` },
          { label: "Outcome", value: s.won ? "win" : "loss" },
        ];
      },
    };
  }
  if (id === "sic-bo") {
    return {
      module: sicBoGame,
      renderState: (raw: unknown) => {
        const s = raw as SicBoState;
        return [
          { label: "Bet", value: sicBoBetLabel(s.betType, s.betValue) },
          { label: "Dice", value: s.dice.join(" · ") },
          { label: "Sum", value: String(s.sum) },
          { label: "Outcome", value: s.won ? `${s.payReturnMult}×` : "loss" },
        ];
      },
    };
  }
  if (id === "dragon-tiger") {
    return {
      module: dragonTigerGame,
      renderState: (raw: unknown) => {
        const s = raw as DragonTigerState;
        return [
          { label: "Bet", value: s.betSpot },
          { label: "Winner", value: s.winner },
          { label: "Dragon", value: `${s.dragonRank} — ${cardLabel(s.dragonCard)}` },
          { label: "Tiger", value: `${s.tigerRank} — ${cardLabel(s.tigerCard)}` },
        ];
      },
    };
  }
  if (id === "casino-war") {
    return {
      module: casinoWarGame,
      renderState: (raw: unknown) => {
        const s = raw as CasinoWarState;
        return [
          { label: "You", value: cardLabel(s.playerCard) },
          { label: "Dealer", value: cardLabel(s.dealerCard) },
          { label: "Resolution", value: s.resolution ?? "tie choice" },
          {
            label: "War",
            value:
              s.warPlayerCard && s.warDealerCard
                ? `${cardLabel(s.warPlayerCard)} vs ${cardLabel(s.warDealerCard)}`
                : "—",
          },
        ];
      },
    };
  }
  if (id === "red-dog") {
    return {
      module: redDogGame,
      renderState: (raw: unknown) => {
        const s = raw as RedDogState;
        return [
          { label: "1st", value: cardLabel(s.card1) },
          { label: "2nd", value: cardLabel(s.card2) },
          { label: "3rd", value: s.card3 ? cardLabel(s.card3) : "—" },
          { label: "Spread", value: String(s.spread) },
          { label: "Outcome", value: s.pushed ? "push" : s.won ? "win" : "loss" },
        ];
      },
    };
  }
  if (id === "three-card-poker") {
    return {
      module: threeCardPokerGame,
      renderState: (raw: unknown) => {
        const s = raw as ThreeCardPokerState;
        return [
          { label: "You", value: formatThreeCardHand(s.playerCards) },
          { label: "Dealer", value: formatThreeCardHand(s.dealerCards) },
          {
            label: "Hands",
            value:
              s.playerScore && s.dealerScore
                ? `${threeCardHandLabel(s.playerScore)} vs ${threeCardHandLabel(s.dealerScore)}`
                : "—",
          },
          { label: "Outcome", value: s.outcome ?? "—" },
        ];
      },
    };
  }
  if (id === "andar-bahar") {
    return {
      module: andarBaharGame,
      renderState: (raw: unknown) => {
        const s = raw as AndarBaharState;
        return [
          { label: "Joker", value: cardLabel(s.jokerCard) },
          { label: "Bet", value: s.betSide },
          { label: "Winner", value: s.winner },
          { label: "Cards", value: `${s.andarCards.length} Andar · ${s.baharCards.length} Bahar` },
        ];
      },
    };
  }
  if (id === "caribbean-stud") {
    return {
      module: caribbeanStudGame,
      renderState: (raw: unknown) => {
        const s = raw as CaribbeanStudState;
        return [
          { label: "You", value: formatCaribbeanStudHand(s.playerCards) },
          { label: "Dealer", value: formatCaribbeanStudHand(s.dealerCards) },
          {
            label: "Hands",
            value:
              s.playerScore && s.dealerScore
                ? `${describeScore(s.playerScore)} vs ${describeScore(s.dealerScore)}`
                : "—",
          },
          { label: "Outcome", value: s.outcome ?? "—" },
        ];
      },
    };
  }
  if (id === "casino-holdem") {
    return {
      module: casinoHoldemGame,
      renderState: (raw: unknown) => {
        const s = raw as CasinoHoldemState;
        return [
          { label: "You", value: formatCasinoHoldemCards(s.playerHole) },
          { label: "Board", value: formatCasinoHoldemCards(s.board) },
          { label: "Dealer", value: formatCasinoHoldemCards(s.dealerHole) },
          {
            label: "Hands",
            value:
              s.playerScore && s.dealerScore
                ? `${describeScore(s.playerScore)} vs ${describeScore(s.dealerScore)}`
                : "—",
          },
          { label: "Outcome", value: s.outcome ?? "—" },
        ];
      },
    };
  }
  if (id === "let-it-ride") {
    return {
      module: letItRideGame,
      renderState: (raw: unknown) => {
        const s = raw as LetItRideState;
        return [
          { label: "You", value: formatLetItRideCards(s.playerCards) },
          { label: "Board", value: formatLetItRideCards(s.community) },
          {
            label: "Bets riding",
            value: `${s.bet1Active ? "1" : "—"} · ${s.bet2Active ? "2" : "—"} · ${s.bet3Active ? "3" : "—"}`,
          },
          { label: "Hand", value: s.handScore ? describeScore(s.handScore) : "—" },
        ];
      },
    };
  }
  if (id === "mississippi-stud") {
    return {
      module: mississippiStudGame,
      renderState: (raw: unknown) => {
        const s = raw as MississippiStudState;
        return [
          { label: "Hand", value: formatMississippiStudCards(s.playerCards) },
          {
            label: "Streets",
            value: `${s.streetBet1 > 0n ? "1×" : "—"} · ${s.streetBet2 > 0n ? "2×" : "—"} · ${s.streetBet3 > 0n ? "3×" : "—"}`,
          },
          { label: "Outcome", value: s.outcome ?? "—" },
          { label: "Score", value: s.handScore ? describeScore(s.handScore) : "—" },
        ];
      },
    };
  }
  if (id === "chuck-a-luck") {
    return {
      module: chuckALuckGame,
      renderState: (raw: unknown) => {
        const s = raw as ChuckALuckState;
        return [
          { label: "Pick", value: String(s.pick) },
          { label: "Dice", value: s.dice.join("-") },
          { label: "Hits", value: String(s.matchCount) },
          { label: "Return", value: s.won ? `${s.payReturnMult}×` : "loss" },
        ];
      },
    };
  }
  if (id === "ultimate-texas-holdem") {
    return {
      module: ultimateTexasHoldemGame,
      renderState: (raw: unknown) => {
        const s = raw as UltimateTexasHoldemState;
        return [
          { label: "You", value: formatUltimateHoldemCards(s.playerHole) },
          { label: "Board", value: formatUltimateHoldemCards(s.board) },
          { label: "Dealer", value: formatUltimateHoldemCards(s.dealerHole) },
          {
            label: "Hands",
            value:
              s.playerScore && s.dealerScore
                ? `${describeScore(s.playerScore)} vs ${describeScore(s.dealerScore)}`
                : "—",
          },
          { label: "Outcome", value: s.outcome ?? "—" },
        ];
      },
    };
  }
  if (id === "craps") {
    return {
      module: crapsGame,
      renderState: (raw: unknown) => {
        const s = raw as CrapsState;
        return [
          { label: "Bet", value: "Pass line" },
          { label: "Rolls", value: s.rolls.map(formatCrapsRoll).join(" → ") },
          { label: "Point", value: s.point != null ? String(s.point) : "—" },
          { label: "Outcome", value: s.outcome },
        ];
      },
    };
  }
  if (id === "hilo") {
    return {
      module: hiloGame,
      renderState: (raw: unknown) => {
        const s = raw as HiloState;
        const cardSeq = s.revealedHistory
          .map((idx) => {
            const c = cardFromIndex(idx);
            return `${c.rank}${c.suit}`;
          })
          .join(" → ");
        const pickSeq = s.picks
          .map(
            (p) =>
              `${p.direction === "higher" ? "↑" : "↓"}${p.won ? "W" : "L"}@${(p.probability * 100).toFixed(1)}%`,
          )
          .join("  ");
        return [
          { label: "Outcome", value: s.phase },
          { label: "Picks", value: String(s.picks.length) },
          { label: "Multiplier", value: `${s.multiplier.toFixed(2)}×` },
          { label: "Card sequence", value: cardSeq },
          { label: "Pick sequence", value: pickSeq || "—" },
        ];
      },
    };
  }
  if (id === "crash") {
    return {
      module: crashGame,
      renderState: (raw: unknown) => {
        const s = raw as CrashState;
        const phase = s.phase;
        const exit = s.exitMultiplier;
        return [
          { label: "Bust point", value: `${s.bustAt.toFixed(4)}×` },
          {
            label: "Auto-cashout",
            value: s.autoCashoutMultiplier !== null ? `${s.autoCashoutMultiplier.toFixed(2)}×` : "—",
          },
          {
            label: "Outcome",
            value:
              phase === "cashed_out"
                ? `cashed_out @ ${exit?.toFixed(2)}×`
                : phase === "busted"
                  ? `busted @ ${s.bustAt.toFixed(2)}×`
                  : phase,
          },
          { label: "RNG draw (52-bit)", value: s.rngDraw.toString() },
        ];
      },
    };
  }
  return null;
}

function configFromSession(session: Session<AnyAction, AnyState>): Record<string, unknown> {
  const s = session.state as AnyState;
  if (session.gameId === "blackjack") {
    return (s as BlackjackState).config as unknown as Record<string, unknown>;
  }
  if (session.gameId === "baccarat") {
    const bs = s as BaccaratState;
    return { betSpot: bs.betSpot, numDecks: bs.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "coinflip") {
    const cs = s as CoinflipState;
    return { ...cs.config, prediction: cs.prediction } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "dice") {
    const ds = s as DiceState;
    return { ...ds.config, targetBps: ds.targetBps, direction: ds.direction } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "roulette") {
    const rs = s as RouletteState;
    return { ...rs.config, placements: rs.placements } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "slots") {
    // Slots config goes through `bet.config.config` per the slots engine's
    // buildConfig contract — wrap it so the verifier rebuilds the same setup.
    const ss = s as SlotsState;
    return { config: ss.config } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "crash") {
    const cs = s as CrashState;
    return {
      ...cs.config,
      autoCashoutMultiplier: cs.autoCashoutMultiplier,
    } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "plinko") {
    const ps = s as PlinkoState;
    return {
      rows: ps.config.rows,
      risk: ps.config.risk,
    } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "mines") {
    const ms = s as MinesState;
    return {
      mines: ms.config.mines,
      houseEdgeBps: ms.config.houseEdgeBps,
    } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "hilo") {
    const hs = s as HiloState;
    return {
      houseEdgeBps: hs.config.houseEdgeBps,
    } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "poker") {
    const ps = s as PokerState;
    return { bigBlind: ps.config.bigBlind, rakeBps: ps.config.rakeBps } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "video-poker") {
    const vs = s as VideoPokerState;
    return { numDecks: vs.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "keno") {
    const ks = s as KenoState;
    return { picks: ks.picks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "wheel") {
    const ws = s as WheelState;
    return { betOn: ws.betOn } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "sic-bo") {
    const ss = s as SicBoState;
    return { betType: ss.betType, betValue: ss.betValue } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "dragon-tiger") {
    const dt = s as DragonTigerState;
    return { betSpot: dt.betSpot, numDecks: dt.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "casino-war") {
    const cw = s as CasinoWarState;
    return { numDecks: cw.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "red-dog") {
    const rd = s as RedDogState;
    return { numDecks: rd.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "three-card-poker") {
    const tp = s as ThreeCardPokerState;
    return { numDecks: tp.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "andar-bahar") {
    const ab = s as AndarBaharState;
    return { betSide: ab.betSide, numDecks: ab.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "caribbean-stud") {
    const cs = s as CaribbeanStudState;
    return { numDecks: cs.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "casino-holdem") {
    const ch = s as CasinoHoldemState;
    return { numDecks: ch.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "let-it-ride") {
    const lir = s as LetItRideState;
    return { numDecks: lir.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "mississippi-stud") {
    const ms = s as MississippiStudState;
    return { numDecks: ms.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "chuck-a-luck") {
    const cal = s as ChuckALuckState;
    return { pick: cal.pick } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "ultimate-texas-holdem") {
    const uth = s as UltimateTexasHoldemState;
    return { numDecks: uth.config.numDecks } as unknown as Record<string, unknown>;
  }
  if (session.gameId === "craps") {
    const cr = s as CrapsState;
    return { betType: cr.betType } as unknown as Record<string, unknown>;
  }
  return {};
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={
          "w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold " +
          (ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")
        }
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-white/80" : "text-rose-200"}>{label}</span>
    </div>
  );
}
