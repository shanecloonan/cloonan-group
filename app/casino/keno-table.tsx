"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KENO_MAX_PICKS,
  KENO_POOL,
  kenoGame,
  kenoRtpLabel,
  newSessionId,
  persistSettledSession,
  type ChainAdapter,
  type ChainId,
  type KenoAction,
  type KenoState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { CasinoVerifyModal, VerifyField } from "./casino-verify-modal";
import { pickRevealedServerSeed, runSessionVerify } from "./session-verify";
import { btnPrimary, btnGhost, card, inputCls, labelCls } from "./casino-ui";

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

const LAST_BET_KEY = "mf_casino_keno_bet";
const LAST_PICKS_KEY = "mf_casino_keno_picks";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function KenoTable({ chainId, token }: Props) {
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
  const [picks, setPicks] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(LAST_PICKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed.filter((n) => n >= 1 && n <= KENO_POOL).slice(0, KENO_MAX_PICKS) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_PICKS_KEY, JSON.stringify(picks));
  }, [betAmount, picks]);

  const [lastSession, setLastSession] = useState<Session<KenoAction, KenoState> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<KenoAction, KenoState> | null>(null);

  const drawnSet = useMemo(
    () => new Set(lastSession?.state.drawn ?? []),
    [lastSession?.state.drawn],
  );
  const pickSet = useMemo(() => new Set(picks), [picks]);

  const toggle = (n: number) => {
    if (lastSession) return;
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length >= KENO_MAX_PICKS) return prev;
      return [...prev, n].sort((a, b) => a - b);
    });
  };

  const quickPick = () => {
    const pool = Array.from({ length: KENO_POOL }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPicks(pool.slice(0, KENO_MAX_PICKS).sort((a, b) => a - b));
  };

  const play = useCallback(async () => {
    setError(null);
    if (picks.length < 1) {
      setError(`Select 1–${KENO_MAX_PICKS} numbers.`);
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
      let s = await driver.openSession(kenoGame, {
        sessionId: newSessionId(),
        userId,
        gameId: kenoGame.id,
        chainId,
        token,
        stake,
        config: { picks },
      });
      s = await driver.settleSession(kenoGame, s);
      setLastSession(s);
      setVerifyTarget(s);
      pushHistory({
        game: "keno",
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
      setBusy(false);
    }
  }, [balance.available, betAmount, chainId, driver, getSeedPair, picks, pushHistory, refreshBalance, token, userId]);

  const seedPair = getSeedPair();
  const st = lastSession?.state;

  return (
    <div className="mt-4 space-y-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Keno</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {kenoRtpLabel(picks.length || 1)} · 20 of {KENO_POOL} drawn
            </span>
          </div>

          <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 sm:gap-2">
            {Array.from({ length: KENO_POOL }, (_, i) => i + 1).map((n) => {
              const selected = pickSet.has(n);
              const hit = st && selected && drawnSet.has(n);
              const drawnOnly = st && !selected && drawnSet.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={busy || !!st}
                  onClick={() => toggle(n)}
                  className={
                    "aspect-square min-h-[2.25rem] touch-manipulation rounded-lg text-xs sm:text-sm font-semibold font-mono transition-all cursor-pointer disabled:cursor-default " +
                    (hit
                      ? "bg-emerald-500/30 border-2 border-emerald-400 text-emerald-100"
                      : selected
                        ? "bg-amber-500/25 border-2 border-amber-400/70 text-amber-100"
                        : drawnOnly
                          ? "bg-white/[0.08] border border-white/20 text-white/70"
                          : "bg-white/[0.03] border border-white/[0.08] text-white/55 hover:bg-white/[0.08]")
                  }
                >
                  {n}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-white/45">
              <span className="w-3 h-3 rounded border-2 border-amber-400/70 bg-amber-500/20" /> Your pick
            </span>
            <span className="inline-flex items-center gap-1.5 text-white/45">
              <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-400" /> Hit
            </span>
            <span className="inline-flex items-center gap-1.5 text-white/45">
              <span className="w-3 h-3 rounded bg-white/[0.08] border border-white/15" /> Drawn
            </span>
          </div>

          {st && (
            <p
              className={
                "text-center text-sm font-mono " +
                (lastSession!.result!.pnlUnits > 0n
                  ? "text-emerald-300"
                  : lastSession!.result!.pnlUnits < 0n
                    ? "text-rose-300"
                    : "text-white/60")
              }
            >
              {st.hits} hits · {st.payMultiplier > 0 ? `${st.payMultiplier}×` : "no pay"} ·{" "}
              {lastSession!.result!.pnlUnits > 0n ? "+" : ""}
              {fmtMoney(lastSession!.result!.pnlUnits, token)}
            </p>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-white/60">
              <strong className="text-white">{picks.length}</strong> / {KENO_MAX_PICKS} selected
            </span>
            {!st && (
              <>
                <button type="button" onClick={quickPick} disabled={busy} className={btnGhost + " !h-8 !text-xs"}>
                  Quick pick 10
                </button>
                <button
                  type="button"
                  onClick={() => setPicks([])}
                  disabled={busy || picks.length === 0}
                  className={btnGhost + " !h-8 !text-xs"}
                >
                  Clear
                </button>
              </>
            )}
            {st && (
              <button
                type="button"
                onClick={() => {
                  setLastSession(null);
                  setVerifyTarget(null);
                }}
                className={btnGhost + " !h-8 !text-xs"}
              >
                New card
              </button>
            )}
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
                disabled={busy || !!st}
              />
            </div>
            {!st && (
              <button
                type="button"
                disabled={busy || picks.length < 1}
                onClick={() => void play()}
                className={btnPrimary + " w-full sm:w-auto sm:min-w-[120px]"}
              >
                {busy ? "Drawing…" : "Play"}
              </button>
            )}
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}
        </section>

        <aside className="space-y-3">
          <section className={card + " p-4"}>
            <div className={labelCls}>Balance</div>
            <div className="text-lg font-mono text-emerald-300">{fmtMoney(balance.available, token)}</div>
          </section>
          <section className={card + " p-4"}>
            <button type="button" onClick={() => rotateSeed()} className={btnGhost + " w-full !text-xs"}>
              Rotate seed
            </button>
            {st && (
              <button
                type="button"
                onClick={() => setVerifyTarget(lastSession)}
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
          title="Keno · verify draw"
          description="Replay the 20-number draw and hit count from the revealed seed."
          session={verifyTarget as Session<unknown, KenoState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(kenoGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "keno",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { picks: verifyTarget.state.picks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Hits" value={`${verifyTarget.state.hits} / ${verifyTarget.state.picks.length}`} />
              <VerifyField label="Pay" value={`${verifyTarget.state.payMultiplier}×`} />
              <VerifyField label="Your picks" value={verifyTarget.state.picks.join(", ")} />
              <VerifyField label="Drawn" value={verifyTarget.state.drawn.join(", ")} />
            </>
          }
        />
      )}
    </div>
  );
}
