"use client";

import type { ReactNode } from "react";
import type { Card, ChainId, SeedPair, TokenSpec } from "@/lib/casino";
import { useCasino } from "./casino-context";
import { btnGhost, btnSecondary, card, inputCls, labelCls } from "./casino-ui";

/* ---- Money ---- */

export function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  return Number(`${units / denom}.${(units % denom).toString().padStart(token.decimals, "0")}`);
}

export function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}

export function fmtMoney(units: bigint, token: TokenSpec, maxFrac = 4): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  return `${sign}${unitsToHuman(abs, token).toLocaleString(undefined, { maximumFractionDigits: maxFrac })} ${token.symbol}`;
}

/* ---- Layout ---- */

export function TablePage({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 max-w-4xl mx-auto w-full pb-4 sm:pb-6">{children}</div>
  );
}

/** Wide shell for legacy 3-column tables (blackjack, coinflip, dice). */
export function LegacyThreeColLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-6xl mx-auto pb-6 lg:pb-0 mt-4 sm:mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
      {children}
    </div>
  );
}

/** Play area + sidebar (crash, plinko, mines, hilo, slots). */
export function InstantSideLayout({
  children,
  sidebarAt = "lg",
}: {
  children: ReactNode;
  sidebarAt?: "lg" | "xl";
}) {
  const cols =
    sidebarAt === "xl"
      ? "grid-cols-1 xl:grid-cols-[1fr,360px]"
      : "grid-cols-1 lg:grid-cols-[1fr,360px]";
  return (
    <div className={`w-full max-w-6xl mx-auto pb-6 lg:pb-0 mt-4 sm:mt-6 grid ${cols} gap-4 sm:gap-6`}>
      {children}
    </div>
  );
}

export function BalanceSummary({
  balance,
  token,
}: {
  balance: { available: bigint; locked: bigint };
  token: TokenSpec;
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Available</div>
      <div className="text-xl font-bold font-mono text-white tabular-nums">
        {fmtMoney(balance.available, token, 2)}
      </div>
      {balance.locked > 0n && (
        <div className="text-[11px] text-white/40 font-mono tabular-nums">
          {fmtMoney(balance.locked, token, 2)} locked
        </div>
      )}
    </div>
  );
}

/** Chain, balance, and optional dev play-money top bar on terminal tables. */
export function TableBalanceHeader({
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
  onShowRules?: () => void;
}) {
  const isDev = chainId === "dev-mock";
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4 sm:mb-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-white/40">Playing on</div>
        <div className="text-base font-semibold">
          {chainId} · <span className="text-emerald-300">{token.symbol}</span>
        </div>
        {onShowRules && (
          <button
            type="button"
            onClick={onShowRules}
            className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/40 hover:text-white/70 cursor-pointer"
          >
            Table rules
          </button>
        )}
      </div>
      <div className="flex flex-col items-end">
        <BalanceSummary balance={balance} token={token} />
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

/** Single-column play pages (poker, etc.). */
export function WideTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-6xl mx-auto pb-6 lg:pb-0 mt-4 sm:mt-6 space-y-4 sm:space-y-6">
      {children}
    </div>
  );
}

export function shortSeedHash(hash: string, head = 14, tail?: number): string {
  if (tail != null && tail > 0) {
    return hash.length <= head + tail ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
  }
  return hash.length <= head ? hash : `${hash.slice(0, head)}…`;
}

/** Inline provable-fairness footer on the main play surface. */
export function FairnessStrip({
  seedPair,
  onRotateSeed,
}: {
  seedPair: { serverSeedHash: string; nonce: number };
  onRotateSeed: () => void;
}) {
  return (
    <div className="mt-auto pt-5 border-t border-white/[0.06] flex items-center justify-between gap-3 flex-wrap text-[11px]">
      <div className="text-white/40 min-w-0">
        <span className="uppercase tracking-[0.12em]">server seed hash:</span>{" "}
        <span className="font-mono text-white/60 break-all">
          {shortSeedHash(seedPair.serverSeedHash, 18, 6)}
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
  );
}

/** Sidebar provable-fairness panel on instant games. */
export function FairnessCard({
  seedPair,
  onRotateSeed,
  children,
  nonceMode = "next",
  truncateClientSeed = true,
}: {
  seedPair: { serverSeedHash: string; clientSeed: string; nonce: number };
  onRotateSeed: () => void;
  children?: ReactNode;
  /** `next` shows nonce+1 (pre-bet); `current` shows the active ledger nonce (slots). */
  nonceMode?: "next" | "current";
  truncateClientSeed?: boolean;
}) {
  const nonceLabel = nonceMode === "current" ? "Nonce" : "Next nonce";
  const nonceValue = nonceMode === "current" ? seedPair.nonce : seedPair.nonce + 1;
  const clientSeedText = truncateClientSeed
    ? shortSeedHash(seedPair.clientSeed, 14)
    : seedPair.clientSeed;

  return (
    <section className={card + " p-5"}>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-semibold text-white">Provable fairness</h3>
        <button
          type="button"
          className="text-[11px] text-emerald-300 hover:text-emerald-200 cursor-pointer"
          onClick={onRotateSeed}
        >
          Rotate seed →
        </button>
      </div>
      <div className="text-[11px] text-white/60 space-y-1.5 leading-relaxed">
        <div>
          <span className="text-white/40">Server seed hash:</span>{" "}
          <span className="font-mono text-white/80 break-all">{shortSeedHash(seedPair.serverSeedHash, 14)}</span>
        </div>
        <div>
          <span className="text-white/40">Client seed:</span>{" "}
          <span className={"font-mono text-white/80 " + (truncateClientSeed ? "" : "break-all")}>
            {clientSeedText}
          </span>
        </div>
        <div>
          <span className="text-white/40">{nonceLabel}:</span>{" "}
          <span className="font-mono text-white/80">{nonceValue}</span>
        </div>
        {children ? <div className="mt-2 pt-2 border-t border-white/[0.06]">{children}</div> : null}
      </div>
    </section>
  );
}

/** Shown after seed rotation — paste into /casino/verify. */
export function RevealedSeedCard({
  serverSeed,
  publishedHash,
  onDismiss,
  hint,
  verifyDigest,
}: {
  serverSeed: string;
  publishedHash?: string;
  onDismiss: () => void;
  hint?: ReactNode;
  /** Show `sha256(seed) == …` under the full published hash (crash). */
  verifyDigest?: boolean;
}) {
  return (
    <section className={card + " p-4 border-emerald-400/30 bg-emerald-500/[0.04]"}>
      <div className="flex items-baseline justify-between mb-1.5">
        <h3 className="font-semibold text-emerald-200 text-[13px]">Server seed revealed</h3>
        <button
          type="button"
          className="text-[11px] text-white/40 hover:text-white/70 cursor-pointer"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      {hint ? <div className="text-[11px] text-white/55 leading-relaxed mb-2">{hint}</div> : null}
      <div className="text-[10px] text-white/60 font-mono break-all">{serverSeed}</div>
      {publishedHash ? (
        <>
          <div className="mt-2 text-[10px] text-white/40">Published hash:</div>
          <div className="text-[10px] text-white/60 font-mono break-all">{publishedHash}</div>
          {verifyDigest ? (
            <div className="mt-1.5 text-[10px] text-white/40">
              <code>sha256(seed) == {shortSeedHash(publishedHash, 18)}</code>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Dev-mock only: quick play-money top-up in the table sidebar. */
export function DevBankrollCard({
  chainId,
  token,
  onDeposit,
  amountHuman = 1000,
}: {
  chainId: ChainId;
  token: TokenSpec;
  onDeposit: () => void;
  amountHuman?: number;
}) {
  if (chainId !== "dev-mock") return null;
  return (
    <section className={card + " p-5"}>
      <h3 className="text-sm font-semibold text-white mb-2">Dev bankroll</h3>
      <p className="text-[12px] text-white/50 mb-3 leading-relaxed">
        Play money for testing. In production, fund the vault instead.
      </p>
      <button type="button" className={btnGhost + " w-full"} onClick={onDeposit}>
        +{amountHuman.toLocaleString()} {token.symbol}
      </button>
    </section>
  );
}

export function TableGrid({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_min(100%,220px)] gap-4 lg:gap-5">
      <section className={card + " p-4 sm:p-5 lg:p-6 space-y-4 min-w-0"}>{main}</section>
      <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">{aside}</aside>
    </div>
  );
}

export function TableHead({
  title,
  rtp,
  badge,
}: {
  title: string;
  rtp?: string;
  badge?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
      <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight">{title}</h2>
      <div className="flex items-center gap-2">
        {badge && (
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-400/35 text-amber-200/90 bg-amber-500/10">
            {badge}
          </span>
        )}
        {rtp && (
          <span className="text-[10px] uppercase tracking-wider text-white/40">RTP {rtp}</span>
        )}
      </div>
    </div>
  );
}

export function RulesHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-white/45 text-center leading-relaxed">{children}</p>;
}

/* ---- Cards ---- */

const panelTone = {
  player: "border-emerald-500/25 bg-emerald-500/5",
  dealer: "border-white/10 bg-white/[0.03]",
  board: "border-amber-500/20 bg-amber-500/5",
  accent: "border-orange-500/25 bg-orange-500/5",
} as const;

export function PlayingCard({
  c,
  hidden,
  large,
}: {
  c?: Card;
  hidden?: boolean;
  large?: boolean;
}) {
  const sz = large ? "w-12 h-16 sm:w-14 sm:h-[4.25rem]" : "w-11 h-[3.75rem] sm:w-12 sm:h-16";
  if (hidden || !c) {
    return (
      <div
        className={
          sz +
          " rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30 shrink-0 font-mono"
        }
      >
        ?
      </div>
    );
  }
  const red = c.suit === "♥" || c.suit === "♦";
  return (
    <div
      className={
        sz +
        " rounded-lg border flex flex-col items-center justify-center font-mono shrink-0 shadow-sm " +
        (red
          ? "border-rose-400/30 text-rose-200 bg-gradient-to-b from-rose-950/50 to-rose-950/20"
          : "border-white/15 text-white bg-gradient-to-b from-white/[0.08] to-white/[0.02]")
      }
    >
      <span className="text-sm sm:text-base font-bold leading-none">{c.rank}</span>
      <span className="text-[10px] sm:text-xs leading-none mt-0.5">{c.suit}</span>
    </div>
  );
}

export function HandPanel({
  label,
  cards,
  hiddenCount = 0,
  score,
  tone = "player",
  center = true,
}: {
  label: string;
  cards: Card[];
  hiddenCount?: number;
  score?: string | null;
  tone?: keyof typeof panelTone;
  center?: boolean;
}) {
  return (
    <div className={"rounded-xl border p-3 sm:p-4 " + panelTone[tone]}>
      <div className={labelCls + (tone === "player" ? " !text-emerald-200/70" : tone === "board" ? " !text-amber-200/70" : "")}>
        {label}
      </div>
      <div className={"flex flex-wrap gap-1.5 py-2 " + (center ? "justify-center" : "")}>
        {cards.map((c, i) => (
          <PlayingCard key={i} c={c} hidden={i >= cards.length - hiddenCount} />
        ))}
      </div>
      {score && <p className="text-center text-xs font-medium text-white/75">{score}</p>}
    </div>
  );
}

/* ---- Dice ---- */

export function DiceCube({
  value,
  highlight,
  size = "md",
}: {
  value: number;
  highlight?: boolean;
  size?: "md" | "lg";
}) {
  const sz = size === "lg" ? "w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] text-3xl" : "w-14 h-14 sm:w-16 sm:h-16 text-2xl sm:text-3xl";
  return (
    <div
      className={
        sz +
        " rounded-xl border-2 flex items-center justify-center font-mono font-bold shrink-0 transition-all " +
        (highlight
          ? "border-amber-400 bg-amber-500/20 text-amber-50 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
          : "border-white/15 bg-white/[0.06] text-white/90")
      }
    >
      {value}
    </div>
  );
}

export function DiceRow({
  dice,
  highlightValue,
}: {
  dice: number[];
  highlightValue?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 sm:gap-3 justify-center py-2">
      {dice.map((d, i) => (
        <DiceCube key={i} value={d} highlight={highlightValue != null && d === highlightValue} size="lg" />
      ))}
    </div>
  );
}

/* ---- Status ---- */

export function PhaseChip({ children, variant = "amber" }: { children: ReactNode; variant?: "amber" | "emerald" | "rose" }) {
  const cls =
    variant === "emerald"
      ? "border-emerald-400/40 text-emerald-200 bg-emerald-500/10"
      : variant === "rose"
        ? "border-rose-400/40 text-rose-200 bg-rose-500/10"
        : "border-amber-400/40 text-amber-200 bg-amber-500/10";
  return (
    <p className={"text-center text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border " + cls}>
      {children}
    </p>
  );
}

export function StreetSteps({
  steps,
  activeIndex,
  doneThrough,
}: {
  steps: string[];
  activeIndex: number;
  doneThrough?: number;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
      {steps.map((label, i) => {
        const done = i < (doneThrough ?? activeIndex);
        const active = i === activeIndex;
        return (
          <span
            key={label}
            className={
              "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors " +
              (done
                ? "border-emerald-400/40 text-emerald-200/90 bg-emerald-500/15"
                : active
                  ? "border-amber-400/50 text-amber-100 bg-amber-500/20"
                  : "border-white/10 text-white/35 bg-white/[0.02]")
            }
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function BetStatusPills({
  items,
}: {
  items: { label: string; active: boolean }[];
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {items.map((it) => (
        <span
          key={it.label}
          className={
            "text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border " +
            (it.active
              ? "border-emerald-400/40 text-emerald-200 bg-emerald-500/15"
              : "border-white/12 text-white/40 bg-white/[0.02] line-through decoration-white/25")
          }
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function PnlBanner({ pnl, token }: { pnl: bigint; token: TokenSpec }) {
  return (
    <p
      className={
        "text-center text-base sm:text-lg font-mono font-semibold " +
        (pnl > 0n ? "text-emerald-300" : pnl < 0n ? "text-rose-300" : "text-white/55")
      }
    >
      {pnl > 0n ? "+" : ""}
      {fmtMoney(pnl, token)}
    </p>
  );
}

/* ---- Controls ---- */

export function StakeRow({
  label,
  betAmount,
  onBetAmount,
  token,
  disabled,
  actionLabel,
  onAction,
  actionBusy,
  hideAction,
}: {
  label: string;
  betAmount: number;
  onBetAmount: (n: number) => void;
  token: TokenSpec;
  disabled?: boolean;
  actionLabel: string;
  onAction: () => void;
  actionBusy?: boolean;
  hideAction?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
      <div className="flex-1 min-w-0">
        <label className={labelCls}>{label}</label>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          className={inputCls}
          value={betAmount}
          onChange={(e) => onBetAmount(Number(e.target.value))}
          disabled={disabled}
        />
      </div>
      {!hideAction && (
        <button
          type="button"
          disabled={disabled || actionBusy}
          onClick={onAction}
          className={
            "min-h-12 touch-manipulation h-11 px-5 rounded-xl font-semibold text-sm w-full sm:w-auto sm:min-w-[8.5rem] " +
            "bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-black shadow-[0_4px_20px_rgba(245,158,11,0.35)] " +
            "hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
          }
        >
          {actionBusy ? "…" : actionLabel}
        </button>
      )}
    </div>
  );
}

/** Mobile-first action buttons: full-width stack, 2-col from sm. */
export function ActionStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">{children}</div>;
}

export function TableAside({
  balance,
  token,
  onRotateSeed,
  onVerify,
  hint,
  showBalance = true,
}: {
  balance: bigint;
  token: TokenSpec;
  onRotateSeed: () => void;
  onVerify?: () => void;
  hint?: string;
  /** Hide when play-money chip strip already shows balance. */
  showBalance?: boolean;
}) {
  const { playMoney } = useCasino();
  const showBal = showBalance && !playMoney.enabled;

  return (
    <>
      {showBal && (
        <section className={card + " p-4"}>
          <div className={labelCls}>Balance</div>
          <div className="text-lg font-mono text-emerald-300 tabular-nums">{fmtMoney(balance, token)}</div>
        </section>
      )}
      {hint && (
        <section className={card + " p-4 text-[11px] text-white/45 leading-relaxed"}>{hint}</section>
      )}
      <section className={card + " p-4 space-y-2"}>
        <button type="button" onClick={onRotateSeed} className={btnSecondary + " w-full !text-xs !min-h-10 !h-10"}>
          Rotate seed
        </button>
        {onVerify && (
          <button
            type="button"
            onClick={onVerify}
            className="text-xs text-emerald-300 hover:text-emerald-200 w-full text-left cursor-pointer py-1"
          >
            Verify hand →
          </button>
        )}
      </section>
    </>
  );
}

export function NewHandButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={btnGhost + " w-full sm:w-auto mx-auto block"}>
      New hand
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <p className="text-sm text-rose-300 text-center">{message}</p>;
}

/** Win/loss summary for one-shot (dice/craps/keno) rounds. */
export function SettlementBanner({
  headline,
  pnl,
  token,
}: {
  headline: string;
  pnl: bigint;
  token: TokenSpec;
}) {
  const tone =
    pnl > 0n
      ? "border-emerald-400/30 bg-emerald-500/10"
      : pnl < 0n
        ? "border-rose-400/30 bg-rose-500/10"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={"rounded-xl border p-4 space-y-2 text-center " + tone}>
      <p className="text-sm font-medium text-white/85">{headline}</p>
      <PnlBanner pnl={pnl} token={token} />
    </div>
  );
}

/** Numeric pick grid (chuck-a-luck, sic-bo faces, etc.). */
/** Toggleable bet / option tile (Sic Bo, wheel multipliers, etc.). */
export function ChoiceButton({
  active,
  disabled,
  onClick,
  label,
  hint,
  className = "",
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "touch-manipulation min-h-12 rounded-xl border-2 px-2 py-2 text-left transition-all cursor-pointer disabled:opacity-50 " +
        (active
          ? "border-amber-400 bg-amber-500/15 text-amber-50"
          : "border-white/10 bg-white/[0.04] text-white/75 hover:border-white/25") +
        " " +
        className
      }
    >
      <span className="block text-sm font-semibold">{label}</span>
      {hint && <span className="block text-[10px] text-white/45 mt-0.5">{hint}</span>}
    </button>
  );
}

/** Keno / lotto-style number board. */
export function KenoBoard({
  pool,
  picks,
  drawn,
  disabled,
  onToggle,
}: {
  pool: number;
  picks: number[];
  drawn: number[];
  disabled?: boolean;
  onToggle: (n: number) => void;
}) {
  const pickSet = new Set(picks);
  const drawnSet = new Set(drawn);
  return (
    <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 sm:gap-2">
      {Array.from({ length: pool }, (_, i) => i + 1).map((n) => {
        const selected = pickSet.has(n);
        const hit = drawn.length > 0 && selected && drawnSet.has(n);
        const drawnOnly = drawn.length > 0 && !selected && drawnSet.has(n);
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(n)}
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
  );
}

export function PickGrid({
  values,
  selected,
  onSelect,
  disabled,
}: {
  values: number[];
  selected: number;
  onSelect: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {values.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(n)}
          className={
            "min-h-12 touch-manipulation rounded-xl font-bold text-lg border transition-all cursor-pointer " +
            (selected === n
              ? "border-amber-400/60 bg-amber-500/25 text-amber-50 shadow-[0_0_16px_rgba(245,158,11,0.15)]"
              : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25 active:scale-[0.98] disabled:opacity-40")
          }
        >
          {n}
        </button>
      ))}
    </div>
  );
}
