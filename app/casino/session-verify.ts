import type { Bet, Game, Session } from "@/lib/casino";
import { verifySession } from "@/lib/casino";
import { verifyBlackjackSession } from "@/lib/casino/verify";
import type { BlackjackAction, BlackjackState } from "@/lib/casino";
import type { VerifyRunResult } from "./casino-verify-modal";

/** Best available revealed server seed for a settled session hash. */
export function pickRevealedServerSeed(
  seedPair: { serverSeedHash: string; serverSeed: string | null },
  revealSeed: { hash: string; serverSeed: string } | null | undefined,
  session: { serverSeedHash: string },
): string | null {
  if (seedPair.serverSeedHash === session.serverSeedHash) return seedPair.serverSeed ?? null;
  if (revealSeed?.hash === session.serverSeedHash) return revealSeed.serverSeed;
  return null;
}

/** Client-side HMAC replay for any game module. */
export function runSessionVerify<Action, State>(
  game: Game<Action, State>,
  session: Session<Action, State>,
  serverSeed: string,
  bet: Bet,
): VerifyRunResult<State> {
  try {
    return verifySession({
      game,
      serverSeed,
      serverSeedHash: session.serverSeedHash,
      clientSeed: session.clientSeed,
      startNonce: session.startNonce,
      bet,
      actions: session.actions.map((a) => ({
        ordinal: a.ordinal,
        action: a.action as Action,
        actor: a.actor,
      })),
      expectedStateHashes: session.actions.map((a) => a.stateHash ?? ""),
    });
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function runBlackjackVerify(
  session: Session<BlackjackAction, BlackjackState>,
  serverSeed: string,
): VerifyRunResult<BlackjackState> {
  try {
    return verifyBlackjackSession(session, serverSeed);
  } catch (err) {
    return { error: (err as Error).message };
  }
}
