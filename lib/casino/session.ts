/* ===========================================================================
 *  MoneyFund Casino — Session driver (Layer 4)
 *  ---------------------------------------------------------------------------
 *  The ONLY place where game logic, RNG, and balance ledger meet.
 *
 *  A session is the lifecycle of one round of one game. For blackjack
 *  that's "one hand from deal to settle". For dice it's one roll.
 *  Multiplayer games (poker, crash) will use a different session shape but
 *  conform to the same lifecycle: open → step* → settle.
 *
 *  Key invariants this layer enforces (so games don't have to):
 *    • Every action is validated against `game.legalActions(state)`.
 *    • The RNG nonce is bumped exactly once per action that consumes RNG.
 *    • Every action is appended to an immutable log with the post-state hash.
 *    • Balance lock changes are atomic with respect to state changes.
 *    • A bug in a game module can never leak funds — the session driver
 *      reconciles `totalStakedUnits` against ledger debits at settle time.
 * ========================================================================= */

import type {
  Bet,
  ChainId,
  Game,
  RngStream,
  SeedPair,
  Session,
  SessionAction,
  TokenSpec,
} from "./types";
import { HmacRngStream, cryptoRandomId, cryptoRandomUuid } from "./rng";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "./rng";

/* ---------------------------------------------------------------------------
 *  Hashing helper for the audit log
 * ------------------------------------------------------------------------- */

/**
 * Hash the game-state JSON. Used to fingerprint each step so the audit log
 * is tamper-evident even before we publish to Arweave.
 */
export function hashState(state: unknown): string {
  const enc = new TextEncoder();
  // bigint isn't JSON.stringify-able by default; coerce to string.
  const serialized = JSON.stringify(state, (_k, v) =>
    typeof v === "bigint" ? `${v}n` : v,
  );
  return bytesToHex(sha256(enc.encode(serialized)));
}

/* ---------------------------------------------------------------------------
 *  Session driver
 * ------------------------------------------------------------------------- */

export interface DriverDependencies {
  ledger: Ledger;
  /** Source of the active seed pair for a user. */
  getActiveSeedPair: (userId: string) => Promise<SeedPair>;
  /** Persist the bumped nonce of a seed pair after consuming RNG. */
  saveSeedPair: (pair: SeedPair) => Promise<void>;
}

export class CasinoSessionDriver {
  private deps: DriverDependencies;

  constructor(deps: DriverDependencies) {
    this.deps = deps;
  }

  /**
   * Open a new session. Locks the stake against the user's balance,
   * snapshots the active seed pair, and produces the opening state via
   * the supplied game module.
   *
   * Throws synchronously if the user lacks funds or the game refuses the
   * bet. Either side of the throw, no funds have moved.
   */
  async openSession<Action, State>(
    game: Game<Action, State>,
    bet: Bet,
  ): Promise<Session<Action, State>> {
    if (bet.stake <= 0n) throw new Error("openSession: stake must be > 0");

    // Reserve funds first so a clever player can't open many concurrent
    // sessions that all "succeed" against the same balance.
    await this.deps.ledger.lock({
      userId: bet.userId,
      chainId: bet.chainId,
      token: bet.token,
      delta: bet.stake,
      reason: "session_lock",
      sessionId: bet.sessionId,
    });

    // Pull seed pair and consume nonce(s) from it.
    const seedPair = await this.deps.getActiveSeedPair(bet.userId);
    const startNonce = seedPair.nonce + 1; // session uses [startNonce..endNonce]

    // Build the opening state with an RNG stream pinned to startNonce.
    const rng = new HmacRngStream(seedPair, startNonce);
    const state = game.initialState(bet, rng);

    // Bump nonce on the seed pair.
    const updatedPair: SeedPair = { ...seedPair, nonce: startNonce };
    await this.deps.saveSeedPair(updatedPair);

    const now = new Date().toISOString();
    const session: Session<Action, State> = {
      id: bet.sessionId,
      userId: bet.userId,
      gameId: game.id,
      chainId: bet.chainId,
      token: bet.token,
      stake: bet.stake,
      state,
      status: "open",
      seedPairId: seedPair.id,
      serverSeedHash: seedPair.serverSeedHash,
      clientSeed: seedPair.clientSeed,
      startNonce,
      endNonce: startNonce,
      actions: [
        {
          ordinal: 0,
          actor: "system",
          action: "deal" as unknown as Action,
          nonceAfter: startNonce,
          stateHash: hashState(state),
          at: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    return session;
  }

  /**
   * Apply a player action. Validates against `legalActions`, bumps the
   * nonce, appends to the audit log, and (if the game's settlement layer
   * needs extra money for a double/split/insurance) locks the additional
   * funds atomically.
   */
  async applyAction<Action, State>(
    game: Game<Action, State>,
    session: Session<Action, State>,
    action: Action,
    /** How much extra stake (if any) this action requires the ledger to lock. */
    extraLockUnits: bigint = 0n,
  ): Promise<Session<Action, State>> {
    if (session.status !== "open") {
      throw new Error(`applyAction: session ${session.id} is ${session.status}`);
    }
    const legal = game.legalActions(session.state);
    if (!actionInList(action, legal)) {
      throw new Error(`applyAction: illegal action ${JSON.stringify(action)}`);
    }

    if (extraLockUnits > 0n) {
      await this.deps.ledger.lock({
        userId: session.userId,
        chainId: session.chainId,
        token: session.token,
        delta: extraLockUnits,
        reason: "session_lock",
        sessionId: session.id,
      });
    }

    const nextNonce = session.endNonce + 1;
    const seedPair = await this.deps.getActiveSeedPair(session.userId);
    const rng = new HmacRngStream(seedPair, nextNonce);
    const nextState = game.step(session.state, action, rng);

    await this.deps.saveSeedPair({ ...seedPair, nonce: nextNonce });

    const next: Session<Action, State> = {
      ...session,
      state: nextState,
      endNonce: nextNonce,
      actions: [
        ...session.actions,
        {
          ordinal: session.actions.length,
          actor: "player",
          action,
          nonceAfter: nextNonce,
          stateHash: hashState(nextState),
          at: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    return next;
  }

  /**
   * Settle the session: compute the final result, release the lock, credit
   * the payout (if any), persist the closed session, and reveal whatever
   * the audit log needs to expose for verification.
   *
   * This is the only place balance moves out of `locked`. The result is
   * the difference between `pnlUnits` and the *original* lock — wins
   * unlock + credit extra, losses just burn the lock, pushes unlock the
   * full original stake.
   */
  async settleSession<Action, State>(
    game: Game<Action, State>,
    session: Session<Action, State>,
  ): Promise<Session<Action, State>> {
    if (session.status !== "open") return session;
    if (!game.isTerminal(session.state)) {
      throw new Error("settleSession: state is not terminal");
    }

    const result = game.settle(session.state, {
      sessionId: session.id,
      userId: session.userId,
      gameId: game.id,
      chainId: session.chainId,
      token: session.token,
      stake: session.stake,
    });

    // Move locked → either available (winnings) or burnt (losses), and
    // credit any winnings on top.
    //
    // Math:
    //   locked = result.totalStakedUnits
    //   payout = result.totalPayoutUnits
    //   pnl    = payout - locked
    //
    //   We "unlock" the smaller of (locked, payout) and "burn" the
    //   difference if `pnl < 0`. We "credit" any extra above the lock.
    const lockedUnits = result.totalStakedUnits;
    const payoutUnits = result.totalPayoutUnits;
    const unlockUnits = payoutUnits < lockedUnits ? payoutUnits : lockedUnits;
    const burnUnits = lockedUnits - unlockUnits;
    const creditUnits = payoutUnits - unlockUnits;

    if (unlockUnits > 0n) {
      await this.deps.ledger.unlock({
        userId: session.userId,
        chainId: session.chainId,
        token: session.token,
        delta: unlockUnits,
        reason: "session_unlock",
        sessionId: session.id,
      });
    }
    if (burnUnits > 0n) {
      await this.deps.ledger.burn({
        userId: session.userId,
        chainId: session.chainId,
        token: session.token,
        delta: burnUnits,
        reason: "session_settle",
        sessionId: session.id,
      });
    }
    if (creditUnits > 0n) {
      await this.deps.ledger.credit({
        userId: session.userId,
        chainId: session.chainId,
        token: session.token,
        delta: creditUnits,
        reason: "session_settle",
        sessionId: session.id,
      });
    }

    const next: Session<Action, State> = {
      ...session,
      status: "settled",
      result,
      actions: [
        ...session.actions,
        {
          ordinal: session.actions.length,
          actor: "system",
          action: "settle" as unknown as Action,
          nonceAfter: session.endNonce,
          stateHash: hashState(session.state),
          at: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    return next;
  }

  /**
   * Hard-abort a session — refund everything that was locked, mark void.
   * Used for unrecoverable engine errors or admin intervention.
   */
  async voidSession<Action, State>(
    session: Session<Action, State>,
    refundUnits: bigint,
  ): Promise<Session<Action, State>> {
    if (session.status !== "open") return session;
    if (refundUnits > 0n) {
      await this.deps.ledger.unlock({
        userId: session.userId,
        chainId: session.chainId,
        token: session.token,
        delta: refundUnits,
        reason: "session_unlock",
        sessionId: session.id,
      });
    }
    return {
      ...session,
      status: "voided",
      updatedAt: new Date().toISOString(),
    };
  }
}

/* ---------------------------------------------------------------------------
 *  Convenience factory — wires the in-memory ledger to an in-memory seed
 *  store for the dev/UI path. Production code uses Supabase-backed
 *  implementations.
 * ------------------------------------------------------------------------- */

import { devLedger, InMemoryLedger, SupabaseLedger, type Ledger } from "./balance";
import { newSeedPair } from "./rng";
import { InMemorySeedStore, SupabaseSeedStore, ensureCasinoUserRow, type SeedStore } from "./seed-store";

export interface SessionFactoryConfig {
  defaultUserId: string;
  defaultChainId: ChainId;
  defaultToken: TokenSpec;
  /** Initial available balance to seed for the user. Useful in dev. */
  seedInitialBalance?: bigint;
}

export interface BuiltSessionDriver {
  driver: CasinoSessionDriver;
  ledger: Ledger;
  getSeedPair: () => SeedPair;
  rotateSeed: (newClientSeed?: string) => { retired: SeedPair; next: SeedPair };
  /** Whether this driver writes to a persistent backend. */
  persistent: boolean;
  /** Async-refresh the seed pair from the backing store. */
  reloadSeedPair: () => Promise<SeedPair>;
}

/**
 * Builds a CasinoSessionDriver wired to in-memory state. Returned object
 * also exposes the driver, the seed store, and the ledger so the UI can
 * peek at balances without hitting Supabase.
 */
export function buildDevSessionDriver(cfg: SessionFactoryConfig): BuiltSessionDriver {
  let activePair = newSeedPair({ userId: cfg.defaultUserId });
  const seedArchive: SeedPair[] = [];

  if (cfg.seedInitialBalance && cfg.seedInitialBalance > 0n) {
    devLedger.seed(cfg.defaultUserId, cfg.defaultChainId, cfg.defaultToken, cfg.seedInitialBalance);
  }

  const driver = new CasinoSessionDriver({
    ledger: devLedger,
    async getActiveSeedPair() {
      return activePair;
    },
    async saveSeedPair(pair: SeedPair) {
      activePair = pair;
    },
  });

  return {
    driver,
    ledger: devLedger,
    getSeedPair: () => activePair,
    persistent: false,
    async reloadSeedPair() {
      return activePair;
    },
    rotateSeed(newClientSeed?: string) {
      const retired: SeedPair = {
        ...activePair,
        status: "retired",
        retiredAt: new Date().toISOString(),
      };
      seedArchive.push(retired);
      activePair = newSeedPair({ userId: cfg.defaultUserId, clientSeed: newClientSeed });
      return { retired, next: activePair };
    },
  };
}

/* ---------------------------------------------------------------------------
 *  Auth-mode factory — Supabase ledger + seed store.
 *
 *  Used by the casino UI when the user is signed in (i.e. there's a real
 *  `auth.users.id` available). Balances, seed pairs, sessions, and actions
 *  all persist; the casino survives browser reloads and works across
 *  devices.
 * ------------------------------------------------------------------------- */

export interface AuthSessionDriverConfig {
  /** Authenticated supabase user id (UUID). */
  userId: string;
  chainId: ChainId;
  token: TokenSpec;
}

/**
 * Builds an auth-mode session driver. The returned object mirrors
 * `buildDevSessionDriver`'s surface but is backed by Supabase.
 *
 * NOTE: This function does NOT await initial seed-pair loading — the
 * driver creates a temporary local seed pair synchronously and the
 * caller should `await reloadSeedPair()` once mounted to pull in any
 * existing active pair from the DB. This keeps construction synchronous
 * (matching `buildDevSessionDriver`) so the React provider doesn't have
 * to handle a promise.
 */
export function buildAuthSessionDriver(cfg: AuthSessionDriverConfig): BuiltSessionDriver {
  const ledger = new SupabaseLedger();
  const store = new SupabaseSeedStore();

  // Local cache; the actual authoritative pair lives in Supabase but we
  // hold a working copy so the session driver can be synchronous.
  let activePair = newSeedPair({ userId: cfg.userId });

  // Fire-and-forget user row creation + initial seed pair fetch.
  void (async () => {
    await ensureCasinoUserRow(cfg.userId);
    const fromDb = await store.getActiveSeedPair(cfg.userId);
    // If the DB had an active pair we couldn't reuse (no server_seed in
    // memory), `store.getActiveSeedPair` returned a brand-new one already
    // persisted. Either way, sync local with whatever store gave us.
    activePair = fromDb;
  })();

  const driver = new CasinoSessionDriver({
    ledger,
    async getActiveSeedPair() {
      return activePair;
    },
    async saveSeedPair(pair: SeedPair) {
      activePair = pair;
      await store.saveSeedPair(pair);
    },
  });

  return {
    driver,
    ledger,
    persistent: true,
    getSeedPair: () => activePair,
    async reloadSeedPair() {
      activePair = await store.getActiveSeedPair(cfg.userId);
      return activePair;
    },
    rotateSeed(newClientSeed?: string) {
      const retired: SeedPair = {
        ...activePair,
        status: "retired",
        retiredAt: new Date().toISOString(),
      };
      const next = newSeedPair({ userId: cfg.userId, clientSeed: newClientSeed });
      // Fire-and-forget DB writes — UI reflects optimistic rotation.
      void store.saveSeedPair(retired);
      void store.saveSeedPair(next);
      activePair = next;
      return { retired, next };
    },
  };
}

/* ---------------------------------------------------------------------------
 *  Anonymous-mode helper — gives a fresh InMemoryLedger so multiple
 *  anonymous tabs don't clobber each other via the shared `devLedger`.
 * ------------------------------------------------------------------------- */

export function buildAnonymousSessionDriver(cfg: SessionFactoryConfig): BuiltSessionDriver {
  const ledger = new InMemoryLedger();
  if (cfg.seedInitialBalance && cfg.seedInitialBalance > 0n) {
    ledger.seed(cfg.defaultUserId, cfg.defaultChainId, cfg.defaultToken, cfg.seedInitialBalance);
  }
  const store = new InMemorySeedStore();
  let activePair = newSeedPair({ userId: cfg.defaultUserId });
  void store.saveSeedPair(activePair);

  const driver = new CasinoSessionDriver({
    ledger,
    async getActiveSeedPair() {
      return activePair;
    },
    async saveSeedPair(pair: SeedPair) {
      activePair = pair;
      await store.saveSeedPair(pair);
    },
  });

  return {
    driver,
    ledger,
    persistent: false,
    getSeedPair: () => activePair,
    async reloadSeedPair() {
      return activePair;
    },
    rotateSeed(newClientSeed?: string) {
      const retired: SeedPair = {
        ...activePair,
        status: "retired",
        retiredAt: new Date().toISOString(),
      };
      void store.saveSeedPair(retired);
      const next = newSeedPair({ userId: cfg.defaultUserId, clientSeed: newClientSeed });
      void store.saveSeedPair(next);
      activePair = next;
      return { retired, next };
    },
  };
}

/** Make a fresh session id. Exported so the UI can pre-allocate one. */
export function newSessionId(): string {
  return cryptoRandomUuid();
}

// Re-export cryptoRandomId so callers that just need a tag (e.g. balance
// mutation reasons) can grab one without importing two modules.
export { cryptoRandomId };

/* ---------------------------------------------------------------------------
 *  Action comparison helper
 *  Game actions are typically either string-like or { type: "...", ... }-
 *  shaped. We accept exact deep-equality OR `type` field equality, since
 *  legalActions() may return canonical instances and the UI may construct
 *  fresh ones with the same `type`.
 * ------------------------------------------------------------------------- */

function actionInList<Action>(needle: Action, haystack: Action[]): boolean {
  const needleStr = stableStringify(needle);
  const needleType = extractType(needle);
  for (const a of haystack) {
    if (stableStringify(a) === needleStr) return true;
    if (needleType && extractType(a) === needleType) return true;
  }
  return false;
}

function extractType(a: unknown): string | null {
  if (a && typeof a === "object" && "type" in (a as Record<string, unknown>)) {
    const t = (a as { type: unknown }).type;
    return typeof t === "string" ? t : null;
  }
  return null;
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, value) =>
    typeof value === "bigint" ? `${value}n` : value,
  );
}
