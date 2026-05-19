/* ===========================================================================
 *  MoneyFund Casino — hand verifier
 *  ---------------------------------------------------------------------------
 *  Given a settled session (or just its serialized inputs) and a *revealed*
 *  server seed, deterministically replay the deal + every action to confirm
 *  the public state matches what we claim it does.
 *
 *  This is the **whole** value proposition of a provably-fair casino: a user
 *  (or a journalist, or a regulator) can paste the revealed seed + the saved
 *  action log into this function and either get back `match: true` or know
 *  the operator cheated.
 *
 *  Pure / browser-safe. No IO. No database access. No randomness besides the
 *  HMAC stream the engine itself uses.
 * ========================================================================= */

import { blackjackGame, type BlackjackAction, type BlackjackState } from "./blackjack";
import { HmacRngStream, hashServerSeed } from "./rng";
import { hashState } from "./session";
import type { Bet, Game, SeedPair, Session } from "./types";

export interface VerifyInput<Action, State> {
  /** The game module to use — `blackjackGame` etc. */
  game: Game<Action, State>;
  /** The revealed server seed (hex string). */
  serverSeed: string;
  /** The published hash of `serverSeed` (must match `sha256(serverSeed)`). */
  serverSeedHash: string;
  /** The client seed in effect at the time of the session. */
  clientSeed: string;
  /** Nonce used for the opening deal. */
  startNonce: number;
  /** The original bet — needed to rebuild the opening state config. */
  bet: Bet;
  /** Action sequence, ordinal-ordered. Should match the session's audit log. */
  actions: Array<{ ordinal: number; action: Action; actor: "player" | "dealer" | "system" }>;
  /** Optional: per-step state hashes we want to validate against. */
  expectedStateHashes?: string[];
}

export interface VerifyResult<State> {
  /** Did the published hash match `sha256(serverSeed)`? */
  hashOk: boolean;
  /** Did the replayed final state hash to the same fingerprint? */
  finalStateMatches: boolean;
  /** Per-step matches (only populated if `expectedStateHashes` was provided). */
  stepMatches: boolean[];
  /** The freshly-replayed final state — clients can render it side-by-side. */
  replayedState: State;
  /** Replayed state hash. */
  replayedFinalHash: string;
}

/**
 * Replay any settled game session deterministically. The result includes:
 *   • whether `sha256(server_seed)` equals the published hash,
 *   • whether the replayed final state matches the recorded fingerprint,
 *   • per-step matches if you pass `expectedStateHashes`.
 */
export function verifySession<Action, State>(input: VerifyInput<Action, State>): VerifyResult<State> {
  const {
    game, serverSeed, serverSeedHash, clientSeed, startNonce, bet, actions, expectedStateHashes,
  } = input;

  const hashOk = hashServerSeed(serverSeed).toLowerCase() === serverSeedHash.toLowerCase();

  // We fabricate a "retired" seed pair just to satisfy the HmacRngStream
  // constructor — the seed is revealed, so this is safe.
  const replaySeedPair: SeedPair = {
    id: "replay",
    userId: "replay",
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce: startNonce - 1,
    status: "retired",
    createdAt: new Date(0).toISOString(),
    retiredAt: new Date(0).toISOString(),
  };

  // 1. Replay the opening deal at startNonce.
  let state: State = game.initialState(bet, new HmacRngStream(replaySeedPair, startNonce, serverSeed));
  const stepMatches: boolean[] = [];
  if (expectedStateHashes && expectedStateHashes.length > 0) {
    stepMatches.push(hashState(state) === expectedStateHashes[0]);
  }

  // 2. Replay every real action. Skip synthetic 'deal' and 'settle' entries
  //    in the audit log (system-actor markers with no actual game-state effect).
  let nonce = startNonce;
  let stepIdx = 1;
  for (const entry of actions) {
    if (entry.actor === "system") continue; // deal + settle markers
    nonce += 1;
    const rng = new HmacRngStream(replaySeedPair, nonce, serverSeed);
    state = game.step(state, entry.action, rng);
    if (expectedStateHashes && stepIdx < expectedStateHashes.length) {
      stepMatches.push(hashState(state) === expectedStateHashes[stepIdx]);
      stepIdx++;
    }
  }

  const replayedFinalHash = hashState(state);
  const expectedFinalHash = expectedStateHashes?.[expectedStateHashes.length - 1];
  const finalStateMatches = expectedFinalHash ? replayedFinalHash === expectedFinalHash : true;

  return { hashOk, finalStateMatches, stepMatches, replayedState: state, replayedFinalHash };
}

/**
 * Convenience: verify a `Session<BlackjackAction, BlackjackState>` directly
 * against its own stored audit log, given the (post-rotation) revealed
 * server seed.
 */
export function verifyBlackjackSession(
  session: Session<BlackjackAction, BlackjackState>,
  serverSeed: string,
): VerifyResult<BlackjackState> {
  return verifySession({
    game: blackjackGame,
    serverSeed,
    serverSeedHash: session.serverSeedHash,
    clientSeed: session.clientSeed,
    startNonce: session.startNonce,
    bet: {
      sessionId: session.id,
      userId: session.userId,
      gameId: blackjackGame.id,
      chainId: session.chainId,
      token: session.token,
      stake: session.stake,
      config: session.state.config as unknown as Record<string, unknown>,
    },
    actions: session.actions.map((a) => ({
      ordinal: a.ordinal,
      action: a.action as BlackjackAction,
      actor: a.actor,
    })),
    expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
  });
}
