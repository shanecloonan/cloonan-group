"use client";

/* ===========================================================================
 *  /casino — HiLo table
 *  ---------------------------------------------------------------------------
 *  Card-based crypto-casino classic. Guess whether the next card will be
 *  HIGHER-OR-SAME or LOWER-OR-SAME than the visible card. Each correct
 *  pick compounds the multiplier by `0.99 / p`; one wrong guess ends at 0×.
 *  Cash out anytime after at least one pick.
 *
 *  Provable fairness: each card is an independent unbiased draw from the
 *  full 52-card deck, driven by HMAC-SHA256(server_seed, client_seed:nonce).
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cardFromIndex,
  hiloGame,
  hiloMultiplierStep,
  hiloWinProbability,
  newSessionId,
  persistSettledSession,
  rankIndexOf,
  rankLabelOf,
  type Card,
  type ChainAdapter,
  type ChainId,
  type HiloAction,
  type HiloDirection,
  type HiloState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { ShareLinkRow } from "./share-link";
import { btnDanger, btnGhost, btnGold, btnPrimary, card, inputCls, labelCls } from "./casino-ui";
import {
  DevQuickTopUpBar,
  ErrorBanner,
  FairnessCard,
  RevealedSeedCard,
  fmtMoney as fmtMoneyKit,
  humanToUnits,
  InstantSideLayout,
  SettlementBanner,
  unitsToHuman,
} from "./table-kit";

const fmtMoney = (units: bigint, token: TokenSpec, digits = 2) => fmtMoneyKit(units, token, digits);

const LS_BET = "mf_casino_hilo_bet";

/* ===========================================================================
 *  Table
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

interface AutoConfig {
  rounds: number;
  pickCount: number;
  direction: HiloDirection;
  onLossMultiplier: number;
  stopOnProfit: number;
  stopOnLoss: number;
}
const DEFAULT_AUTO: AutoConfig = {
  rounds: 25,
  pickCount: 1,
  direction: "higher",
  onLossMultiplier: 1,
  stopOnProfit: 0,
  stopOnLoss: 0,
};

export default function HiloTable({ chainId, token }: Props) {
  const {
    driver,
    ledger,
    getSeedPair,
    rotateSeed,
    balance,
    refreshBalance,
    pushHistory,
    depositPlayMoney,
    lastRevealedSeed,
    dismissRevealedSeed,
    persistent,
  } = useCasino();
  const userId = getSeedPair().userId;

  /* ----- Persisted controls --------------------------------------------- */

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 10;
    const v = Number(window.localStorage.getItem(LS_BET));
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(LS_BET, String(betAmount));
  }, [betAmount]);

  /* ----- Live round state ----------------------------------------------- */

  const [session, setSession] = useState<Session<HiloAction, HiloState> | null>(null);
  const [history, setHistory] = useState<Session<HiloAction, HiloState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Session<HiloAction, HiloState> | null>(null);
  /** Briefly flash the just-revealed card on each pick (for animation). */
  const [flash, setFlash] = useState<"win" | "loss" | null>(null);

  const liveState = session?.state ?? null;
  const inRound = liveState !== null && !hiloGame.isTerminal(liveState);
  const terminal = liveState !== null && hiloGame.isTerminal(liveState);
  const currentCardIdx = liveState?.currentCardIndex ?? null;
  const currentRank = currentCardIdx === null ? null : rankIndexOf(currentCardIdx);

  /* ----- Live probabilities + next-pick multipliers --------------------- */

  const livePreview = useMemo(() => {
    if (currentRank === null) return null;
    const pHigher = hiloWinProbability("higher", currentRank);
    const pLower = hiloWinProbability("lower", currentRank);
    const mHigher = hiloMultiplierStep(pHigher);
    const mLower = hiloMultiplierStep(pLower);
    const liveMult = liveState?.multiplier ?? 1.0;
    return {
      pHigher,
      pLower,
      // multiplier *after* a winning pick of each direction.
      nextHigher: liveMult * mHigher,
      nextLower: liveMult * mLower,
      stepHigher: mHigher,
      stepLower: mLower,
    };
  }, [currentRank, liveState]);

  /* ----- Deal: open a new session --------------------------------------- */

  const deal = useCallback(
    async (override?: { stake?: bigint }) => {
      setError(null);
      try {
        if (session && !hiloGame.isTerminal(session.state)) {
          throw new Error("Finish or cash out the current round first");
        }
        const stake = override?.stake ?? humanToUnits(betAmount, token);
        if (stake <= 0n) throw new Error("Bet must be > 0");
        if (balance.available < stake) throw new Error("Insufficient balance");
        setBusy(true);
        const s = await driver.openSession(hiloGame, {
          sessionId: newSessionId(),
          userId,
          gameId: hiloGame.id,
          chainId,
          token,
          stake,
          config: {} as Record<string, unknown>,
        });
        setSession(s);
        setFlash(null);
        await refreshBalance();
        return s;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [balance.available, betAmount, chainId, driver, refreshBalance, session, token, userId],
  );

  /* ----- Make a guess --------------------------------------------------- */

  const guess = useCallback(
    async (direction: HiloDirection) => {
      if (!session || busy) return;
      if (hiloGame.isTerminal(session.state)) return;
      setError(null);
      try {
        setBusy(true);
        let next = await driver.applyAction(hiloGame, session, {
          type: "guess",
          direction,
        });
        setSession(next);
        const lastPick = next.state.picks[next.state.picks.length - 1];
        setFlash(lastPick.won ? "win" : "loss");
        setTimeout(() => setFlash(null), 600);

        if (hiloGame.isTerminal(next.state)) {
          next = await driver.settleSession(hiloGame, next);
          setSession(next);
          setHistory((h) => [next, ...h].slice(0, 30));
          pushHistory({
            game: "hilo",
            stakeUnits: next.result!.totalStakedUnits,
            pnlUnits: next.result!.pnlUnits,
            multiplier: next.state.multiplier,
            session: next as unknown as Session<unknown, unknown>,
          });
          void persistSettledSession(
            next as unknown as Parameters<typeof persistSettledSession>[0],
            getSeedPair(),
          );
          await refreshBalance();
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy, driver, getSeedPair, pushHistory, refreshBalance, session],
  );

  /* ----- Cash out -------------------------------------------------------- */

  const cashout = useCallback(async () => {
    if (!session || busy) return;
    if (session.state.picks.length === 0) return;
    if (hiloGame.isTerminal(session.state)) return;
    setError(null);
    try {
      setBusy(true);
      let next = await driver.applyAction(hiloGame, session, { type: "cashout" });
      next = await driver.settleSession(hiloGame, next);
      setSession(next);
      setHistory((h) => [next, ...h].slice(0, 30));
      pushHistory({
        game: "hilo",
        stakeUnits: next.result!.totalStakedUnits,
        pnlUnits: next.result!.pnlUnits,
        multiplier: next.state.multiplier,
        session: next as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(
        next as unknown as Parameters<typeof persistSettledSession>[0],
        getSeedPair(),
      );
      await refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, driver, getSeedPair, pushHistory, refreshBalance, session]);

  /* ----- Auto-bet -------------------------------------------------------- */

  const [auto, setAuto] = useState<AutoConfig>(DEFAULT_AUTO);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{
    remaining: number;
    wins: number;
    losses: number;
    pnlUnits: bigint;
  } | null>(null);
  const cancelAutoRef = useRef(false);

  const runAuto = useCallback(async () => {
    if (autoRunning) return;
    setError(null);
    cancelAutoRef.current = false;
    setAutoRunning(true);
    const startBal = (await ledger.getBalance(userId, chainId, token)).available;
    const stopProfit = humanToUnits(auto.stopOnProfit, token);
    const stopLoss = humanToUnits(auto.stopOnLoss, token);
    let stake = humanToUnits(betAmount, token);
    const progress = { remaining: auto.rounds, wins: 0, losses: 0, pnlUnits: 0n };
    setAutoProgress(progress);
    const targetPicks = Math.max(1, auto.pickCount);

    for (let i = 0; i < auto.rounds; i++) {
      if (cancelAutoRef.current) break;
      const bal = (await ledger.getBalance(userId, chainId, token)).available;
      const pnl = bal - startBal;
      if (auto.stopOnProfit > 0 && pnl >= stopProfit) break;
      if (auto.stopOnLoss > 0 && -pnl >= stopLoss) break;
      if (stake > bal || stake <= 0n) break;

      let s = await driver.openSession(hiloGame, {
        sessionId: newSessionId(),
        userId,
        gameId: hiloGame.id,
        chainId,
        token,
        stake,
        config: {} as Record<string, unknown>,
      });
      // Strategy: always guess `auto.direction` until we've made `targetPicks`
      // correct picks OR we've lost.
      while (s.state.phase === "running" && s.state.picks.length < targetPicks) {
        s = await driver.applyAction(hiloGame, s, {
          type: "guess",
          direction: auto.direction,
        });
      }
      if (s.state.phase === "running") {
        s = await driver.applyAction(hiloGame, s, { type: "cashout" });
      }
      s = await driver.settleSession(hiloGame, s);

      setHistory((h) => [s, ...h].slice(0, 30));
      pushHistory({
        game: "hilo",
        stakeUnits: s.result!.totalStakedUnits,
        pnlUnits: s.result!.pnlUnits,
        multiplier: s.state.multiplier,
        session: s as unknown as Session<unknown, unknown>,
      });
      void persistSettledSession(
        s as unknown as Parameters<typeof persistSettledSession>[0],
        getSeedPair(),
      );

      const won = (s.result?.pnlUnits ?? 0n) > 0n;
      progress.remaining = auto.rounds - i - 1;
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      progress.pnlUnits += s.result?.pnlUnits ?? 0n;
      setAutoProgress({ ...progress });
      await refreshBalance();
      stake = won
        ? humanToUnits(betAmount, token)
        : BigInt(Math.floor(Number(stake) * auto.onLossMultiplier));
      await new Promise((r) => setTimeout(r, 60));
    }
    setAutoRunning(false);
  }, [auto, autoRunning, betAmount, chainId, driver, getSeedPair, ledger, pushHistory, refreshBalance, token, userId]);

  /* ----- Hot keys -------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (verifyTarget && e.key === "Escape") {
        setVerifyTarget(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (inRound && !busy) {
        if (k === "h" || k === "arrowup") {
          e.preventDefault();
          void guess("higher");
        } else if (k === "l" || k === "arrowdown") {
          e.preventDefault();
          void guess("lower");
        } else if (k === "c" && session && session.state.picks.length > 0) {
          e.preventDefault();
          void cashout();
        }
      } else if (
        !busy &&
        !autoRunning &&
        (k === " " || k === "enter") &&
        (!session || hiloGame.isTerminal(session.state))
      ) {
        e.preventDefault();
        void deal();
      } else if (k === "escape" && autoRunning) {
        cancelAutoRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoRunning, busy, cashout, deal, guess, inRound, session, verifyTarget]);

  /* ----- Render --------------------------------------------------------- */

  const seedPair = getSeedPair();
  const currentPayout = liveState
    ? (liveState.stake * liveState.multiplierMicro) / 1_000_000n
    : 0n;
  const stake = humanToUnits(betAmount, token);
  const lostState = terminal && liveState?.phase === "lost";

  return (
    <InstantSideLayout>
      <div className="space-y-5">
        {/* HiLo card display */}
        <HiloDisplay
          state={liveState}
          flash={flash}
          terminal={terminal}
          lost={lostState}
        />

        {terminal && session?.result && (
          <SettlementBanner
            headline={
              liveState?.phase === "cashed_out"
                ? `Cashed at ${liveState.multiplier.toFixed(2)}×`
                : "Round over"
            }
            pnl={session.result.pnlUnits}
            token={token}
          />
        )}

        {/* Guess buttons */}
        {currentRank !== null && livePreview && (
          <section className={card + " p-5"}>
            <div className="grid grid-cols-2 gap-3">
              <GuessButton
                direction="higher"
                p={livePreview.pHigher}
                multiplier={livePreview.nextHigher}
                stepFactor={livePreview.stepHigher}
                onClick={() => void guess("higher")}
                disabled={!inRound || busy || autoRunning}
              />
              <GuessButton
                direction="lower"
                p={livePreview.pLower}
                multiplier={livePreview.nextLower}
                stepFactor={livePreview.stepLower}
                onClick={() => void guess("lower")}
                disabled={!inRound || busy || autoRunning}
              />
            </div>
            <div className="mt-3 text-[11px] text-white/40 text-center">
              {inRound ? (
                <>
                  Both options win on a tie. Hot keys:{" "}
                  <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">H</kbd> /{" "}
                  <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">L</kbd> /{" "}
                  <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">C</kbd> to cash out.
                </>
              ) : (
                <>Place a bet to start the round.</>
              )}
            </div>
          </section>
        )}

        {/* Bet panel */}
        <section className={card + " p-5"}>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className={labelCls}>Stake ({token.symbol})</label>
              <input
                type="number"
                className={inputCls}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
                min={0}
                step={0.1}
                disabled={inRound || autoRunning}
              />
            </div>
            <div className="flex gap-2 items-end">
              {!inRound ? (
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => void deal()}
                  disabled={busy || autoRunning || stake > balance.available || stake <= 0n}
                >
                  Bet · {fmtMoney(stake, token)}
                </button>
              ) : (
                <button
                  type="button"
                  className={btnGold}
                  onClick={() => void cashout()}
                  disabled={busy || liveState!.picks.length === 0}
                  title="Hot key: C"
                >
                  Cash out{liveState!.picks.length > 0 ? ` · ${fmtMoney(currentPayout, token)}` : ""}
                </button>
              )}
              <button
                type="button"
                className={btnGhost}
                onClick={() => setAutoOpen((o) => !o)}
                disabled={inRound || autoRunning}
              >
                {autoOpen ? "Hide auto" : "Auto bet"}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
            <Stat label="Available" value={fmtMoney(balance.available, token)} />
            <Stat
              label="Multiplier"
              value={inRound ? `${liveState!.multiplier.toFixed(2)}×` : "—"}
              sub={inRound ? `${liveState!.picks.length} correct` : "no round"}
            />
            <Stat
              label="Current card"
              value={currentRank === null ? "—" : rankLabelOf(currentRank)}
              sub={currentRank === null ? "—" : suitOf(currentCardIdx!)}
            />
            <Stat label="House edge" value="1.00%" sub="per pick" />
          </div>

          {error && (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          )}

          {autoOpen && (
            <AutoPanel
              cfg={auto}
              setCfg={setAuto}
              running={autoRunning}
              progress={autoProgress}
              run={() => void runAuto()}
              cancel={() => {
                cancelAutoRef.current = true;
              }}
              token={token}
            />
          )}
        </section>

        {/* Bankroll quick-credit */}
        {!persistent && (
          <DevQuickTopUpBar token={token} onTopUp={(units) => depositPlayMoney(units)} />
        )}
      </div>

      {/* Side column */}
      <div className="space-y-5">
        {/* Pick history (this round) */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Pick chain</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {liveState?.picks.length ?? 0} pick{(liveState?.picks.length ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          {!liveState ? (
            <div className="text-[12px] text-white/40 text-center py-6">
              No active round. Place a bet to start.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
              {liveState.picks.length === 0 ? (
                <div className="text-[12px] text-white/40 text-center py-4">
                  Starting card revealed. Make your first guess.
                </div>
              ) : (
                liveState.picks.map((p, i) => {
                  const fromC = cardFromIndex(p.fromCardIndex);
                  const toC = cardFromIndex(p.toCardIndex);
                  return (
                    <div
                      key={i}
                      className={
                        "flex items-center justify-between gap-2 p-2 rounded-lg border text-[11px] " +
                        (p.won
                          ? "bg-emerald-500/[0.06] border-emerald-400/30"
                          : "bg-rose-500/[0.06] border-rose-400/30")
                      }
                    >
                      <div className="flex items-center gap-1.5 font-mono">
                        <MiniCard card={fromC} />
                        <span className="text-white/40">→</span>
                        <span className="text-white/40">
                          {p.direction === "higher" ? "↑" : "↓"}
                        </span>
                        <span className="text-white/40">→</span>
                        <MiniCard card={toC} />
                      </div>
                      <span
                        className={
                          "font-mono " + (p.won ? "text-emerald-300" : "text-rose-300")
                        }
                      >
                        {p.won ? `${p.multiplierAfter.toFixed(2)}×` : "lost"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Recent rounds */}
        <section className={card + " p-5"}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-white">Recent rounds</h3>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              {history.length}/30
            </span>
          </div>
          {history.length === 0 ? (
            <div className="text-[12px] text-white/40 text-center py-6">
              No rounds yet — make your first guess.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {history.map((s) => {
                const st = s.state as HiloState;
                const won = (s.result?.pnlUnits ?? 0n) > 0n;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] hover:border-emerald-400/30 hover:bg-emerald-500/[0.04] transition-colors text-left cursor-pointer"
                    onClick={() => setVerifyTarget(s)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "h-6 px-2 rounded-md text-[10px] font-mono font-semibold flex items-center justify-center " +
                          (won
                            ? "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30"
                            : "bg-rose-500/15 text-rose-200 border border-rose-400/30")
                        }
                      >
                        {st.multiplier.toFixed(2)}×
                      </span>
                      <span className="text-[10px] text-white/40">
                        {st.picks.length} pick{st.picks.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div
                      className={
                        "text-[12px] font-mono " +
                        (won ? "text-emerald-300" : "text-rose-300")
                      }
                    >
                      {won ? "+" : ""}
                      {fmtMoney(s.result?.pnlUnits ?? 0n, token)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <FairnessCard seedPair={seedPair} onRotateSeed={() => rotateSeed()}>
          Each card is an independent unbiased draw from the 52-card deck via{" "}
          <code className="text-emerald-300">HMAC-SHA256(server_seed, client_seed:nonce)</code>.
          The starting card uses the first draw; each subsequent pick uses the next.
          Both buttons count ties as wins — that&apos;s how the flat 1% edge applies
          symmetrically across all 13 ranks.
        </FairnessCard>

        {lastRevealedSeed && (
          <RevealedSeedCard
            serverSeed={lastRevealedSeed.serverSeed}
            onDismiss={dismissRevealedSeed}
          />
        )}
      </div>

      {/* Verify modal */}
      {verifyTarget && (
        <CasinoVerifyModal
          title="Verify HiLo round"
          description="Each card is an unbiased nextInt(52) from the HMAC stream — replay picks and cashout."
          session={verifyTarget}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => setVerifyTarget(null)}
          resultLabel="Replayed round matches recorded outcome"
          extraFields={
            <div className="grid grid-cols-2 gap-3">
              <VerifyField label="Phase" value={verifyTarget.state.phase} />
              <VerifyField label="Multiplier" value={`${verifyTarget.state.multiplier.toFixed(2)}×`} />
              <VerifyField label="Picks" value={String(verifyTarget.state.picks.length)} />
              <VerifyField
                label="Cards"
                value={verifyTarget.state.revealedHistory
                  .map((idx) => {
                    const c = cardFromIndex(idx);
                    return `${c.rank}${c.suit}`;
                  })
                  .join(" → ")}
                mono
              />
            </div>
          }
          runVerify={(serverSeed) =>
            runSessionVerify(hiloGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: hiloGame.id,
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: {},
            })
          }
        />
      )}
    </InstantSideLayout>
  );
}

/* ===========================================================================
 *  Card display
 * ========================================================================= */

function HiloDisplay({
  state,
  flash,
  terminal,
  lost,
}: {
  state: HiloState | null;
  flash: "win" | "loss" | null;
  terminal: boolean;
  lost: boolean;
}) {
  const visible = state ? cardFromIndex(state.currentCardIndex) : null;
  return (
    <section className={card + " p-6 flex flex-col items-center"}>
      <div className="flex items-baseline justify-between mb-4 w-full">
        <h3 className="font-semibold text-white">HiLo</h3>
        <span className="text-[11px] text-white/40">
          {state
            ? terminal
              ? lost
                ? "round lost"
                : `cashed out at ${state.multiplier.toFixed(2)}×`
              : `${state.picks.length} correct · ${state.multiplier.toFixed(2)}×`
            : "place a bet"}
        </span>
      </div>
      <div className="relative">
        {visible ? (
          <BigCard card={visible} flash={flash} dim={terminal} />
        ) : (
          <div className="w-[180px] h-[252px] rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] flex items-center justify-center text-white/30 text-sm">
            place a bet
          </div>
        )}
        {flash === "win" && (
          <div className="absolute inset-0 rounded-2xl ring-4 ring-emerald-400/60 animate-pulse pointer-events-none" />
        )}
        {flash === "loss" && (
          <div className="absolute inset-0 rounded-2xl ring-4 ring-rose-400/60 animate-pulse pointer-events-none" />
        )}
      </div>
      {state && state.picks.length > 0 && !terminal && (
        <div className="mt-3 text-[11px] text-white/40">
          Built up from{" "}
          {state.picks
            .slice(-3)
            .map((p) => `${cardFromIndex(p.fromCardIndex).rank}${cardFromIndex(p.fromCardIndex).suit}`)
            .join(" → ")}
          {state.picks.length > 3 ? ` (+${state.picks.length - 3} earlier)` : ""}
        </div>
      )}
    </section>
  );
}

function BigCard({ card: c, flash, dim }: { card: Card; flash: "win" | "loss" | null; dim: boolean }) {
  const isRed = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        "w-[180px] h-[252px] rounded-2xl border-2 flex flex-col items-stretch justify-between p-4 select-none transition-all shadow-2xl " +
        (dim
          ? "bg-white/[0.05] border-white/[0.15] opacity-80"
          : "bg-gradient-to-br from-white/[0.10] to-white/[0.04] border-white/30") +
        (flash === "win" ? " scale-105" : flash === "loss" ? " scale-95" : "")
      }
      style={{
        boxShadow: dim ? undefined : "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      <div
        className={
          "text-3xl font-bold leading-none " + (isRed ? "text-rose-300" : "text-white")
        }
      >
        {c.rank}
        <div className="text-2xl font-normal mt-1">{c.suit}</div>
      </div>
      <div className={"self-center text-7xl " + (isRed ? "text-rose-300" : "text-white/90")}>
        {c.suit}
      </div>
      <div
        className={
          "text-3xl font-bold self-end rotate-180 leading-none " +
          (isRed ? "text-rose-300" : "text-white")
        }
      >
        {c.rank}
        <div className="text-2xl font-normal mt-1">{c.suit}</div>
      </div>
    </div>
  );
}

function MiniCard({ card: c }: { card: Card }) {
  const isRed = c.suit === "♥" || c.suit === "♦";
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] font-semibold text-[11px] " +
        (isRed ? "text-rose-300" : "text-white/90")
      }
    >
      {c.rank}
      <span className="text-[10px]">{c.suit}</span>
    </span>
  );
}

/* ===========================================================================
 *  Guess button
 * ========================================================================= */

function GuessButton({
  direction,
  p,
  multiplier,
  stepFactor,
  onClick,
  disabled,
}: {
  direction: HiloDirection;
  p: number;
  multiplier: number;
  stepFactor: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const isHigher = direction === "higher";
  return (
    <button
      type="button"
      className={
        "p-4 rounded-xl border-2 transition-all text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 " +
        (isHigher
          ? "bg-emerald-500/[0.08] border-emerald-400/30 hover:border-emerald-300/60 hover:bg-emerald-500/[0.14]"
          : "bg-sky-500/[0.08] border-sky-400/30 hover:border-sky-300/60 hover:bg-sky-500/[0.14]") +
        (disabled ? "" : " hover:scale-[1.01] active:scale-[0.99]")
      }
      onClick={onClick}
      disabled={disabled}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={"text-2xl " + (isHigher ? "text-emerald-300" : "text-sky-300")}>
          {isHigher ? "▲" : "▼"}
        </span>
        <span className="font-semibold text-white">
          {isHigher ? "Higher or same" : "Lower or same"}
        </span>
        <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-mono">
          {isHigher ? "H" : "L"}
        </kbd>
      </div>
      <div className="flex items-baseline justify-between font-mono text-[12px]">
        <span className="text-white/60">{(p * 100).toFixed(2)}% win</span>
        <span className={isHigher ? "text-emerald-300" : "text-sky-300"}>
          {multiplier.toFixed(2)}×
        </span>
      </div>
      <div className="mt-1 text-[10px] text-white/40 font-mono">
        step ×{stepFactor.toFixed(3)}
      </div>
    </button>
  );
}

/* ===========================================================================
 *  Auto-bet panel
 * ========================================================================= */

function AutoPanel({
  cfg,
  setCfg,
  running,
  progress,
  run,
  cancel,
  token,
}: {
  cfg: AutoConfig;
  setCfg: (c: AutoConfig) => void;
  running: boolean;
  progress: { remaining: number; wins: number; losses: number; pnlUnits: bigint } | null;
  run: () => void;
  cancel: () => void;
  token: TokenSpec;
}) {
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div>
          <label className={labelCls}>Rounds</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.rounds}
            onChange={(e) => setCfg({ ...cfg, rounds: Math.max(1, Number(e.target.value)) })}
            disabled={running}
            min={1}
            max={1000}
          />
        </div>
        <div>
          <label className={labelCls}>Picks / round</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.pickCount}
            onChange={(e) => setCfg({ ...cfg, pickCount: Math.max(1, Number(e.target.value)) })}
            disabled={running}
            min={1}
            max={20}
          />
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <div className="flex gap-1">
            {(["higher", "lower"] as HiloDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                className={
                  "h-10 px-2 text-[11px] font-medium rounded-lg border flex-1 cursor-pointer " +
                  (cfg.direction === d
                    ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                    : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]")
                }
                onClick={() => setCfg({ ...cfg, direction: d })}
                disabled={running}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>On loss ×</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.onLossMultiplier}
            onChange={(e) => setCfg({ ...cfg, onLossMultiplier: Math.max(0.1, Number(e.target.value)) })}
            disabled={running}
            min={0.1}
            step={0.1}
          />
        </div>
        <div>
          <label className={labelCls}>Stop on profit</label>
          <input
            type="number"
            className={inputCls}
            value={cfg.stopOnProfit}
            onChange={(e) => setCfg({ ...cfg, stopOnProfit: Math.max(0, Number(e.target.value)) })}
            disabled={running}
            min={0}
          />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {running ? (
          <button type="button" className={btnDanger} onClick={cancel}>
            Cancel (Esc)
          </button>
        ) : (
          <button type="button" className={btnPrimary} onClick={run}>
            Run {cfg.rounds} rounds · always {cfg.direction} × {cfg.pickCount}
          </button>
        )}
        {progress && (
          <div className="text-[12px] text-white/60 flex gap-3 font-mono">
            <span>{progress.remaining} left</span>
            <span className="text-emerald-300">{progress.wins}W</span>
            <span className="text-rose-300">{progress.losses}L</span>
            <span className={progress.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300"}>
              pnl {fmtMoney(progress.pnlUnits, token)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Small UI primitives
 * ========================================================================= */

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div className="mt-1 font-mono text-[14px] text-white">{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function suitOf(cardIndex: number): string {
  return cardFromIndex(cardIndex).suit;
}

