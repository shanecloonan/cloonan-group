"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  blackjackGame,
  buildDevSessionDriver,
  CasinoSessionDriver,
  cardLabel,
  cryptoRandomId,
  DEFAULT_BLACKJACK_CONFIG,
  evaluateHand,
  newSessionId,
  type BlackjackAction,
  type BlackjackActionType,
  type BlackjackState,
  type Card as CasinoCard,
  type ChainAdapter,
  type ChainId,
  type Session,
  type TokenSpec,
} from "@/lib/casino";

/* ---------------------------------------------------------------------------
 *  Styling
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls =
  "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary =
  "h-10 px-5 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnSecondary =
  "h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";

/* ---------------------------------------------------------------------------
 *  Money helpers — UI works in human units, engine in bigint
 * ------------------------------------------------------------------------- */

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  // Convert to number via a string to avoid precision loss for typical balances.
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
  /* ----- Stable driver (in-memory ledger for dev mode) ----- */
  const userId = useMemo(() => `dev-${cryptoRandomId()}`, []);

  const { driver, ledger, getSeedPair, rotateSeed } = useMemo(
    () =>
      buildDevSessionDriver({
        defaultUserId: userId,
        defaultChainId: chainId,
        defaultToken: token,
        seedInitialBalance: humanToUnits(10_000, token),
      }),
    // We intentionally don't re-build when chainId/token change at runtime —
    // the dev ledger is process-global. Switching chains in dev mode just
    // adds another (chain, token) bucket to the same ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ----- State ----- */
  const [balance, setBalance] = useState<{ available: bigint; locked: bigint }>({
    available: 0n,
    locked: 0n,
  });
  const refreshBalance = useCallback(async () => {
    const b = await ledger.getBalance(userId, chainId, token);
    setBalance({ available: b.available, locked: b.locked });
  }, [ledger, userId, chainId, token]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const [betAmount, setBetAmount] = useState(25);
  const [session, setSession] = useState<Session<BlackjackAction, BlackjackState> | null>(null);
  const [history, setHistory] = useState<Session<BlackjackAction, BlackjackState>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealSeed, setRevealSeed] = useState<{ serverSeed: string; hash: string } | null>(null);

  /* ----- Actions ----- */

  const deal = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const stake = humanToUnits(betAmount, token);
      if (stake <= 0n) throw new Error("Bet must be > 0");
      const opened = await driver.openSession(blackjackGame, {
        sessionId: newSessionId(),
        userId,
        gameId: blackjackGame.id,
        chainId,
        token,
        stake,
        config: DEFAULT_BLACKJACK_CONFIG as unknown as Record<string, unknown>,
      });
      let next = opened;
      // Natural blackjack on the deal — engine sets phase directly to
      // "settled" so we can finalize without a player action.
      if (blackjackGame.isTerminal(next.state)) {
        next = await driver.settleSession(blackjackGame, next);
        setHistory((h) => [next, ...h].slice(0, 20));
      }
      setSession(next);
      await refreshBalance();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [driver, userId, chainId, token, betAmount, refreshBalance]);

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
          setHistory((h) => [next, ...h].slice(0, 20));
        }
        setSession(next);
        await refreshBalance();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [driver, session, refreshBalance],
  );

  const clearTable = () => setSession(null);

  const onRotateSeed = useCallback(() => {
    const { retired } = rotateSeed();
    setRevealSeed({ serverSeed: retired.serverSeed ?? "", hash: retired.serverSeedHash });
  }, [rotateSeed]);

  const onDepositPlay = useCallback(async () => {
    // Dev-mode "deposit" — just seed the ledger with extra play money.
    await ledger.credit({
      userId,
      chainId,
      token,
      delta: humanToUnits(10_000, token),
      reason: "deposit",
    });
    await refreshBalance();
  }, [ledger, userId, chainId, token, refreshBalance]);

  const seedPair = getSeedPair();
  const legal = session ? blackjackGame.legalActions(session.state) : [];
  const legalSet = new Set(legal.map((l) => l.type));

  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column: table */}
      <section className={card + " p-6 lg:col-span-2 min-h-[520px] flex flex-col"}>
        <Header
          chainId={chainId}
          token={token}
          balance={balance}
          onDeposit={onDepositPlay}
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
            onAction={applyAction}
            onClear={clearTable}
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
          <div className="text-white/40">
            <span className="uppercase tracking-[0.12em]">server seed hash:</span>{" "}
            <span className="font-mono text-white/60 break-all">
              {seedPair.serverSeedHash}
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
            Rotate seed
          </button>
        </div>
      </section>

      {/* Right column: side panels */}
      <aside className="space-y-4">
        <SidePanel title="House rules">
          <ul className="text-[12px] text-white/70 space-y-1.5">
            <li>· {DEFAULT_BLACKJACK_CONFIG.numDecks} decks</li>
            <li>· Dealer hits soft 17</li>
            <li>· Blackjack pays 3:2</li>
            <li>· Double on any 2 / DAS allowed</li>
            <li>· Up to {DEFAULT_BLACKJACK_CONFIG.maxHands} hands from splits</li>
            <li>· Insurance pays 2:1</li>
            <li>· House edge ≈ 0.42%</li>
          </ul>
        </SidePanel>

        <SidePanel title="Hand history" subtitle={`${history.length} settled`}>
          {history.length === 0 && (
            <div className="text-[12px] text-white/40">No hands yet. Place a bet to play.</div>
          )}
          <div className="space-y-2 max-h-[320px] overflow-y-auto">
            {history.map((h) => (
              <HistoryRow key={h.id} session={h} token={token} />
            ))}
          </div>
        </SidePanel>

        {revealSeed && (
          <SidePanel title="Last revealed server seed" subtitle="hash matches → fair">
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
              onClick={() => setRevealSeed(null)}
              className="mt-3 text-[11px] text-white/40 hover:text-white cursor-pointer"
            >
              Dismiss →
            </button>
          </SidePanel>
        )}
      </aside>
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
}: {
  chainId: ChainId;
  token: TokenSpec;
  balance: { available: bigint; locked: bigint };
  onDeposit: () => void;
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
  const QUICK = [5, 25, 100, 500];
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
          />
          <button
            type="button"
            disabled={disabled}
            onClick={onDeal}
            className={btnPrimary + " whitespace-nowrap"}
          >
            Deal
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
            onClick={() => setBetAmount(Math.floor(unitsToHuman(balance.available, token) / 2))}
            className="text-[11px] px-2.5 h-7 rounded-md bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition-all"
          >
            ½ stack
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
  onAction,
  onClear,
  busy,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
  legal: Set<BlackjackActionType>;
  onAction: (a: BlackjackActionType) => void;
  onClear: () => void;
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
        <div className="flex justify-center items-center gap-2">
          {dealerVisibleCards.map((c, i) => (
            <CardChip key={i} card={c} />
          ))}
          {dealerHidden && <CardChip hidden />}
        </div>
      </div>

      {/* Felt center */}
      <div className="my-6 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      {/* Player hands */}
      <div className="space-y-5">
        {state.hands.map((hand, i) => {
          const val = evaluateHand(hand.cards);
          const isActive = state.phase === "player_turn" && i === state.activeHand;
          return (
            <div
              key={i}
              className={
                "p-3 rounded-xl border " +
                (isActive
                  ? "border-emerald-400/40 bg-emerald-500/5"
                  : "border-white/[0.05] bg-white/[0.02]")
              }
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">
                  Hand {i + 1} {hand.fromSplit ? "(split)" : ""}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-white/60">Bet {Number(hand.stake) / 10 ** token.decimals} {token.symbol}</span>
                  <span className="text-white/80 font-mono">
                    {val.total}{val.soft ? " (soft)" : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hand.cards.map((c, j) => (
                  <CardChip key={j} card={c} />
                ))}
              </div>
              {hand.busted && (
                <div className="mt-2 text-[11px] text-rose-300">BUST</div>
              )}
              {hand.stood && !hand.busted && (
                <div className="mt-2 text-[11px] text-white/40">STAND</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action row */}
      <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
        {state.phase === "insurance_offered" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("insurance")}
              className={btnPrimary}
            >
              Take insurance
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("decline_insurance")}
              className={btnSecondary}
            >
              No thanks
            </button>
          </>
        ) : state.phase === "settled" ? (
          <Settlement session={session} token={token} onClear={onClear} />
        ) : (
          <>
            <ActionButton label="Hit" enabled={legal.has("hit") && !busy} onClick={() => onAction("hit")} />
            <ActionButton label="Stand" enabled={legal.has("stand") && !busy} onClick={() => onAction("stand")} />
            <ActionButton label="Double" enabled={legal.has("double") && !busy} onClick={() => onAction("double")} />
            <ActionButton label="Split" enabled={legal.has("split") && !busy} onClick={() => onAction("split")} />
          </>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={
        "h-10 px-5 rounded-lg font-semibold text-sm border transition-all " +
        (enabled
          ? "bg-white/[0.06] border-white/[0.12] text-white hover:bg-white/[0.1] cursor-pointer active:scale-95"
          : "bg-white/[0.02] border-white/[0.04] text-white/30 cursor-not-allowed")
      }
    >
      {label}
    </button>
  );
}

function Settlement({
  session,
  token,
  onClear,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
  onClear: () => void;
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
          (isWin
            ? "text-emerald-400"
            : isPush
              ? "text-white/80"
              : "text-rose-400")
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
      <button
        type="button"
        onClick={onClear}
        className="h-10 px-6 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
      >
        New hand →
      </button>
    </div>
  );
}

function CardChip({ card, hidden }: { card?: CasinoCard; hidden?: boolean }) {
  if (hidden || !card) {
    return (
      <div className="w-14 h-20 rounded-lg bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-500/40 flex items-center justify-center text-white/60 text-xs select-none">
        ⌑
      </div>
    );
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div
      className={
        "w-14 h-20 rounded-lg border bg-white/[0.95] text-black flex flex-col items-center justify-center font-bold select-none " +
        (red ? "text-rose-600" : "text-stone-900")
      }
    >
      <span className="text-base leading-none">{card.rank}</span>
      <span className="text-lg leading-none mt-0.5">{card.suit}</span>
    </div>
  );
}

function SidePanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function HistoryRow({
  session,
  token,
}: {
  session: Session<BlackjackAction, BlackjackState>;
  token: TokenSpec;
}) {
  const r = session.result;
  if (!r) return null;
  const win = r.pnlUnits > 0n;
  const push = r.pnlUnits === 0n;
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="min-w-0">
        <div className="text-[12px] text-white/80 truncate">
          {session.state.hands
            .flatMap((h) => h.cards.map(cardLabel))
            .join(" ") || "—"}
        </div>
        <div className="text-[10px] text-white/40 truncate">
          vs dealer {session.state.dealer.map(cardLabel).join(" ")}
        </div>
      </div>
      <div
        className={
          "text-[12px] font-mono font-semibold " +
          (win ? "text-emerald-300" : push ? "text-white/60" : "text-rose-300")
        }
      >
        {win ? "+" : ""}
        {fmtMoney(r.pnlUnits, token)}
      </div>
    </div>
  );
}

/* Silence unused-import warnings for types we re-export but don't reference at runtime. */
void CasinoSessionDriver;
