"use client";

import { useCallback, useRef, useState } from "react";
import {
  cardLabel,
  HUMAN_SEAT,
  newSessionId,
  pickBotAction,
  pokerGame,
  type ChainAdapter,
  type ChainId,
  type PokerAction,
  type PokerActionType,
  type PokerState,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";
import { btnGhost, btnPrimary, btnSecondary, card, inputCls, labelCls, pillGold } from "./casino-ui";

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  adapter: ChainAdapter;
}

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  return Number(units) / Number(denom);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  return BigInt(Math.floor(amount * Number(denom)));
}

function fmt(units: bigint, token: TokenSpec): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token.symbol}`;
}

const SEAT_POS = [
  "bottom-4 left-1/2 -translate-x-1/2",
  "bottom-[28%] right-4",
  "top-1/2 right-2 -translate-y-1/2",
  "top-8 right-[22%]",
  "top-8 left-[22%]",
  "bottom-[28%] left-4",
];

export default function PokerTable({ chainId, token }: Props) {
  const {
    driver,
    getSeedPair,
    balance,
    refreshBalance,
    pushHistory,
    depositPlayMoney,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();

  const [session, setSession] = useState<Session<PokerAction, PokerState> | null>(null);
  const [buyIn, setBuyIn] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningBots = useRef(false);

  const legal = session ? pokerGame.legalActions(session.state) : [];
  const legalTypes = new Set(legal.map((a) => a.type + (a.raiseTo ? `:${a.raiseTo}` : "")));

  const advanceBots = useCallback(
    async (sess: Session<PokerAction, PokerState>): Promise<Session<PokerAction, PokerState>> => {
      let s = sess;
      let guard = 0;
      while (!pokerGame.isTerminal(s.state) && guard < 120) {
        guard++;
        if (s.state.activeSeat === null) {
          try {
            s = await driver.applyAction(pokerGame, s, { type: "advance_street" });
          } catch {
            break;
          }
          continue;
        }
        if (s.state.activeSeat === HUMAN_SEAT) break;
        const action = pickBotAction(s.state);
        try {
          s = await driver.applyAction(pokerGame, s, action);
        } catch {
          break;
        }
      }
      return s;
    },
    [driver, getSeedPair],
  );

  const settleIfDone = useCallback(
    async (sess: Session<PokerAction, PokerState>) => {
      if (!pokerGame.isTerminal(sess.state)) return sess;
      const settled = await driver.settleSession(pokerGame, sess);
      const result = settled.result!;
      pushHistory({
        game: "poker",
        stakeUnits: result.totalStakedUnits,
        pnlUnits: result.pnlUnits,
        multiplier: Number(result.totalPayoutUnits) / Math.max(1, Number(result.totalStakedUnits)),
        session: settled,
      });
      await refreshBalance();
      return settled;
    },
    [driver, getSeedPair, pushHistory, refreshBalance],
  );

  const syncTable = useCallback(
    async (sess: Session<PokerAction, PokerState>): Promise<Session<PokerAction, PokerState>> => {
      let s = await advanceBots(sess);
      if (pokerGame.isTerminal(s.state)) {
        return await settleIfDone(s);
      }
      return s;
    },
    [advanceBots, settleIfDone],
  );

  const joinTable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const stake = humanToUnits(buyIn, token);
      if (stake <= 0n) throw new Error("Invalid buy-in");
      if (balance.available < stake) throw new Error("Insufficient balance");

      const bet = {
        sessionId: newSessionId(),
        userId: getSeedPair().userId,
        gameId: "poker" as const,
        chainId,
        token,
        stake,
        config: { bigBlind: stake / 50n },
      };
      let s = await driver.openSession(pokerGame, bet);
      await refreshBalance();
      s = await syncTable(s);
      setSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [balance.available, buyIn, chainId, driver, getSeedPair, refreshBalance, syncTable, token]);

  const apply = useCallback(
    async (action: PokerAction) => {
      if (!session) return;
      setError(null);
      setBusy(true);
      try {
        let s = await driver.applyAction(pokerGame, session, action);
        s = await syncTable(s);
        setSession(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, session, syncTable],
  );

  const clearTable = () => {
    setSession(null);
    setError(null);
  };

  const st = session?.state;
  const terminal = st ? pokerGame.isTerminal(st) : false;
  const human = st?.players[HUMAN_SEAT];
  const toCall = st && human ? st.currentBet - human.betThisRound : 0n;

  return (
    <div className="mt-6 space-y-6">
      <section className={card + " p-5 flex flex-wrap items-center justify-between gap-4"}>
        <div>
          <h2 className="text-xl font-semibold text-white font-heading">Texas Hold&apos;em · 6-Max</h2>
          <p className="text-sm text-white/50 mt-1">
            You vs five AI opponents · 1% rake · provably fair shuffle
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Balance</div>
          <div className="font-mono text-emerald-300">{fmt(balance.available, token)}</div>
        </div>
      </section>

      <section className={card + " relative min-h-[520px] p-4 overflow-hidden"}>
        <div className="absolute inset-4 rounded-[50%] border-2 border-emerald-900/60 bg-gradient-to-b from-emerald-950/80 to-[#06070c] shadow-[inset_0_0_80px_rgba(16,185,129,0.15)]" />

        {st && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2 z-10">
            {st.community.map((c, i) => (
              <CardFace key={i} card={c} />
            ))}
            {st.community.length === 0 && (
              <span className="text-white/25 text-xs uppercase tracking-widest">Community</span>
            )}
          </div>
        )}

        {st?.players.map((p, i) => (
          <div key={p.seat} className={"absolute z-10 " + SEAT_POS[i]}>
            <SeatPanel
              player={p}
              token={token}
              active={st.activeSeat === p.seat}
              showCards={p.isHuman || st.phase === "complete" || st.phase === "showdown"}
            />
          </div>
        ))}

        {!session && (
          <div className="relative z-20 flex flex-col items-center justify-center min-h-[480px] gap-4">
            <span className={pillGold}>Private table</span>
            <p className="text-white/50 text-sm max-w-sm text-center">
              Buy in to sit seat 1. Blinds scale with your buy-in. Beat the table and cash out your stack.
            </p>
            <div className="w-48">
              <label className={labelCls}>Buy-in ({token.symbol})</label>
              <input
                type="number"
                className={inputCls}
                value={buyIn}
                min={10}
                step={10}
                onChange={(e) => setBuyIn(Number(e.target.value))}
              />
            </div>
            <button type="button" className={btnPrimary} disabled={busy} onClick={joinTable}>
              Take a seat
            </button>
            {chainId === "dev-mock" && (
              <button type="button" className={btnGhost} onClick={() => depositPlayMoney(humanToUnits(10000, token))}>
                +10k play money
              </button>
            )}
          </div>
        )}

        {st && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg px-4">
            <div className="rounded-xl bg-black/70 border border-white/10 backdrop-blur-md p-3 text-center">
              <p className="text-sm text-amber-100/90">{st.message}</p>
              <p className="text-xs text-white/40 mt-1">
                Pot {fmt(st.pot, token)}
                {st.phase !== "complete" && ` · ${st.phase}`}
                {toCall > 0n && human && !human.folded && ` · Call ${fmt(toCall, token)}`}
              </p>
            </div>
          </div>
        )}
      </section>

      {session && !terminal && (
        <section className={card + " p-4 flex flex-wrap gap-2 justify-center"}>
          <ActionBtn label="Fold" disabled={busy || !legalTypes.has("fold")} onClick={() => apply({ type: "fold" })} danger />
          <ActionBtn
            label={toCall === 0n ? "Check" : "Call"}
            disabled={busy || (!legalTypes.has("check") && !legalTypes.has("call"))}
            onClick={() => apply({ type: toCall === 0n ? "check" : "call" })}
          />
          {legal
            .filter((a) => a.type === "raise" && a.raiseTo)
            .map((a, i) => (
              <ActionBtn
                key={i}
                label={a.raiseTo === human!.betThisRound + human!.stack ? "All-in" : `Raise ${fmt(a.raiseTo!, token)}`}
                disabled={busy}
                onClick={() => apply(a)}
                accent
              />
            ))}
        </section>
      )}

      {terminal && session?.result && (
        <section className={card + " p-5 space-y-3"}>
          <h3 className="text-lg font-semibold text-white">Hand complete</h3>
          <p className={"font-mono text-lg " + (session.result.pnlUnits >= 0n ? "text-emerald-300" : "text-rose-300")}>
            {(session.result.pnlUnits >= 0n ? "+" : "") + fmt(session.result.pnlUnits, token)}
          </p>
          {st?.winners.map((w, i) => (
            <p key={i} className="text-sm text-white/60">
              {st.players[w.seat].name}: {w.hand} · {fmt(w.amount, token)}
            </p>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="button" className={btnPrimary} onClick={clearTable}>
              New hand
            </button>
            <ShareLinkRow session={session} serverSeed={lastRevealedSeed?.serverSeed ?? null} />
          </div>
        </section>
      )}

      {error && (
        <p className="text-sm text-rose-300 border border-rose-500/30 rounded-lg px-4 py-2 bg-rose-500/10">{error}</p>
      )}
    </div>
  );
}

function CardFace({ card }: { card: { rank: string; suit: string } }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={
        "w-11 h-16 sm:w-14 sm:h-20 rounded-lg border flex flex-col items-center justify-center font-bold shadow-lg " +
        (red ? "bg-rose-950/80 border-rose-500/40 text-rose-100" : "bg-slate-900/90 border-white/20 text-white")
      }
    >
      <span className="text-sm sm:text-base">{card.rank}</span>
      <span className="text-lg sm:text-xl">{card.suit}</span>
    </div>
  );
}

function SeatPanel({
  player,
  token,
  active,
  showCards,
}: {
  player: PokerState["players"][0];
  token: TokenSpec;
  active: boolean;
  showCards: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl px-3 py-2 min-w-[100px] border text-center transition-all " +
        (active
          ? "border-amber-400/60 bg-amber-500/15 shadow-[0_0_24px_rgba(245,158,11,0.2)]"
          : "border-white/10 bg-black/50")
      }
    >
      <div className="text-[11px] font-semibold text-white/90">{player.name}</div>
      <div className="text-[10px] font-mono text-emerald-300/90">{Number(player.stack) > 0 ? "" : "—"}</div>
      {player.folded && <div className="text-[10px] text-rose-300">Folded</div>}
      {showCards && player.hole.length === 2 && (
        <div className="flex gap-1 justify-center mt-1">
          {player.hole.map((c, i) => (
            <span key={i} className="text-[10px] font-mono bg-white/10 px-1 rounded">
              {cardLabel(c)}
            </span>
          ))}
        </div>
      )}
      {!showCards && !player.folded && (
        <div className="flex gap-0.5 justify-center mt-1">
          <span className="w-6 h-8 rounded bg-amber-900/40 border border-amber-600/30" />
          <span className="w-6 h-8 rounded bg-amber-900/40 border border-amber-600/30" />
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  danger,
  accent,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
}) {
  const cls = danger ? btnGhost + " !border-rose-400/40 !text-rose-200" : accent ? btnPrimary : btnSecondary;
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}
