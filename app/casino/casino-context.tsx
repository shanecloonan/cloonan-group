"use client";

/* ===========================================================================
 *  CasinoContext
 *  ---------------------------------------------------------------------------
 *  Single source of truth for everything that should persist across game-tab
 *  switches:
 *
 *    • The session driver (and the in-memory ledger backing it in dev mode).
 *    • The active seed pair (so the player's seed lifecycle is continuous,
 *      not per-game).
 *    • Cross-game settled-session history.
 *    • Live balance per (chain, token).
 *
 *  Each individual game table no longer spins up its own
 *  `buildDevSessionDriver()` — instead it consumes this context. Switching
 *  from blackjack → coinflip → dice now preserves balance, seed pair, and
 *  history.
 *
 *  In prod (real auth + real chain), the context would swap the
 *  `InMemoryLedger` for `SupabaseLedger` and `DevMockAdapter` for the
 *  appropriate `EthereumAdapter` / `SolanaAdapter`. The game tables don't
 *  know or care.
 * ========================================================================= */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  buildDevSessionDriver,
  cryptoRandomId,
  type ChainId,
  type SeedPair,
  type Session,
  type TokenSpec,
} from "@/lib/casino";

/* ---------------------------------------------------------------------------
 *  Types
 * ------------------------------------------------------------------------- */

export interface CasinoHistoryEntry {
  /** GameId, e.g. "blackjack". */
  game: string;
  /** When it settled, ISO. */
  at: string;
  /** Stake in token base units. */
  stakeUnits: bigint;
  /** PnL in token base units (positive = profit). */
  pnlUnits: bigint;
  /** Multiplier on the wager (totalPayout / stake). */
  multiplier: number;
  /** Full session for verify-modal access. */
  session: Session<unknown, unknown>;
}

export interface CasinoContextValue {
  /** Chain currently being played on. */
  chainId: ChainId;
  /** Token currently being played with. */
  token: TokenSpec;
  /** Session driver shared by every game. */
  driver: ReturnType<typeof buildDevSessionDriver>["driver"];
  /** Ledger interface — read balance or credit play money. */
  ledger: ReturnType<typeof buildDevSessionDriver>["ledger"];
  /** Active seed pair (the *current* one, not retired). */
  getSeedPair: () => SeedPair;
  /** Rotate the active seed; return the retired one (now revealable). */
  rotateSeed: () => { retired: SeedPair; next: SeedPair };
  /** Available balance for (chainId, token). */
  balance: { available: bigint; locked: bigint };
  /** Pull a fresh balance reading. */
  refreshBalance: () => Promise<void>;
  /** Cross-game settled-session log, most-recent first, capped at 100. */
  history: CasinoHistoryEntry[];
  /** Append a freshly-settled session to the cross-game history. */
  pushHistory: (entry: Omit<CasinoHistoryEntry, "at">) => void;
  /** Credit fictional play money (dev mode only). */
  depositPlayMoney: (amount: bigint) => Promise<void>;
  /** Lifetime aggregate stats for the in-memory dev session. */
  stats: {
    sessionsPlayed: number;
    totalWageredUnits: bigint;
    totalPnlUnits: bigint;
    biggestWinUnits: bigint;
    biggestLossUnits: bigint;
  };
  /** Last revealed (rotated) server seed, exposed for verify modals. */
  lastRevealedSeed: { serverSeed: string; hash: string } | null;
  dismissRevealedSeed: () => void;
}

const Ctx = createContext<CasinoContextValue | null>(null);

/** Imperative hook for game-table components. Throws if used outside provider. */
export function useCasino(): CasinoContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCasino: must be wrapped in <CasinoProvider>");
  return v;
}

/* ---------------------------------------------------------------------------
 *  Provider
 * ------------------------------------------------------------------------- */

export function CasinoProvider({
  chainId,
  token,
  children,
}: {
  chainId: ChainId;
  token: TokenSpec;
  children: React.ReactNode;
}) {
  // Stable per-tab synthetic userId for the in-memory dev ledger. In prod
  // this would be the authed Supabase user id.
  const userId = useMemo(() => `dev-${cryptoRandomId()}`, []);

  // Build the dev driver ONCE per (chain, token) pair. Switching chain or
  // token swaps the working environment but preserves the seed pair below.
  const { driver, ledger, getSeedPair, rotateSeed: rawRotate } = useMemo(
    () =>
      buildDevSessionDriver({
        defaultUserId: userId,
        defaultChainId: chainId,
        defaultToken: token,
        seedInitialBalance: 10_000n * 10n ** BigInt(token.decimals),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, token.symbol, token.address],
  );

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

  const [history, setHistory] = useState<CasinoHistoryEntry[]>([]);
  const pushHistory = useCallback((e: Omit<CasinoHistoryEntry, "at">) => {
    setHistory((prev) => {
      const next: CasinoHistoryEntry = { ...e, at: new Date().toISOString() };
      return [next, ...prev].slice(0, 100);
    });
  }, []);

  const [lastRevealedSeed, setLastRevealedSeed] = useState<{ serverSeed: string; hash: string } | null>(null);
  const rotateSeed = useCallback(() => {
    const r = rawRotate();
    setLastRevealedSeed({ serverSeed: r.retired.serverSeed ?? "", hash: r.retired.serverSeedHash });
    return r;
  }, [rawRotate]);
  const dismissRevealedSeed = useCallback(() => setLastRevealedSeed(null), []);

  const depositPlayMoney = useCallback(
    async (amount: bigint) => {
      await ledger.credit({ userId, chainId, token, delta: amount, reason: "deposit" });
      await refreshBalance();
    },
    [ledger, userId, chainId, token, refreshBalance],
  );

  // Lifetime aggregates derived from in-memory history.
  const stats = useMemo(() => {
    let totalWagered = 0n;
    let totalPnl = 0n;
    let biggestWin = 0n;
    let biggestLoss = 0n;
    for (const e of history) {
      totalWagered += e.stakeUnits;
      totalPnl += e.pnlUnits;
      if (e.pnlUnits > biggestWin) biggestWin = e.pnlUnits;
      if (e.pnlUnits < biggestLoss) biggestLoss = e.pnlUnits;
    }
    return {
      sessionsPlayed: history.length,
      totalWageredUnits: totalWagered,
      totalPnlUnits: totalPnl,
      biggestWinUnits: biggestWin,
      biggestLossUnits: biggestLoss,
    };
  }, [history]);

  const value: CasinoContextValue = useMemo(
    () => ({
      chainId,
      token,
      driver,
      ledger,
      getSeedPair,
      rotateSeed,
      balance,
      refreshBalance,
      history,
      pushHistory,
      depositPlayMoney,
      stats,
      lastRevealedSeed,
      dismissRevealedSeed,
    }),
    [chainId, token, driver, ledger, getSeedPair, rotateSeed, balance, refreshBalance, history, pushHistory, depositPlayMoney, stats, lastRevealedSeed, dismissRevealedSeed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
