"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advise,
  blackjackGame,
  cardLabel,
  DEFAULT_BLACKJACK_CONFIG,
  evaluateHand,
  newSessionId,
  persistSettledSession,
  verifyBlackjackSession,
  type BlackjackAction,
  type BlackjackActionType,
  type BlackjackConfig,
  type BlackjackState,
  type Card as CasinoCard,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import { useCasino } from "./casino-context";
import { ShareLinkRow } from "./share-link";

/* ---------------------------------------------------------------------------
 *  Styling vocabulary
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls =
  "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary =
  "h-10 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

/* ---------------------------------------------------------------------------
 *  Money helpers — UI human units ↔ engine bigint units
 * ------------------------------------------------------------------------- */

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  const whole = units / denom;
  const frac = units % denom;
  const fracStr = frac.toString().padStart(token.decimals, "0");
  return Number(`${whole}.${fracStr}`);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}

function fmtMoney(units: bigint, token: TokenSpec, digits = 2): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${token.symbol}`;
}

const LAST_BET_KEY = "mf_casino_bj_last_bet";

/* ===========================================================================
 *  Blackjack table component
 * ========================================================================= */

interface Props {
  chainId: ChainId;
  token: TokenSpec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adapter: ChainAdapter;
}

export default function BlackjackTable({ chainId, token }: Props) {
  const {
    driver,
    getSeedPair,
    rotateSeed,
    balance,
    refreshBalance,
    pushHistory,
    depositPlayMoney,
    lastRevealedSeed,
    dismissRevealedSeed,
  } = useCasino();

  // Synthetic userId for the dev driver — must come from the driver's
  // configured default. We derive it from the active seed pair's userId
  // (the dev driver stamps every seed pair with the default user).
  const userId = getSeedPair().userId;

  const [betAmount, setBetAmount] = useState(() => {
    if (typeof window === "undefined") return 25;
    const stored = Number(window.localStorage.getItem(LAST_BET_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 25;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_BET_KEY, String(betAmount));
  }, [betAmount]);

  const [config, setConfig] = useState<BlackjackConfig>(DEFAULT_BLACKJACK_CONFIG);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [session, setSession] = useState<Session<BlackjackAction, BlackjackState> | null>(null);
  const [history, setHistory] = useState<Session<BlackjackAction, BlackjackState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Session<BlackjackAction, BlackjackState> | null>(null);
  const [showRules, setShowRules] = useState(false);
  const revealSeed = lastRevealedSeed;

  /* ----- Actions ----- */

  const deal = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const stake = humanToUnits(betAmount, token);
      if (stake <= 0n) throw new Error("Bet must be > 0");
      let next = await driver.openSession(blackjackGame, {
        sessionId: newSessionId(),
        userId,
        gameId: blackjackGame.id,
        chainId,
        token,
        stake,
        config: config as unknown as Record<string, unknown>,
      });
      if (blackjackGame.isTerminal(next.state)) {
        next = await driver.settleSession(blackjackGame, next);
        setHistory((h) => [next, ...h].slice(0, 30));
        pushHistory({
          game: "blackjack",
          stakeUnits: next.result!.totalStakedUnits,
          pnlUnits: next.result!.pnlUnits,
          multiplier: Number(next.result!.totalPayoutUnits) / Math.max(1, Number(next.result!.totalStakedUnits)),
          session: next as unknown as Session<unknown, unknown>,
        });
        void persistSettledSession(next, getSeedPair());
      }
      setSession(next);
      await refreshBalance();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [driver, userId, chainId, token, betAmount, refreshBalance, config, getSeedPair, pushHistory]);

  const applyAction = useCallback(
    async (type: BlackjackActionType) => {
      if (!session) return;
      setError(null);
      setBusy(true);
      try {
        let extra = 0n;
        if (type === "double" || type === "split") extra = session.state.baseStake;
        if (type === "insurance") extra = session.state.baseStake / 2n;

        let next = await driver.applyAction(blackjackGame, session, { type }, extra);
        if (blackjackGame.isTerminal(next.state)) {
          next = await driver.settleSession(blackjackGame, next);
          setHistory((h) => [next, ...h].slice(0, 30));
          pushHistory({
            game: "blackjack",
            stakeUnits: next.result!.totalStakedUnits,
            pnlUnits: next.result!.pnlUnits,
            multiplier: Number(next.result!.totalPayoutUnits) / Math.max(1, Number(next.result!.totalStakedUnits)),
            session: next as unknown as Session<unknown, unknown>,
          });
          void persistSettledSession(next, getSeedPair());
        }
        setSession(next);
        await refreshBalance();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, session, refreshBalance, getSeedPair, pushHistory],
  );

  const clearTable = () => setSession(null);

  const onRotateSeed = useCallback(() => {
    rotateSeed();
  }, [rotateSeed]);

  const onDepositPlay = useCallback(async () => {
    await depositPlayMoney(humanToUnits(10_000, token));
  }, [depositPlayMoney, token]);

  const seedPair = getSeedPair();
  const legal = session ? blackjackGame.legalActions(session.state) : [];
  const legalSet = new Set(legal.map((l) => l.type));

  const advice = useMemo(() => {
    if (!session || !showAdvisor) return null;
    return advise(session.state, legal);
  }, [session, legal, showAdvisor]);

  /* ----- Hot keys ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing into inputs.
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (verifyTarget) {
        if (key === "escape") setVerifyTarget(null);
        return;
      }
      if (showRules && key === "escape") {
        setShowRules(false);
        return;
      }
      if (!session) {
        if (key === "enter" || key === " ") {
          e.preventDefault();
          deal();
        }
        return;
      }
      if (session.state.phase === "settled") {
        if (key === "enter" || key === " " || key === "r") {
          e.preventDefault();
          clearTable();
        }
        return;
      }
      if (busy) return;
      const map: Record<string, BlackjackActionType> = {
        h: "hit",
        s: "stand",
        d: "double",
        p: "split",
        u: "surrender",
        i: "insurance",
        n: "decline_insurance",
      };
      const action = map[key];
      if (action && legalSet.has(action)) {
        e.preventDefault();
        applyAction(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, legalSet, busy, applyAction, deal, verifyTarget, showRules]);

  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: table */}
      <section className={card + " p-6 lg:col-span-2 min-h-[560px] flex flex-col"}>
        <Header
          chainId={chainId}
          token={token}
          balance={balance}
          onDeposit={onDepositPlay}
          onShowRules={() => setShowRules(true)}
        />

        {!session ? (
          <DealForm
            betAmount={betAmount}
            setBetAmount={setBetAmount}
            onDeal={deal}
            disabled={busy || balance.available < humanToUnits(betAmount, token)}
            token={token}
            balance={balance}
          />
        ) : (
          <Felt
            session={session}
            token={token}
            legal={legalSet}
            advice={advice}
            onAction={applyAction}
            onClear={clearTable}
            onVerify={() => setVerifyTarget(session)}
            busy={busy}
          />
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Provable fairness footer */}
        <div className="mt-auto pt-5 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap text-[11px]">
          <div className="text-white/40 min-w-0">
            <span className="uppercase tracking-[0.12em]">server seed hash:</span>{" "}
            <span className="font-mono text-white/60 break-all">
              {seedPair.serverSeedHash.slice(0, 18)}…{seedPair.serverSeedHash.slice(-6)}
            </span>
          </div>
          <div className="text-white/40">
            <span className="uppercase tracking-[0.12em]">nonce:</span>{" "}
            <span className="font-mono text-white/80">{seedPair.nonce}</span>
          </div>
          <button
            type="button"
            onClick={onRotateSeed}
            className="text-[11px] px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            Rotate seed →
          </button>
        </div>
      </section>

      {/* Right column: side panels */}
      <aside className="space-y-4">
        <SidePanel title="House rules" right={
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="text-[10px] uppercase tracking-[0.12em] text-emerald-300 hover:text-emerald-200 cursor-pointer"
          >
            edit →
          </button>
        }>
          <ul className="text-[12px] text-white/70 space-y-1.5">
            <li>· {config.numDecks} decks</li>
            <li>· Dealer {config.dealerHitsSoft17 ? "hits" : "stands"} soft 17</li>
            <li>· Blackjack pays {config.blackjackPays.num}:{config.blackjackPays.den}</li>
            <li>· {config.allowDoubleAfterSplit ? "DAS allowed" : "no DAS"}</li>
            <li>· {config.allowSurrender ? "Late surrender enabled" : "No surrender"}</li>
            <li>· Up to {config.maxHands} hands from splits</li>
          </ul>
        </SidePanel>

        <SidePanel
          title="Strategy advisor"
          right={
            <button
              type="button"
              onClick={() => setShowAdvisor((v) => !v)}
              className={
                "text-[10px] uppercase tracking-[0.12em] cursor-pointer " +
                (showAdvisor ? "text-emerald-300 hover:text-emerald-200" : "text-white/40 hover:text-white/70")
              }
            >
              {showAdvisor ? "on" : "off"}
            </button>
          }
        >
          {!showAdvisor ? (
            <div className="text-[12px] text-white/40">
              Toggle on to see basic-strategy recommendations for the active hand.
            </div>
          ) : advice ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">
                Suggested
              </div>
              <div className="text-base font-semibold text-emerald-300 capitalize">
                {advice.action.replace("_", " ")}
              </div>
              <div className="text-[12px] text-white/60 mt-1.5 leading-relaxed">
                {advice.explanation}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-white/40">
              No advice available for this state.
            </div>
          )}
        </SidePanel>

        <SidePanel title="Hot keys" subtitle="play faster">
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px]">
            <KeyHint k="H" label="Hit" />
            <KeyHint k="S" label="Stand" />
            <KeyHint k="D" label="Double" />
            <KeyHint k="P" label="Split" />
            <KeyHint k="U" label="Surrender" />
            <KeyHint k="I/N" label="Insurance / no" />
            <KeyHint k="Enter" label="Deal / new hand" />
            <KeyHint k="Esc" label="Close modal" />
          </div>
        </SidePanel>

        <SidePanel title="Hand history" subtitle={`${history.length} settled`}>
          {history.length === 0 && (
            <div className="text-[12px] text-white/40">No hands yet. Place a bet to play.</div>
          )}
          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
            {history.map((h) => (
              <HistoryRow
                key={h.id}
                session={h}
                token={token}
                onVerify={() => setVerifyTarget(h)}
              />
            ))}
          </div>
        </SidePanel>

        {revealSeed && (
          <SidePanel title="Last revealed server seed" subtitle="verify it">
            <div className="text-[11px] text-white/50">Server seed:</div>
            <div className="font-mono text-[11px] text-white/80 break-all">
              {revealSeed.serverSeed}
            </div>
            <div className="mt-2 text-[11px] text-white/50">Published hash:</div>
            <div className="font-mono text-[11px] text-white/80 break-all">
              {revealSeed.hash}
            </div>
            <button
              type="button"
              onClick={dismissRevealedSeed}
              className="mt-3 text-[11px] text-white/40 hover:text-white cursor-pointer"
            >
              Dismiss →
            </button>
          </SidePanel>
        )}
      </aside>

      {verifyTarget && (
        <VerifyModal
          session={verifyTarget}
          revealedServerSeed={
            // We can verify against the *active* server seed iff this is the
            // session the player just played AND they haven't rotated yet —
            // in dev mode the in-memory pair still holds the seed.
            seedPair.serverSeedHash === verifyTarget.serverSeedHash
              ? seedPair.serverSeed ?? null
              : revealSeed?.hash === verifyTarget.serverSeedHash
                ? revealSeed.serverSeed
                : null
          }
          token={token}
          onClose={() => setVerifyTarget(null)}
        />
      )}

      {showRules && (
        <RulesModal
          config={config}
          onClose={() => setShowRules(false)}
          onSave={(c) => {
            setConfig(c);
            setShowRules(false);
          }}
          inSession={!!session && session.status === "open"}
        />
      )}
    </div>
  );
}

/* ===========================================================================
 *  Subcomponents
 * ========================================================================= */

function Header({
  chainId,
  token,
  balance,
  onDeposit,
  onShowRules,
}: {
  chainId: ChainId;
  token: TokenSpec;
  balance: { available: bigint; locked: bigint };
  onDeposit: () => void;
  onShowRules: () => void;
}) {
  const isDev = chainId === "dev-mock";
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
          Playing on
        </div>
        <div className="text-base font-semibold">
          {chainId} · <span className="text-emerald-300">{token.symbol}</span>
        </div>
        <button
          type="button"
          onClick={onShowRules}
          className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/40 hover:text-white/70 cursor-pointer"
        >
          ⚙ Table rules
        </button>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
          Available
        </div>
        <div className="text-xl font-bold font-mono text-white">
          {fmtMoney(balance.available, token)}
        </div>
        {balance.locked > 0n && (
          <div className="text-[11px] text-white/40 font-mono">
            {fmtMoney(balance.locked, token)} locked
          </div>
        )}
        {isDev && (
          <button
            type="button"
            onClick={onDeposit}
            className="mt-1 text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer underline-offset-2 hover:underline"
          >
            + Add 10,000 play money
          </button>
        )}
      </div>
    </div>
  );
}

function DealForm({
  betAmount,
  setBetAmount,
  onDeal,
  disabled,
  token,
  balance,
}: {
  betAmount: number;
  setBetAmount: (n: number) => void;
  onDeal: () => void;
  disabled: boolean;
  token: TokenSpec;
  balance: { available: bigint; locked: bigint };
}) {
  const QUICK = [5, 25, 100, 500, 1000];
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md">
        <label className={labelCls}>Your bet</label>
        <div className="flex items-stretch gap-2">
          <input
            type="number"
            min={1}
            step={1}
            className={inputCls}
            value={betAmount}
            onChange={(e) => setBetAmount(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !disabled) onDeal();
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={onDeal}
            className={btnPrimary + " whitespace-nowrap"}
          >
            Deal · Enter
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setBetAmount(q)}
              className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
            >
              {q} {token.symbol}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setBetAmount(Math.max(1, Math.floor(unitsToHuman(balance.available, token) / 2)))}
            className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            ½ stack
          </button>
          <button
            type="button"
            onClick={() => setBetAmount(Math.max(1, Math.floor(unitsToHuman(balance.available, token))))}
            className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            Max
          </button>
        </div>
        {disabled && balance.available < humanToUnits(betAmount, token) && (
          <p className="mt-2 text-[11px] text-amber-300">
            Bet exceeds available balance.
          </p>
        )}
      </div>
    </div>
  );
}

function Felt({
  session,
  token,
  legal,
  advice,
  onAction,
  onClear,
  onVerify,
  busy,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
  legal: Set<BlackjackActionType>;
  advice: ReturnType<typeof advise> | null;
  onAction: (a: BlackjackActionType) => void;
  onClear: () => void;
  onVerify: () => void;
  busy: boolean;
}) {
  const state = session.state;
  const dealerVisibleCards = state.dealerRevealed ? state.dealer : [state.dealer[1]];
  const dealerHidden = !state.dealerRevealed;
  const dealerVal = state.dealerRevealed ? evaluateHand(state.dealer) : evaluateHand([state.dealer[1]]);

  return (
    <div className="flex-1 flex flex-col">
      {/* Dealer row */}
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-2">
          Dealer · {dealerHidden ? `${dealerVal.total} showing` : dealerVal.total}
        </div>
        <div className="flex justify-center items-center gap-2 min-h-[5.5rem]">
          {dealerHidden && <CardChip hidden />}
          {dealerVisibleCards.map((c, i) => (
            <CardChip key={`d${i}`} card={c} delay={i * 80} />
          ))}
        </div>
      </div>

      {/* Felt divider */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      {/* Player hands */}
      <div className="space-y-3">
        {state.hands.map((hand, i) => {
          const val = evaluateHand(hand.cards);
          const isActive = state.phase === "player_turn" && i === state.activeHand;
          return (
            <div
              key={`h${i}`}
              className={
                "p-3 rounded-xl border transition-all " +
                (isActive
                  ? "border-emerald-400/40 bg-emerald-500/[0.06]"
                  : hand.surrendered
                    ? "border-amber-400/20 bg-amber-500/[0.04]"
                    : "border-white/[0.05] bg-white/[0.02]")
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                  Hand {i + 1} {hand.fromSplit ? "(split)" : ""}
                  {hand.doubled ? " · doubled" : ""}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-white/60">
                    Bet {Number(hand.stake) / 10 ** token.decimals} {token.symbol}
                  </span>
                  <span className="text-white/80 font-mono">
                    {val.total}{val.soft ? " (soft)" : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hand.cards.map((c, j) => (
                  <CardChip key={`h${i}c${j}`} card={c} delay={j * 60} />
                ))}
              </div>
              {hand.busted && <div className="mt-2 text-[11px] text-rose-300">BUST</div>}
              {hand.stood && !hand.busted && (
                <div className="mt-2 text-[11px] text-white/40">STAND</div>
              )}
              {hand.surrendered && (
                <div className="mt-2 text-[11px] text-amber-300">SURRENDERED — half stake refunded</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Advice strip */}
      {advice && state.phase !== "settled" && (
        <div className="mt-4 mx-auto max-w-md px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-400/20 text-center">
          <div className="text-[10px] uppercase tracking-[0.15em] text-emerald-300/60">
            Basic strategy
          </div>
          <div className="text-sm font-semibold text-emerald-200 capitalize">
            {advice.action.replace("_", " ")}
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
        {state.phase === "insurance_offered" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("insurance")}
              className={btnPrimary}
            >
              Take insurance · I
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("decline_insurance")}
              className="h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
            >
              No thanks · N
            </button>
          </>
        ) : state.phase === "settled" ? (
          <Settlement session={session} token={token} onClear={onClear} onVerify={onVerify} />
        ) : (
          <>
            <ActionButton label="Hit" hotkey="H" enabled={legal.has("hit") && !busy} onClick={() => onAction("hit")} />
            <ActionButton label="Stand" hotkey="S" enabled={legal.has("stand") && !busy} onClick={() => onAction("stand")} />
            <ActionButton label="Double" hotkey="D" enabled={legal.has("double") && !busy} onClick={() => onAction("double")} />
            <ActionButton label="Split" hotkey="P" enabled={legal.has("split") && !busy} onClick={() => onAction("split")} />
            <ActionButton label="Surrender" hotkey="U" enabled={legal.has("surrender") && !busy} onClick={() => onAction("surrender")} />
          </>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  hotkey,
  enabled,
  onClick,
}: {
  label: string;
  hotkey: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={
        "h-10 px-4 rounded-lg font-semibold text-sm border transition-all flex items-center gap-2 " +
        (enabled
          ? "bg-white/[0.06] border-white/[0.12] text-white hover:bg-white/[0.1] cursor-pointer active:scale-95"
          : "bg-white/[0.02] border-white/[0.04] text-white/30 cursor-not-allowed")
      }
    >
      <span>{label}</span>
      <kbd
        className={
          "text-[9px] font-mono px-1.5 py-0.5 rounded border " +
          (enabled ? "border-white/[0.15] text-white/50" : "border-white/[0.05] text-white/20")
        }
      >
        {hotkey}
      </kbd>
    </button>
  );
}

function Settlement({
  session,
  token,
  onClear,
  onVerify,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
  onClear: () => void;
  onVerify: () => void;
}) {
  const r = session.result;
  if (!r) return null;
  const isWin = r.pnlUnits > 0n;
  const isPush = r.pnlUnits === 0n;
  return (
    <div className="w-full text-center space-y-3">
      <div
        className={
          "text-3xl font-bold " +
          (isWin ? "text-emerald-400" : isPush ? "text-white/80" : "text-rose-400")
        }
      >
        {isWin
          ? `+${fmtMoney(r.pnlUnits, token)}`
          : isPush
            ? "Push"
            : `${fmtMoney(r.pnlUnits, token)}`}
      </div>
      <div className="text-[11px] text-white/40">
        Staked {fmtMoney(r.totalStakedUnits, token)} · Paid {fmtMoney(r.totalPayoutUnits, token)}
      </div>
      {r.breakdown && (
        <div className="text-[11px] text-white/50 space-y-0.5">
          {r.breakdown.map((b, i) => (
            <div key={i}>{b.label}</div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={onClear}
          className="h-10 px-6 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
        >
          New hand · Enter
        </button>
        <button
          type="button"
          onClick={onVerify}
          className="h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
        >
          Verify hand →
        </button>
      </div>
    </div>
  );
}

function CardChip({
  card,
  hidden,
  delay = 0,
}: {
  card?: CasinoCard;
  hidden?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Trigger CSS transition on mount.
    const el = ref.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px) rotate(-3deg)";
    const t = setTimeout(() => {
      if (!ref.current) return;
      ref.current.style.opacity = "1";
      ref.current.style.transform = "translateY(0) rotate(0)";
    }, delay + 10);
    return () => clearTimeout(t);
  }, [delay]);

  if (hidden || !card) {
    return (
      <div
        ref={ref}
        className="w-14 h-20 rounded-lg bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-500/40 flex items-center justify-center text-white/60 text-xs select-none transition-all duration-300 ease-out"
        style={{ transitionDelay: `${delay}ms` }}
      >
        ⌑
      </div>
    );
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      ref={ref}
      className={
        "w-14 h-20 rounded-lg border bg-white/[0.96] text-black flex flex-col items-center justify-center font-bold select-none transition-all duration-300 ease-out shadow-md " +
        (red ? "text-rose-600" : "text-stone-900")
      }
      style={{ transitionDelay: `${delay}ms` }}
    >
      <span className="text-base leading-none">{card.rank}</span>
      <span className="text-lg leading-none mt-0.5">{card.suit}</span>
    </div>
  );
}

function SidePanel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-sm font-semibold truncate">{title}</h3>
          {subtitle && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-white/40 shrink-0">
              {subtitle}
            </span>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-white/[0.12] text-white/60 bg-white/[0.04]">
        {k}
      </kbd>
      <span className="text-white/60">{label}</span>
    </div>
  );
}

function HistoryRow({
  session,
  token,
  onVerify,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
  onVerify: () => void;
}) {
  const r = session.result;
  if (!r) return null;
  const win = r.pnlUnits > 0n;
  const push = r.pnlUnits === 0n;
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-all">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-white/80 truncate">
          {session.state.hands
            .flatMap((h) => h.cards.map(cardLabel))
            .join(" ") || "—"}
        </div>
        <div className="text-[10px] text-white/40 truncate">
          vs dealer {session.state.dealer.map(cardLabel).join(" ")}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={
            "text-[12px] font-mono font-semibold " +
            (win ? "text-emerald-300" : push ? "text-white/60" : "text-rose-300")
          }
        >
          {win ? "+" : ""}
          {fmtMoney(r.pnlUnits, token)}
        </div>
        <button
          type="button"
          onClick={onVerify}
          className="text-[10px] text-white/40 hover:text-emerald-300 cursor-pointer"
        >
          verify →
        </button>
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Verify modal
 * ========================================================================= */

function VerifyModal({
  session,
  revealedServerSeed,
  token,
  onClose,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  revealedServerSeed: string | null;
  token: TokenSpec;
  onClose: () => void;
}) {
  const [inputSeed, setInputSeed] = useState(revealedServerSeed ?? "");
  const verification = useMemo(() => {
    if (!inputSeed) return null;
    try {
      return verifyBlackjackSession(session, inputSeed);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }, [session, inputSeed]);

  const allOk =
    verification &&
    !("error" in verification) &&
    verification.hashOk &&
    verification.finalStateMatches &&
    verification.stepMatches.every(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0c0d12] border border-white/[0.08] p-6 space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              Provable fairness · client-side replay
            </div>
            <h2 className="text-xl font-semibold mt-1">Verify hand</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white cursor-pointer text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <p className="text-sm text-white/60 leading-relaxed">
          Paste the revealed <span className="text-emerald-300">server seed</span> for this
          hand. We re-derive the entire deal + every action in your browser using HMAC-SHA256
          and compare against the recorded state hashes. If the math doesn&apos;t match, the
          house cheated.
        </p>

        <div>
          <label className={labelCls}>Server seed (hex)</label>
          <input
            type="text"
            className={inputCls + " font-mono"}
            value={inputSeed}
            onChange={(e) => setInputSeed(e.target.value.trim())}
            placeholder="Rotate the seed to reveal yours, then paste here"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <VerifyField label="Published hash" value={session.serverSeedHash} mono />
          <VerifyField label="Client seed" value={session.clientSeed} mono />
          <VerifyField label="Start nonce" value={String(session.startNonce)} />
          <VerifyField label="End nonce" value={String(session.endNonce)} />
        </div>

        {!verification && (
          <div className="text-[12px] text-white/40">
            Enter a server seed above to run the replay.
          </div>
        )}

        {verification && "error" in verification && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
            Verifier threw: {verification.error}
          </div>
        )}

        {verification && !("error" in verification) && (
          <div className="space-y-3">
            <CheckRow ok={verification.hashOk} label="SHA-256(seed) == published hash" />
            <CheckRow ok={verification.finalStateMatches} label="Replayed final state matches recorded fingerprint" />
            <CheckRow
              ok={verification.stepMatches.every(Boolean)}
              label={`All ${verification.stepMatches.length} per-step hashes match`}
            />
            <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
              <div className="text-[11px] text-white/50 mb-1">Replayed final state</div>
              <div className="text-[12px] text-white/80">
                Player hands: {verification.replayedState.hands
                  .map((h, i) => `${i + 1}: ${h.cards.map(cardLabel).join(" ")}`)
                  .join(" · ")}
              </div>
              <div className="text-[12px] text-white/60">
                Dealer: {verification.replayedState.dealer.map(cardLabel).join(" ")}
              </div>
            </div>
            <div
              className={
                "text-center py-2 rounded-lg font-semibold " +
                (allOk
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                  : "bg-rose-500/15 text-rose-300 border border-rose-400/30")
              }
            >
              {allOk ? "✓ Verified provably fair" : "✗ Verification failed"}
            </div>
          </div>
        )}

        <div className="text-[11px] text-white/40 leading-relaxed">
          Settled at {new Date(session.updatedAt).toLocaleString()} · {session.actions.length} actions logged ·
          Result {fmtMoney(session.result?.pnlUnits ?? 0n, token)}.
        </div>

        <ShareLinkRow session={session} serverSeed={revealedServerSeed} />
      </div>
    </div>
  );
}

function VerifyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">{label}</div>
      <div className={"text-[12px] text-white/80 break-all " + (mono ? "font-mono" : "")}>
        {value}
      </div>
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={
          "w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold " +
          (ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")
        }
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className={ok ? "text-white/80" : "text-rose-200"}>{label}</span>
    </div>
  );
}

/* ===========================================================================
 *  Rules modal
 * ========================================================================= */

function RulesModal({
  config,
  onClose,
  onSave,
  inSession,
}: {
  config: BlackjackConfig;
  onClose: () => void;
  onSave: (c: BlackjackConfig) => void;
  inSession: boolean;
}) {
  const [draft, setDraft] = useState<BlackjackConfig>(config);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-[#0c0d12] border border-white/[0.08] p-6 space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
              Table rules
            </div>
            <h2 className="text-xl font-semibold mt-1">Customize the game</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white cursor-pointer text-2xl leading-none"
          >
            ×
          </button>
        </header>

        {inSession && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/20 text-[12px] text-amber-200">
            You&apos;re mid-hand — changes apply to the next deal.
          </div>
        )}

        <RuleField label="Number of decks">
          <select
            value={draft.numDecks}
            onChange={(e) => setDraft({ ...draft, numDecks: Number(e.target.value) })}
            className={inputCls}
          >
            {[1, 2, 4, 6, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </RuleField>

        <RuleToggle
          label="Dealer hits soft 17 (H17)"
          hint="H17 is the default Vegas / Atlantic-City rule. S17 is player-favorable by ~0.20%."
          value={draft.dealerHitsSoft17}
          onChange={(v) => setDraft({ ...draft, dealerHitsSoft17: v })}
        />

        <RuleField label="Blackjack pays">
          <select
            value={`${draft.blackjackPays.num}:${draft.blackjackPays.den}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split(":").map(Number);
              setDraft({ ...draft, blackjackPays: { num: n, den: d } });
            }}
            className={inputCls}
          >
            <option value="3:2">3:2 (standard)</option>
            <option value="6:5">6:5 (worse — house edge +1.4%)</option>
            <option value="2:1">2:1 (promo)</option>
          </select>
        </RuleField>

        <RuleToggle
          label="Double after split"
          hint="If on, you can double on hands that came from a split. Adds ~0.13% to RTP."
          value={draft.allowDoubleAfterSplit}
          onChange={(v) => setDraft({ ...draft, allowDoubleAfterSplit: v })}
        />

        <RuleToggle
          label="Late surrender"
          hint="Reclaim half the stake on your first 2 cards. Adds ~0.08% to RTP."
          value={draft.allowSurrender}
          onChange={(v) => setDraft({ ...draft, allowSurrender: v })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className={btnPrimary}
          >
            Save rules
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function RuleToggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-white/90">{label}</div>
        {hint && <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={
          "shrink-0 w-10 h-6 rounded-full transition-all relative " +
          (value ? "bg-emerald-500" : "bg-white/[0.1]")
        }
      >
        <span
          className={
            "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all " +
            (value ? "left-[18px]" : "left-0.5")
          }
        />
      </button>
    </div>
  );
}
