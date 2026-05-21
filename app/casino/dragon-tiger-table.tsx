"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  dragonTigerGame,
  dragonTigerRtpLabel,
  newSessionId,
  persistSettledSession,
  type Card,
  type ChainAdapter,
  type ChainId,
  type DragonTigerAction,
  type DragonTigerSpot,
  type DragonTigerState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnPrimary, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  return Number(`${units / denom}.${(units % denom).toString().padStart(token.decimals, "0")}`);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}

function fmtMoney(units: bigint, token: TokenSpec): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token.symbol}`;
}

const LAST_BET_KEY = "mf_casino_dt_bet";
const LAST_SPOT_KEY = "mf_casino_dt_spot";

const SPOTS: { id: DragonTigerSpot; label: string; hint: string; accent: string }[] = [
  { id: "dragon", label: "Dragon", hint: "1:1 · half on tie", accent: "from-rose-600/30 to-rose-900/20 border-rose-400/40" },
  { id: "tiger", label: "Tiger", hint: "1:1 · half on tie", accent: "from-amber-600/30 to-amber-900/20 border-amber-400/40" },
  { id: "tie", label: "Tie", hint: "11:1", accent: "from-violet-600/25 to-violet-900/15 border-violet-400/35" },
];

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function CardFace({ c, title, highlight }: { c: Card; title: string; highlight: boolean }) {
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        "rounded-2xl border-2 p-4 flex flex-col items-center gap-2 transition-all " +
        (highlight
          ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_24px_rgba(16,185,129,0.2)]"
          : "border-white/10 bg-white/[0.04]")
      }
    >
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/45">{title}</span>
      <div
        className={
          "w-16 h-24 sm:w-20 sm:h-28 rounded-xl border border-white/15 bg-white/[0.08] flex flex-col items-center justify-center font-mono " +
          (red ? "text-rose-300" : "text-white")
        }
      >
        <span className="text-2xl sm:text-3xl font-bold">{c.rank}</span>
        <span className="text-xl sm:text-2xl">{c.suit}</span>
      </div>
      <span className="text-xs text-white/50">{cardLabel(c)}</span>
    </div>
  );
}

export default function DragonTigerTable({ chainId, token }: Props) {
  const {
    driver,
    getSeedPair,
    rotateSeed,
    balance,
    refreshBalance,
    pushHistory,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();
  const userId = getSeedPair().userId;

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LAST_BET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  const [spot, setSpot] = useState<DragonTigerSpot>(() => {
    if (typeof window === "undefined") return "dragon";
    const s = window.localStorage.getItem(LAST_SPOT_KEY);
    return s === "tiger" || s === "tie" ? s : "dragon";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SPOT_KEY, spot);
  }, [betAmount, spot]);

  const [dealing, setDealing] = useState(false);
  const [lastSession, setLastSession] = useState<Session<DragonTigerAction, DragonTigerState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<DragonTigerAction, DragonTigerState> | null>(null);

  const deal = useCallback(async () => {
    setError(null);
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake) {
      setError("Insufficient balance");
      return;
    }
    setDealing(true);
    try {
      let s = await driver.openSession(dragonTigerGame, {
        sessionId: newSessionId(),
        userId,
        gameId: dragonTigerGame.id,
        chainId,
        token,
        stake,
        config: { betSpot: spot },
      });
      s = await driver.settleSession(dragonTigerGame, s);
      await new Promise((r) => setTimeout(r, 500));
      setLastSession(s);
      pushHistory({
        game: "dragon-tiger",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier:
          Number(s.result!.totalPayoutUnits) / Math.max(1, Number(s.result!.totalStakedUnits)),
        session: s as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(s as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDealing(false);
    }
  }, [balance.available, betAmount, chainId, driver, getSeedPair, pushHistory, refreshBalance, spot, token, userId]);

  const seedPair = getSeedPair();
  const st = lastSession?.state;

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Dragon Tiger</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {dragonTigerRtpLabel(spot)}
            </span>
          </div>

          {st ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-6 max-w-md mx-auto">
              <CardFace
                c={st.dragonCard}
                title="Dragon"
                highlight={st.winner === "dragon"}
              />
              <CardFace
                c={st.tigerCard}
                title="Tiger"
                highlight={st.winner === "tiger"}
              />
            </div>
          ) : (
            <p className="text-sm text-white/45 text-center py-6">
              Highest card wins — Ace low, King high. Tie returns half on Dragon/Tiger bets.
            </p>
          )}

          {st?.winner === "tie" && (
            <p className="text-center text-sm text-violet-200/90 font-medium">
              Tie — both {st.dragonRank}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {SPOTS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={dealing}
                onClick={() => setSpot(s.id)}
                className={
                  "min-h-[72px] touch-manipulation rounded-xl border p-3 text-left transition-all cursor-pointer disabled:opacity-50 bg-gradient-to-br " +
                  s.accent +
                  " " +
                  (spot === s.id ? "ring-2 ring-amber-400/50" : "opacity-90 hover:opacity-100")
                }
              >
                <div className="text-sm font-semibold text-white">{s.label}</div>
                <div className="text-[10px] text-white/55 mt-0.5">{s.hint}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1 min-w-0">
              <label className={labelCls}>Bet ({token.symbol})</label>
              <input
                type="number"
                min="0"
                step="any"
                className={inputCls}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                disabled={dealing}
              />
            </div>
            <button
              type="button"
              disabled={dealing}
              onClick={() => void deal()}
              className={btnPrimary + " w-full sm:w-auto sm:min-w-[140px]"}
            >
              {dealing ? "Dealing…" : "Deal"}
            </button>
          </div>

          {error && <p className="text-sm text-rose-300">{error}</p>}

          {lastSession?.result && (
            <p
              className={
                "text-center text-sm font-mono " +
                (lastSession.result.pnlUnits > 0n
                  ? "text-emerald-300"
                  : lastSession.result.pnlUnits < 0n
                    ? "text-rose-300"
                    : "text-white/60")
              }
            >
              {lastSession.result.pnlUnits > 0n ? "+" : ""}
              {fmtMoney(lastSession.result.pnlUnits, token)}
            </p>
          )}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnSecondary + " w-full !text-xs"}>
              Rotate seed
            </button>
            {lastSession && (
              <button
                type="button"
                onClick={() => setVerifyTarget(lastSession)}
                className="mt-2 text-xs text-emerald-300 hover:text-emerald-200 w-full text-left cursor-pointer"
              >
                Verify last hand →
              </button>
            )}
          </section>
        </aside>
      </div>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Dragon Tiger · verify hand"
          description="Replay two card draws from the 8-deck shoe."
          session={verifyTarget as Session<unknown, DragonTigerState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(dragonTigerGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "dragon-tiger",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {
                betSpot: verifyTarget.state.betSpot,
                numDecks: verifyTarget.state.config.numDecks,
              },
            })
          }
          extraFields={
            <>
              <VerifyField label="Your bet" value={verifyTarget.state.betSpot} />
              <VerifyField label="Winner" value={verifyTarget.state.winner} />
              <VerifyField
                label="Dragon"
                value={`${verifyTarget.state.dragonRank} — ${cardLabel(verifyTarget.state.dragonCard)}`}
              />
              <VerifyField
                label="Tiger"
                value={`${verifyTarget.state.tigerRank} — ${cardLabel(verifyTarget.state.tigerCard)}`}
              />
            </>
          }
        />
      )}
    </div>
  );
}
