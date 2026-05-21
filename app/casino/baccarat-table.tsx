"use client";

import { useCallback, useEffect, useState } from "react";
import {
  baccaratGame,
  baccaratRtpLabel,
  cardLabel,
  formatBaccaratCards,
  newSessionId,
  persistSettledSession,
  type BaccaratAction,
  type BaccaratSpot,
  type BaccaratState,
  type Card,
  type ChainAdapter,
  type ChainId,
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

const LAST_BET_KEY = "mf_casino_bac_last_bet";
const LAST_SPOT_KEY = "mf_casino_bac_last_spot";

const SPOTS: { id: BaccaratSpot; label: string; hint: string }[] = [
  { id: "player", label: "Player", hint: "1:1 · push on tie" },
  { id: "banker", label: "Banker", hint: "0.95:1 · 5% commission" },
  { id: "tie", label: "Tie", hint: "8:1" },
];

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

export default function BaccaratTable({ chainId, token }: Props) {
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
  const [spot, setSpot] = useState<BaccaratSpot>(() => {
    if (typeof window === "undefined") return "player";
    const s = window.localStorage.getItem(LAST_SPOT_KEY);
    return s === "banker" || s === "tie" ? s : "player";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
    window.localStorage.setItem(LAST_SPOT_KEY, spot);
  }, [betAmount, spot]);

  const [dealing, setDealing] = useState(false);
  const [lastSession, setLastSession] = useState<Session<BaccaratAction, BaccaratState> | null>(null);
  const [history, setHistory] = useState<Session<BaccaratAction, BaccaratState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<Session<BaccaratAction, BaccaratState> | null>(null);

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
      let s = await driver.openSession(baccaratGame, {
        sessionId: newSessionId(),
        userId,
        gameId: baccaratGame.id,
        chainId,
        token,
        stake,
        config: { betSpot: spot },
      });
      s = await driver.settleSession(baccaratGame, s);
      await new Promise((r) => setTimeout(r, 600));
      setLastSession(s);
      setHistory((h) => [s, ...h].slice(0, 24));
      pushHistory({
        game: "baccarat",
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <section className={card + " p-4 sm:p-6 space-y-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white">Punto Banco</h2>
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              RTP {baccaratRtpLabel(spot)}
            </span>
          </div>

          {st && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <HandPanel
                title="Player"
                total={st.playerTotal}
                cards={st.playerCards}
                highlight={st.winner === "player"}
              />
              <HandPanel
                title="Banker"
                total={st.bankerTotal}
                cards={st.bankerCards}
                highlight={st.winner === "banker"}
              />
            </div>
          )}

          {!st && (
            <p className="text-sm text-white/45 text-center py-8">
              Pick a spot and deal — standard 8-deck shoe with third-card rules.
            </p>
          )}

          {st?.winner === "tie" && (
            <p className="text-center text-sm text-amber-200/90 font-medium">Tie — {st.playerTotal}</p>
          )}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {SPOTS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={dealing}
                onClick={() => setSpot(s.id)}
                className={
                  "min-h-[72px] touch-manipulation rounded-xl border p-3 text-left transition-all cursor-pointer disabled:opacity-50 " +
                  (spot === s.id
                    ? "border-amber-400/50 bg-amber-500/15 shadow-[0_0_20px_rgba(245,158,11,0.1)]"
                    : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]")
                }
              >
                <div className="text-sm font-semibold text-white">{s.label}</div>
                <div className="text-[10px] text-white/45 mt-0.5">{s.hint}</div>
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
          <section className={card + " p-4 space-y-2"}>
            <div className="flex items-center justify-between gap-2">
              <span className={labelCls + " !mb-0"}>Fairness</span>
              <button type="button" onClick={() => rotateSeed()} className={btnSecondary + " !h-8 !text-[10px]"}>
                Rotate seed
              </button>
            </div>
            <p className="text-[10px] font-mono text-white/40 break-all">{seedPair.serverSeedHash.slice(0, 24)}…</p>
            {lastSession && (
              <button
                type="button"
                onClick={() => setVerifyTarget(lastSession)}
                className="text-xs text-emerald-300 hover:text-emerald-200 cursor-pointer"
              >
                Verify last hand →
              </button>
            )}
          </section>
          {history.length > 0 && (
            <section className={card + " p-4 max-h-48 overflow-y-auto"}>
              <div className={labelCls}>Recent</div>
              <ul className="space-y-1.5">
                {history.slice(0, 8).map((h) => (
                  <li key={h.id} className="flex justify-between text-[11px]">
                    <span className="text-white/50">
                      {h.state.betSpot} · {h.state.winner}
                    </span>
                    <button
                      type="button"
                      onClick={() => setVerifyTarget(h)}
                      className={
                        "font-mono " +
                        (h.result!.pnlUnits >= 0n ? "text-emerald-300/90" : "text-rose-300/90")
                      }
                    >
                      {fmtMoney(h.result!.pnlUnits, token)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {verifyTarget && (
        <CasinoVerifyModal
          title="Baccarat · verify hand"
          description="Replay the shoe deal and third-card tableau from the revealed server seed."
          session={verifyTarget as Session<unknown, BaccaratState>}
          revealedServerSeed={pickRevealedServerSeed(seedPair, lastRevealedSeed, verifyTarget)}
          token={token}
          onClose={() => {
            setVerifyTarget(null);
            dismissRevealedSeed();
          }}
          runVerify={(serverSeed) =>
            runSessionVerify(baccaratGame, verifyTarget, serverSeed, {
              sessionId: verifyTarget.id,
              userId: verifyTarget.userId,
              gameId: "baccarat",
              chainId: verifyTarget.chainId,
              token: verifyTarget.token,
              stake: verifyTarget.stake,
              config: { betSpot: verifyTarget.state.betSpot, numDecks: verifyTarget.state.config.numDecks },
            })
          }
          extraFields={
            <>
              <VerifyField label="Your bet" value={verifyTarget.state.betSpot} />
              <VerifyField label="Outcome" value={verifyTarget.state.winner} />
              <VerifyField
                label="Player"
                value={`${verifyTarget.state.playerTotal} — ${formatBaccaratCards(verifyTarget.state.playerCards)}`}
              />
              <VerifyField
                label="Banker"
                value={`${verifyTarget.state.bankerTotal} — ${formatBaccaratCards(verifyTarget.state.bankerCards)}`}
              />
            </>
          }
        />
      )}
    </div>
  );
}

function HandPanel({
  title,
  total,
  cards,
  highlight,
}: {
  title: string;
  total: number;
  cards: Card[];
  highlight: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (highlight ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/[0.08] bg-white/[0.02]")
      }
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-white/50">{title}</span>
        <span className="text-2xl font-bold font-mono text-white">{total}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {cards.map((c, i) => (
          <span
            key={i}
            className="inline-flex min-w-[2.5rem] justify-center px-2 py-2 rounded-lg bg-white/[0.06] border border-white/[0.1] text-sm font-mono text-white/90"
          >
            {cardLabel(c)}
          </span>
        ))}
      </div>
    </div>
  );
}
