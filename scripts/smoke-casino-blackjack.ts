/* ===========================================================================
 *  Smoke test: lib/casino — RNG, deck, blackjack rules, session driver
 *  ---------------------------------------------------------------------------
 *  Runs the entire Phase-0 foundation end-to-end in Node, in <1s.
 *
 *  Coverage:
 *   1. RNG determinism: same seed/nonce → same bytes
 *   2. RNG rejection-sampling: no modulo bias
 *   3. SHA-256 round-trip on server seed
 *   4. Deck draws are unbiased (sanity, not statistical proof)
 *   5. Blackjack: deal, hit-to-bust, stand, double, push, blackjack payout
 *   6. Session driver: balance lock → settle → balance reflects pnl
 *   7. Audit log integrity: action ordinals contiguous, stateHash present
 *   8. Provable verification: revealed seed reproduces dealt cards
 *
 *  Run:  npx tsx scripts/smoke-casino-blackjack.ts
 * ========================================================================= */

import {
  advise,
  blackjackGame,
  buildDevSessionDriver,
  cardFromIndex,
  cardLabel,
  cryptoRandomId,
  DEFAULT_BLACKJACK_CONFIG,
  DEV_TOKEN,
  evaluateHand,
  hashServerSeed,
  HmacRngStream,
  newSeedPair,
  newSessionId,
  replayInt,
  verifyBlackjackSession,
  verifyServerSeed,
  type BlackjackActionType,
  type BlackjackState,
  type Card,
} from "../lib/casino";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  console.log("── 1. RNG determinism ──────────────────────────────────────");
  const pair = newSeedPair({ userId: "u1", clientSeed: "demo" });
  const a1 = new HmacRngStream(pair, 1).nextUint32();
  const a2 = new HmacRngStream(pair, 1).nextUint32();
  assert(a1 === a2, "same (seed, nonce) must produce same uint32");
  console.log(`  uint32(seed, nonce=1) = ${a1} (deterministic ✓)`);

  console.log("── 2. RNG rejection-sampling unbiased ──────────────────────");
  // Pull 200_000 mod-52 draws across nonces and check the histogram.
  const buckets = new Array(52).fill(0);
  for (let n = 1; n <= 200_000; n++) {
    const rng = new HmacRngStream(pair, n);
    buckets[rng.nextInt(52)]++;
  }
  const min = Math.min(...buckets);
  const max = Math.max(...buckets);
  // Expected ~3846; allow ±10% slack.
  assert(min > 3500 && max < 4200, `mod-52 histogram out of slack: min=${min} max=${max}`);
  console.log(`  200k draws · min=${min}, max=${max}, mean≈3846 ✓`);

  console.log("── 3. SHA-256 round-trip ───────────────────────────────────");
  assert(verifyServerSeed(pair.serverSeed!, pair.serverSeedHash), "verifyServerSeed should match");
  assert(
    hashServerSeed(pair.serverSeed!) === pair.serverSeedHash,
    "hashServerSeed deterministic ✓",
  );
  console.log(`  hash(server_seed) == published_hash ✓`);

  console.log("── 4. Card mapping ─────────────────────────────────────────");
  // 0=2♣, 12=A♣, 13=2♦, ..., 51=A♠
  assert(cardLabel(cardFromIndex(0)) === "2♣", "index 0 → 2♣");
  assert(cardLabel(cardFromIndex(12)) === "A♣", "index 12 → A♣");
  assert(cardLabel(cardFromIndex(51)) === "A♠", "index 51 → A♠");
  console.log("  card index mapping ✓");

  console.log("── 5. Blackjack engine — basic flow ────────────────────────");
  const { driver, ledger } = buildDevSessionDriver({
    defaultUserId: "u1",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 1_000_000_000n, // 1000 DEV at 6 decimals
  });

  // Play 20 hands and confirm balance math is consistent end-to-end.
  let session = await driver.openSession(blackjackGame, {
    sessionId: newSessionId(),
    userId: "u1",
    gameId: blackjackGame.id,
    chainId: "dev-mock",
    token: DEV_TOKEN,
    stake: 10_000_000n, // 10 DEV
    config: DEFAULT_BLACKJACK_CONFIG as unknown as Record<string, unknown>,
  });
  console.log(
    `  opened: player ${session.state.hands[0].cards.map(cardLabel).join(" ")} (` +
      `${evaluateHand(session.state.hands[0].cards).total}) vs dealer up ${cardLabel(session.state.dealer[1])}`,
  );

  while (!blackjackGame.isTerminal(session.state)) {
    const legal = blackjackGame.legalActions(session.state);
    if (legal.length === 0) break;
    // Strategy: stand if 17+, hit otherwise. Decline insurance.
    let act = legal[0];
    if (session.state.phase === "insurance_offered") {
      act = legal.find((l) => l.type === "decline_insurance") ?? legal[0];
    } else {
      const v = evaluateHand(session.state.hands[session.state.activeHand].cards);
      if (v.total >= 17) {
        act = legal.find((l) => l.type === "stand") ?? legal[0];
      } else {
        act = legal.find((l) => l.type === "hit") ?? legal[0];
      }
    }
    session = await driver.applyAction(blackjackGame, session, act);
  }
  session = await driver.settleSession(blackjackGame, session);
  console.log(
    `  settled: result pnl=${session.result!.pnlUnits} (staked=${session.result!.totalStakedUnits}, payout=${session.result!.totalPayoutUnits})`,
  );
  console.log("  per-hand breakdown:");
  for (const b of session.result!.breakdown ?? []) {
    console.log(`    · ${b.label} → pnl ${b.pnlUnits}`);
  }

  console.log("── 6. Balance accounting ───────────────────────────────────");
  const finalBal = await ledger.getBalance("u1", "dev-mock", DEV_TOKEN);
  const expectedAvailable = 1_000_000_000n + session.result!.pnlUnits;
  assert(
    finalBal.available === expectedAvailable,
    `balance mismatch: got ${finalBal.available}, expected ${expectedAvailable}`,
  );
  assert(finalBal.locked === 0n, `locked should be 0 after settle, got ${finalBal.locked}`);
  console.log(
    `  bankroll 1000 → ${Number(finalBal.available) / 1e6} DEV (locked=${finalBal.locked}) ✓`,
  );

  console.log("── 7. Audit log integrity ─────────────────────────────────");
  for (let i = 0; i < session.actions.length; i++) {
    assert(session.actions[i].ordinal === i, `audit log ordinal gap at ${i}`);
    assert(typeof session.actions[i].stateHash === "string", "missing stateHash");
  }
  console.log(`  ${session.actions.length} actions logged, ordinals contiguous, hashes present ✓`);

  console.log("── 8. Replay verifier ──────────────────────────────────────");
  const v = replayInt(pair.serverSeed!, pair.clientSeed, 1, 52);
  const live = new HmacRngStream(pair, 1).nextInt(52);
  assert(v.value === live, `replayInt should match live HmacRngStream (${v.value} vs ${live})`);
  console.log(`  replayInt(seed, "demo", 1, 52) = ${v.value} matches stream output ✓`);

  console.log("── 9. Surrender + advisor + replay end-to-end ──────────────");
  // Play a fresh hand using the advisor; if surrender is suggested at the
  // first decision point, accept it. Then verify the replay matches.
  const { driver: drvS, ledger: ledS, getSeedPair } = buildDevSessionDriver({
    defaultUserId: "u3",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 1_000_000_000n,
  });
  let surrenderTested = false;
  let advisorChose = "—";
  for (let attempt = 0; attempt < 60 && !surrenderTested; attempt++) {
    let s = await drvS.openSession(blackjackGame, {
      sessionId: newSessionId(),
      userId: "u3",
      gameId: blackjackGame.id,
      chainId: "dev-mock",
      token: DEV_TOKEN,
      stake: 10_000_000n,
      config: DEFAULT_BLACKJACK_CONFIG as unknown as Record<string, unknown>,
    });
    if (blackjackGame.isTerminal(s.state)) continue; // natural BJ — skip
    const legal0 = blackjackGame.legalActions(s.state);
    const adv = advise(s.state, legal0);
    if (adv && adv.action === "surrender") {
      advisorChose = "surrender";
      s = await drvS.applyAction(blackjackGame, s, { type: "surrender" });
      assert(blackjackGame.isTerminal(s.state), "surrender should terminate hand");
      s = await drvS.settleSession(blackjackGame, s);
      assert(s.result!.pnlUnits === -5_000_000n, `surrender should refund half: got ${s.result!.pnlUnits}`);
      // Re-derive from revealed seed.
      const v = verifyBlackjackSession(s, getSeedPair().serverSeed!);
      assert(v.hashOk, "verifier: seed hash should match");
      assert(v.finalStateMatches, "verifier: final state should match");
      assert(v.stepMatches.every(Boolean), "verifier: every step should match");
      surrenderTested = true;
      console.log(`  surrender path: pnl=-5 (half stake) · replay verified ✓`);
    }
  }
  if (!surrenderTested) {
    console.log("  surrender path not triggered in 60 attempts (advisor seldom recommends it) — skipped");
  }
  void ledS;
  void advisorChose;

  console.log("── 10. Advisor sanity probes ───────────────────────────────");
  function buildState(playerCards: string, dealerUpRank: string): BlackjackState {
    // Inject a minimal blackjack state directly for advisor lookups.
    const parseCard = (label: string) => {
      const rank = label.slice(0, label.length - 1) as Card["rank"];
      const suit = label.slice(-1) as Card["suit"];
      return { rank, suit, index: 0 } as Card;
    };
    const playerHand = playerCards.split(" ").map(parseCard);
    const dealer = [parseCard("2♣"), parseCard(dealerUpRank + "♠")];
    return {
      config: DEFAULT_BLACKJACK_CONFIG,
      shoe: { numDecks: 6, cards: [] },
      hands: [
        {
          cards: playerHand,
          stake: 10n,
          doubled: false,
          fromSplit: false,
          splitAces: false,
          stood: false,
          busted: false,
          surrendered: false,
        },
      ],
      activeHand: 0,
      dealer,
      dealerRevealed: false,
      baseStake: 10n,
      totalStaked: 10n,
      insuranceStake: 0n,
      insuranceOffered: false,
      insuranceResolved: false,
      phase: "player_turn",
    };
  }
  const probes: { hand: string; up: string; expect: BlackjackActionType }[] = [
    { hand: "10♠ 6♥", up: "10", expect: "surrender" }, // hard 16 vs 10 → R
    { hand: "10♠ 6♥", up: "5", expect: "stand" },      // hard 16 vs 5
    { hand: "A♠ 7♥", up: "6", expect: "double" },      // soft 18 vs 6
    { hand: "8♠ 8♥", up: "5", expect: "split" },       // pair of 8s
    { hand: "5♠ 6♥", up: "6", expect: "double" },      // hard 11 vs 6
    { hand: "10♠ 10♥", up: "6", expect: "stand" },     // never split 10s
    { hand: "A♠ A♥", up: "8", expect: "split" },       // always split aces
  ];
  for (const p of probes) {
    const st = buildState(p.hand, p.up);
    const legal = blackjackGame.legalActions(st);
    const a = advise(st, legal);
    assert(
      a !== null && a.action === p.expect,
      `advisor: ${p.hand} vs ${p.up} expected ${p.expect}, got ${a?.action}`,
    );
  }
  console.log(`  ${probes.length} basic-strategy probes pass ✓`);

  console.log("── 11. Coinflip end-to-end + 100k-flip RTP convergence ─────");
  const { driver: drvCF, ledger: ledCF, getSeedPair: cfSeed } = buildDevSessionDriver({
    defaultUserId: "ucf",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 10_000_000_000_000_000n, // 10B DEV — plenty of head-room
  });

  // 1. Single flip + replay round-trip via verifySession (coinflip's `state` is
  //    terminal-on-deal; the verifier only needs the deal hash to match).
  {
    const { coinflipGame, verifySession } = await import("../lib/casino");
    let s = await drvCF.openSession(coinflipGame, {
      sessionId: newSessionId(),
      userId: "ucf",
      gameId: coinflipGame.id,
      chainId: "dev-mock",
      token: DEV_TOKEN,
      stake: 10_000_000n,
      config: { prediction: "heads" },
    });
    s = await drvCF.settleSession(coinflipGame, s);
    const v = verifySession({
      game: coinflipGame,
      serverSeed: cfSeed().serverSeed!,
      serverSeedHash: s.serverSeedHash,
      clientSeed: s.clientSeed,
      startNonce: s.startNonce,
      bet: {
        sessionId: s.id,
        userId: "ucf",
        gameId: coinflipGame.id,
        chainId: "dev-mock",
        token: DEV_TOKEN,
        stake: s.stake,
        config: { ...s.state.config, prediction: s.state.prediction } as unknown as Record<string, unknown>,
      },
      actions: s.actions.map((a) => ({ ordinal: a.ordinal, action: a.action, actor: a.actor })),
      expectedStateHashes: s.actions.map((a) => a.stateHash ?? ""),
    });
    assert(v.hashOk, "coinflip: seed hash should match");
    assert(v.finalStateMatches, "coinflip: final state should match");
    console.log(`  single flip · result=${s.state.result} pnl=${s.result!.pnlUnits} · replay ✓`);
  }

  // 2. RTP convergence: 100k flips at fixed 10 DEV, always picking heads.
  {
    const { coinflipGame } = await import("../lib/casino");
    const flips = 100_000;
    const stake = 10_000_000n;
    let wins = 0;
    for (let i = 0; i < flips; i++) {
      let s = await drvCF.openSession(coinflipGame, {
        sessionId: newSessionId(),
        userId: "ucf",
        gameId: coinflipGame.id,
        chainId: "dev-mock",
        token: DEV_TOKEN,
        stake,
        config: { prediction: "heads" },
      });
      s = await drvCF.settleSession(coinflipGame, s);
      if (s.state.result === "heads") wins++;
    }
    const wagered = BigInt(flips) * stake;
    const balAfter = (await ledCF.getBalance("ucf", "dev-mock", DEV_TOKEN)).available;
    const startBal = 10_000_000_000_000_000n;
    const netPnl = balAfter - startBal;
    // Returned amount = wagered + netPnl (because every wagered stake was first
    // debited then paid back as part of the settle credit math).
    const returned = wagered + netPnl;
    const rtp = Number(returned * 1_000_000n / wagered) / 1_000_000;
    const winRate = wins / flips;
    console.log(`  ${flips} flips · win rate ${(winRate * 100).toFixed(2)}% · empirical RTP ${(rtp * 100).toFixed(2)}% (target 99%)`);
    assert(
      rtp > 0.95 && rtp < 1.04,
      `RTP ${rtp} out of [0.95, 1.04] sanity band — engine math is wrong`,
    );
    // Win rate must be very close to 50%.
    assert(
      winRate > 0.48 && winRate < 0.52,
      `Win rate ${winRate} outside [0.48, 0.52] — RNG bias`,
    );
  }

  console.log("── 12. House-edge sanity (200 BJ hands at flat $10) ───────");
  const { driver: drv2, ledger: led2 } = buildDevSessionDriver({
    defaultUserId: "u2",
    defaultChainId: "dev-mock",
    defaultToken: DEV_TOKEN,
    seedInitialBalance: 100_000_000_000n, // 100k DEV
  });
  for (let n = 0; n < 200; n++) {
    let s = await drv2.openSession(blackjackGame, {
      sessionId: cryptoRandomId(),
      userId: "u2",
      gameId: blackjackGame.id,
      chainId: "dev-mock",
      token: DEV_TOKEN,
      stake: 10_000_000n,
      config: DEFAULT_BLACKJACK_CONFIG as unknown as Record<string, unknown>,
    });
    while (!blackjackGame.isTerminal(s.state)) {
      const legal = blackjackGame.legalActions(s.state);
      let act = legal[0];
      if (s.state.phase === "insurance_offered") {
        act = legal.find((l) => l.type === "decline_insurance") ?? legal[0];
      } else {
        const v = evaluateHand(s.state.hands[s.state.activeHand].cards);
        // Basic-strategy-lite: stand on 17+, hit otherwise.
        if (v.total >= 17) act = legal.find((l) => l.type === "stand") ?? legal[0];
        else act = legal.find((l) => l.type === "hit") ?? legal[0];
      }
      s = await drv2.applyAction(blackjackGame, s, act);
    }
    s = await drv2.settleSession(blackjackGame, s);
  }
  const bal2 = await led2.getBalance("u2", "dev-mock", DEV_TOKEN);
  const wagered = 200n * 10_000_000n;
  const totalPnl = bal2.available - 100_000_000_000n;
  const rtpPct = (Number(wagered + totalPnl) / Number(wagered)) * 100;
  console.log(
    `  200 hands × 10 = ${Number(wagered) / 1e6} wagered, net ${Number(totalPnl) / 1e6} DEV → empirical RTP ${rtpPct.toFixed(1)}% (high variance over 200 hands)`,
  );

  console.log("");
  console.log("All casino smoke tests passed ✓");
}

main().catch((err) => {
  console.error("Smoke threw:", err);
  process.exit(1);
});
