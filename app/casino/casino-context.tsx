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
  buildAuthSessionDriver,
  buildAnonymousSessionDriver,
  type BuiltSessionDriver,
  type ChainId,
  type Ledger,
  type SeedPair,
  type Session,
  type TokenSpec,
} from "@/lib/casino";
import {
  GUEST_STARTING_UNITS,
  getOrCreateGuestProfile,
  markGuestStartingBalanceGranted,
  rerollGuestDisplayName,
  type GuestProfile,
} from "@/lib/casino/guest-play";
import { useWallet } from "@/lib/wallet-context";
import { PlayMoneyBar } from "./play-money-bar";

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
  driver: BuiltSessionDriver["driver"];
  /** Ledger interface — read balance or credit play money. */
  ledger: Ledger;
  /** Userid being used to key ledger rows (Supabase UUID or dev placeholder). */
  userId: string;
  /**
   * When true the ledger and seed pair are persisted to Supabase under
   * the authenticated user. When false everything is in-memory only —
   * useful for "try before you sign up" mode.
   */
  persistent: boolean;
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
  /** Credit fictional play money (dev-mock chain only). */
  depositPlayMoney: (amount: bigint) => Promise<void>;
  /** Guest free-play (dev-mock): random username, chip buttons, no sign-in. */
  playMoney: {
    enabled: boolean;
    displayName: string;
    rerollDisplayName: () => void;
    addChips: (amount: bigint) => Promise<void>;
  };
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

const HISTORY_STORAGE_KEY = "mf_casino_history_v1";

/** Serialize a history entry to a JSON-safe shape (bigints → strings). */
function serializeEntry(e: CasinoHistoryEntry): unknown {
  return {
    ...e,
    stakeUnits: e.stakeUnits.toString(),
    pnlUnits: e.pnlUnits.toString(),
    session: JSON.parse(
      JSON.stringify(e.session, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ),
  };
}

/** Deserialize a stored history row back into runtime form. */
function deserializeEntry(raw: CasinoHistoryEntry & { stakeUnits: string; pnlUnits: string }): CasinoHistoryEntry {
  return {
    ...raw,
    stakeUnits: BigInt(raw.stakeUnits),
    pnlUnits: BigInt(raw.pnlUnits),
  };
}

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
  const { user } = useWallet();
  const isPlayMoney = chainId === "dev-mock";

  const [guestProfile, setGuestProfile] = useState<GuestProfile | null>(null);
  useEffect(() => {
    setGuestProfile(getOrCreateGuestProfile());
  }, []);

  // Play money always uses the guest ledger (even if signed in). Real chains use auth.
  const userId = isPlayMoney
    ? (guestProfile?.guestId ?? "guest-loading")
    : (user?.id ?? guestProfile?.guestId ?? "guest-loading");

  const built = useMemo<BuiltSessionDriver>(() => {
    if (isPlayMoney && guestProfile) {
      return buildAnonymousSessionDriver({
        defaultUserId: guestProfile.guestId,
        defaultChainId: chainId,
        defaultToken: token,
      });
    }
    if (user?.id) {
      return buildAuthSessionDriver({
        userId: user.id,
        chainId,
        token,
      });
    }
    return buildAnonymousSessionDriver({
      defaultUserId: guestProfile?.guestId ?? "guest-anon",
      defaultChainId: chainId,
      defaultToken: token,
    });
  }, [isPlayMoney, guestProfile?.guestId, user?.id, chainId, token.symbol, token.address]);
  const { driver, ledger, getSeedPair, rotateSeed: rawRotate, persistent, reloadSeedPair } = built;

  const [balance, setBalance] = useState<{ available: bigint; locked: bigint }>({
    available: 0n,
    locked: 0n,
  });
  const refreshBalance = useCallback(async () => {
    try {
      const b = await ledger.getBalance(userId, chainId, token);
      setBalance({ available: b.available, locked: b.locked });
    } catch (e) {
      // Most likely RLS rejection because the user logged out mid-call —
      // surface as zero balance rather than crashing the game UI.
      console.warn("CasinoContext.refreshBalance:", (e as Error).message);
      setBalance({ available: 0n, locked: 0n });
    }
  }, [ledger, userId, chainId, token]);
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // When auth-mode driver mounts, pull the active seed pair from Supabase
  // so the UI shows the persisted commit hash (and the nonce continues
  // from where the previous session left off).
  useEffect(() => {
    if (!persistent) return;
    void reloadSeedPair();
  }, [persistent, reloadSeedPair]);

  // History persisted to localStorage so it survives navigations to
  // /casino/history, /casino/verify, etc. Capped at 250 most-recent rows.
  // Key by userId so signing in/out cleanly switches histories rather
  // than mixing anonymous play with authed play.
  const historyStorageKey = `${HISTORY_STORAGE_KEY}:${userId}`;
  const [history, setHistory] = useState<CasinoHistoryEntry[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") {
      setHistory([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(historyStorageKey);
      if (!raw) {
        setHistory([]);
        return;
      }
      const parsed = JSON.parse(raw) as Array<CasinoHistoryEntry & { stakeUnits: string; pnlUnits: string }>;
      setHistory(parsed.map(deserializeEntry));
    } catch {
      // corrupted store — start fresh
      setHistory([]);
    }
  }, [historyStorageKey]);
  const pushHistory = useCallback((e: Omit<CasinoHistoryEntry, "at">) => {
    setHistory((prev) => {
      const next: CasinoHistoryEntry = { ...e, at: new Date().toISOString() };
      const merged = [next, ...prev].slice(0, 250);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            historyStorageKey,
            JSON.stringify(merged.map(serializeEntry)),
          );
        } catch {
          // quota exceeded / disabled — non-fatal
        }
      }
      return merged;
    });
  }, [historyStorageKey]);

  const [lastRevealedSeed, setLastRevealedSeed] = useState<{ serverSeed: string; hash: string } | null>(null);
  const rotateSeed = useCallback(() => {
    const r = rawRotate();
    setLastRevealedSeed({ serverSeed: r.retired.serverSeed ?? "", hash: r.retired.serverSeedHash });
    return r;
  }, [rawRotate]);
  const dismissRevealedSeed = useCallback(() => setLastRevealedSeed(null), []);

  // Fresh in-memory ledger each load — auto-credit when broke so guests never get stuck.
  useEffect(() => {
    if (!isPlayMoney || !guestProfile) return;
    let cancelled = false;
    void (async () => {
      try {
        const b = await ledger.getBalance(userId, chainId, token);
        if (cancelled) return;
        if (b.available === 0n && b.locked === 0n) {
          await ledger.credit({
            userId,
            chainId,
            token,
            delta: GUEST_STARTING_UNITS,
            reason: "deposit",
          });
          if (!guestProfile.startingBalanceGranted) {
            markGuestStartingBalanceGranted();
            setGuestProfile((p) => (p ? { ...p, startingBalanceGranted: true } : p));
          }
          await refreshBalance();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPlayMoney, guestProfile?.guestId, ledger, userId, chainId, token, refreshBalance, guestProfile?.startingBalanceGranted]);

  const addChips = useCallback(
    async (amount: bigint) => {
      if (!isPlayMoney) {
        throw new Error("Free chips are only available on Dev / Play Money.");
      }
      if (amount <= 0n) return;
      await ledger.credit({ userId, chainId, token, delta: amount, reason: "deposit" });
      await refreshBalance();
    },
    [isPlayMoney, ledger, userId, chainId, token, refreshBalance],
  );

  const depositPlayMoney = addChips;

  const rerollDisplayName = useCallback(() => {
    const next = rerollGuestDisplayName();
    setGuestProfile(next);
  }, []);

  const playMoney = useMemo(
    () => ({
      enabled: isPlayMoney && !!guestProfile,
      displayName: guestProfile?.displayName ?? "Guest",
      rerollDisplayName,
      addChips,
    }),
    [isPlayMoney, guestProfile, rerollDisplayName, addChips],
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
      userId,
      persistent,
      getSeedPair,
      rotateSeed,
      balance,
      refreshBalance,
      history,
      pushHistory,
      depositPlayMoney,
      playMoney,
      stats,
      lastRevealedSeed,
      dismissRevealedSeed,
    }),
    [chainId, token, driver, ledger, userId, persistent, getSeedPair, rotateSeed, balance, refreshBalance, history, pushHistory, depositPlayMoney, playMoney, stats, lastRevealedSeed, dismissRevealedSeed],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PlayMoneyBar />
    </Ctx.Provider>
  );
}
