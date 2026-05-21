"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cardLabel,
  casinoWarGame,
  casinoWarRtpLabel,
  newSessionId,
  persistSettledSession,
  type Card,
  type CasinoWarAction,
  type CasinoWarState,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnDanger, btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

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

const LAST_BET_KEY = "mf_casino_war_bet";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function CardTile({ c, title, sub }: { c: Card; title: string; sub?: string }) {
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-white/45">{title}</span>
      <div
        className={
          "w-14 h-20 rounded-lg border border-white/15 flex flex-col items-center justify-center font-mono " +
          (red ? "text-rose-300" : "text-white")
        }
      >
        <span className="text-xl font-bold">{c.rank}</span>
        <span className="text-lg">{c.suit}</span>
      </div>
      {sub && <span className="text-[10px] text-white/50">{sub}</span>}
    </div>
  );
}

export default function CasinoWarTable({ chainId, token }: Props) {
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
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
  }, [betAmount]);

  const [session, setSession] = useState<Session<CasinoWarAction, CasinoWarState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<CasinoWarAction, CasinoWarState> | null>(null);

  const st = session?.state ?? null;
  const inRound = st !== null && !casinoWarGame.isTerminal(st);
  const needsTieChoice = st?.phase === "tie_choice";

  const finishRound = useCallback(
    async (s: Session<CasinoWarAction, CasinoWarState>) => {
      const settled = await driver.settleSession(casinoWarGame, s);
      setSession(settled);
      pushHistory({
        game: "casino-war",
        stakeUnits: settled.result!.totalStakedUnits,
        pnlUnits: settled.result!.pnlUnits,
        multiplier:
          Number(settled.result!.totalPayoutUnits) / Math.max(1, Number(settled.result!.totalStakedUnits)),
        session: settled as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(settled as unknown as Parameters<typeof persistSettledSession>[0], getSeedPair());
      await refreshBalance();
      return settled;
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  const deal = useCallback(async () => {
    setError(null);
    if (inRound) {
      setError("Finish the current hand first");
      return;
    }
    const stake = humanToUnits(betAmount, token);
    if (stake <= 0n) {
      setError("Bet must be > 0");
      return;
    }
    if (balance.available < stake) {
      setError("Insufficient balance");
      return;
    }
    setBusy(true);
    try {
      let s = await driver.openSession(casinoWarGame, {
        sessionId: newSessionId(),
        userId,
        gameId: casinoWarGame.id,
        chainId,
        token,
        stake,
        config: {},
      });
      setSession(s);
      if (casinoWarGame.isTerminal(s.state)) {
        await finishRound(s);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, finishRound, inRound, token, userId]);

  const onWar = useCallback(async () => {
    if (!session || session.state.phase !== "tie_choice") return;
    setError(null);
    setBusy(true);
    try {
      const extra = session.stake;
      if (balance.available < extra) {
        setError("Insufficient balance for war bet");
        return;
      }
      let s = (await driver.applyAction(casinoWarGame, session, { type: "war" }, extra)) as Session<
        CasinoWarAction,
        CasinoWarState
      >;
      setSession(s);
      await finishRound(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, driver, finishRound, session]);

  const onSurrender = useCallback(async () => {
    if (!session || session.state.phase !== "tie_choice") return;
    setError(null);
    setBusy(true);
    try {
      let s = (await driver.applyAction(casinoWarGame, session, {
        type: "surrender",
      })) as Session<CasinoWarAction, CasinoWarState>;
      setSession(s);
      await finishRound(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [driver, finishRound, session]);

  const clearHand = () => {
    setSession(null);
    setVerifyTarget(null);
  };

  const seedPair = getSeedPair();
  const settled = session?.status === "settled" && !!session.result;

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Casino War</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {casinoWarRtpLabel()}
            </span>
          </div>

          {st && (
            <div className="flex justify-center gap-6 sm:gap-10 flex-wrap">
              <CardTile c={st.playerCard} title="You" />
              <CardTile c={st.dealerCard} title="Dealer" />
            </div>
          )}

          {st?.warPlayerCard && st.warDealerCard && (
            <div className="space-y-2">
              <p className="text-center text-[10px] uppercase tracking-wider text-white/40">War cards</p>
              <div className="flex justify-center gap-6">
                <CardTile c={st.warPlayerCard} title="You" sub="war" />
                <CardTile c={st.warDealerCard} title="Dealer" sub="war" />
              </div>
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-4">
              Ace high · tie = war (match bet) or surrender half
            </p>
          )}

          {needsTieChoice && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 space-y-3">
              <p className="text-sm text-amber-100 text-center font-medium">
                Tie on {cardLabel(st.playerCard)} — go to war or surrender?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onWar()}
                  className={btnPrimary + " w-full"}
                >
                  War (+{fmtMoney(session!.stake, token)})
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSurrender()}
                  className={btnDanger + " w-full"}
                >
                  Surrender (half back)
                </button>
              </div>
            </div>
          )}

          {!needsTieChoice && (
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
                  disabled={busy || inRound}
                />
              </div>
              {!inRound ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deal()}
                  className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
                >
                  {busy ? "Dealing…" : "Deal"}
                </button>
              ) : null}
            </div>
          )}

          {settled && session?.result && (
            <>
              <p
                className={
                  "text-center text-sm font-mono " +
                  (session.result.pnlUnits > 0n
                    ? "text-emerald-300"
                    : session.result.pnlUnits < 0n
                      ? "text-rose-300"
                      : "text-white/60")
                }
              >
                {session.result.pnlUnits > 0n ? "+" : ""}
                {fmtMoney(session.result.pnlUnits, token)}
              </p>
              <button type="button" onClick={clearHand} className={btnGhost + " w-full sm:w-auto mx-auto block"}>
                New hand
              </button>
            </>
          )}

          {error && <p className="text-sm text-rose-300">{error}</p>}
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
            {settled && session && (
              <button
                type="button"
                onClick={() => setVerifyTarget(session)}
                className="mt-2 text-xs text-emerald-300 hover:text-emerald-200 w-full text-left cursor-pointer"
              >
                Verify →
              </button>
            )}
          </section>
        </aside>
      </div>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Casino War · verify hand"
          description="Replay the deal, optional war burn and re-deal from the revealed seed."
          session={verifyTarget as Session<unknown, CasinoWarState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(casinoWarGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "casino-war",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="You" value={cardLabel(verifyTarget.state.playerCard)} />
              <VerifyField label="Dealer" value={cardLabel(verifyTarget.state.dealerCard)} />
              <VerifyField label="Outcome" value={verifyTarget.state.resolution ?? "—"} />
            </>
          }
        />
      )}
    </div>
  );
}
