/* ===========================================================================
 *  Smoke test: lib/casino — SupabaseLedger / SeedStore contract
 *  ---------------------------------------------------------------------------
 *  Validates the Phase-1.5 persistence layer:
 *
 *   1. Both `InMemoryLedger` and the in-memory branch of the contract
 *      satisfy the `Ledger` interface (credit, lock, unlock, burn).
 *   2. `InMemorySeedStore` round-trips active + retired pairs correctly,
 *      and rotate produces a new active pair while revealing the previous
 *      one.
 *   3. `buildAnonymousSessionDriver` builds a self-contained driver
 *      (separate ledger per call, no shared `devLedger` state).
 *   4. `buildAuthSessionDriver` constructs successfully — the Supabase
 *      writes are best-effort and silently degrade in this script (no
 *      auth.users row exists for a random UUID), but the in-memory
 *      working copies of the seed pair + ledger continue to function.
 *
 *  Run:  npx tsx scripts/smoke-casino-supabase-ledger.ts
 * ========================================================================= */

import {
  buildAnonymousSessionDriver,
  buildAuthSessionDriver,
  DEV_TOKEN,
  ensureCasinoUserRow,
  hashServerSeed,
  InMemoryLedger,
  InMemorySeedStore,
  newSeedPair,
  SupabaseLedger,
  type Ledger,
} from "../lib/casino";

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ✗ FAIL: ${msg}`);
  process.exit(1);
}
function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  pass(label);
}
function header(s: string) {
  console.log("\n" + s);
  console.log("─".repeat(s.length));
}

(async () => {
  console.log("=== smoke-casino-supabase-ledger ===");

  /* -------------------------------------------------------------------------
   *  1. InMemoryLedger respects the Ledger contract
   * ----------------------------------------------------------------------- */
  header("1. InMemoryLedger");
  {
    const led: Ledger = new InMemoryLedger();
    const userId = "smoke-user-1";
    const chainId = "dev-mock";
    const token = DEV_TOKEN;

    // Seed via credit instead of `.seed()` so we exercise the public API.
    await led.credit({ userId, chainId, token, delta: 1000n, reason: "deposit" });
    const b1 = await led.getBalance(userId, chainId, token);
    assertEq(b1.available, 1000n, "credit moves units to available");

    await led.lock({ userId, chainId, token, delta: 300n, reason: "session_lock" });
    const b2 = await led.getBalance(userId, chainId, token);
    assertEq(b2.available, 700n, "lock decreases available");
    assertEq(b2.locked, 300n, "lock increases locked");

    await led.unlock({ userId, chainId, token, delta: 100n, reason: "session_unlock" });
    const b3 = await led.getBalance(userId, chainId, token);
    assertEq(b3.available, 800n, "unlock returns to available");
    assertEq(b3.locked, 200n, "unlock decreases locked");

    await led.burn({ userId, chainId, token, delta: 200n, reason: "session_settle" });
    const b4 = await led.getBalance(userId, chainId, token);
    assertEq(b4.available, 800n, "burn does not touch available");
    assertEq(b4.locked, 0n, "burn removes from locked");

    // Overdraft attempts
    try {
      await led.lock({ userId, chainId, token, delta: 10_000n, reason: "session_lock" });
      fail("lock should reject overdraft");
    } catch {
      pass("lock rejects overdraft");
    }
    try {
      await led.burn({ userId, chainId, token, delta: 10n, reason: "session_settle" });
      fail("burn should reject when locked=0");
    } catch {
      pass("burn rejects when locked=0");
    }
  }

  /* -------------------------------------------------------------------------
   *  2. InMemorySeedStore round-trips + rotate
   * ----------------------------------------------------------------------- */
  header("2. InMemorySeedStore");
  {
    const store = new InMemorySeedStore();
    const userId = "smoke-user-2";

    const a = await store.getActiveSeedPair(userId);
    assertEq(a.userId, userId, "active pair is keyed to user");
    assertEq(a.status, "active", "fresh pair starts active");
    assertEq(a.nonce, 0, "fresh pair nonce=0");

    const hashCheck = hashServerSeed(a.serverSeed ?? "");
    assertEq(hashCheck, a.serverSeedHash, "server seed hashes to advertised commit");

    // Same user → same pair (memoized).
    const b = await store.getActiveSeedPair(userId);
    assertEq(b.id, a.id, "active pair memoized across calls");

    // Persist a nonce bump.
    const bumped = { ...a, nonce: 5 };
    await store.saveSeedPair(bumped);
    const c = await store.getActiveSeedPair(userId);
    assertEq(c.nonce, 5, "saveSeedPair persists nonce");

    // Rotate publishes the prior seed.
    const r = await store.rotate(userId);
    assertEq(r.retired.id, c.id, "rotate retires current pair");
    assertEq(r.retired.status, "retired", "retired pair status flipped");
    assertEq(!!r.retired.serverSeed, true, "retired pair still has serverSeed for reveal");
    assertEq(r.next.status, "active", "new pair is active");
    if (r.next.id === r.retired.id) fail("new pair must have distinct id");
    pass("new active pair has distinct id");

    const archive = store.archived();
    assertEq(archive.length >= 1, true, "archive contains retired pair");
  }

  /* -------------------------------------------------------------------------
   *  3. buildAnonymousSessionDriver isolation
   * ----------------------------------------------------------------------- */
  header("3. buildAnonymousSessionDriver");
  {
    const a = buildAnonymousSessionDriver({
      defaultUserId: "anon-A",
      defaultChainId: "dev-mock",
      defaultToken: DEV_TOKEN,
      seedInitialBalance: 5_000n,
    });
    const b = buildAnonymousSessionDriver({
      defaultUserId: "anon-B",
      defaultChainId: "dev-mock",
      defaultToken: DEV_TOKEN,
      seedInitialBalance: 5_000n,
    });
    if (a.ledger === b.ledger) fail("each call returns a fresh ledger");
    pass("each call returns a fresh ledger");

    const ba = await a.ledger.getBalance("anon-A", "dev-mock", DEV_TOKEN);
    const bb = await b.ledger.getBalance("anon-A", "dev-mock", DEV_TOKEN);
    assertEq(ba.available, 5_000n, "anon-A balance lives in driver A");
    assertEq(bb.available, 0n, "anon-A is unknown to driver B (isolation)");

    // The synthetic seed pair must have userId === defaultUserId.
    assertEq(a.getSeedPair().userId, "anon-A", "anon driver seed pair userId");
    assertEq(b.getSeedPair().userId, "anon-B", "anon driver seed pair userId");
    assertEq(a.persistent, false, "anon driver is non-persistent");
  }

  /* -------------------------------------------------------------------------
   *  4. buildAuthSessionDriver constructs (best-effort persistence)
   * ----------------------------------------------------------------------- */
  header("4. buildAuthSessionDriver");
  {
    // Use a clearly-fake UUID. RLS rejects writes for a non-existent
    // auth.users row, which is the expected production behavior — the
    // smoke test verifies the *construction* path is robust.
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    const built = buildAuthSessionDriver({
      userId: fakeUuid,
      chainId: "dev-mock",
      token: DEV_TOKEN,
    });
    assertEq(built.persistent, true, "auth driver marked persistent");
    assertEq(built.getSeedPair().userId, fakeUuid, "auth driver seed pair userId");

    // Wait for async bootstrap to settle so the Supabase warnings stay
    // contained to this test section.
    await new Promise((r) => setTimeout(r, 500));

    // Driver must still be usable even if Supabase rejected.
    const ledger: Ledger = built.ledger;
    if (!(ledger instanceof SupabaseLedger)) fail("auth driver must use SupabaseLedger");
    pass("auth driver uses SupabaseLedger");

    // Rotate path. The seed must change locally even if DB write fails.
    const before = built.getSeedPair();
    const r = built.rotateSeed();
    if (r.next.id === before.id) fail("rotate must change local active pair");
    pass("rotate changes local active pair");
    assertEq(r.retired.status, "retired", "retired pair status flipped");
    assertEq(r.next.status, "active", "new pair is active");
  }

  /* -------------------------------------------------------------------------
   *  5. ensureCasinoUserRow soft-fails on missing auth.users (no UUID)
   * ----------------------------------------------------------------------- */
  header("5. ensureCasinoUserRow soft-fail");
  {
    const r = await ensureCasinoUserRow("00000000-0000-0000-0000-000000000000");
    // We don't assert ok vs. !ok — it depends on whether the dummy UUID
    // happens to exist. We just assert the call returned without throwing.
    if (!r) fail("ensureCasinoUserRow returned undefined");
    pass(`ensureCasinoUserRow returned cleanly (ok=${r.ok}${r.reason ? `, reason=${r.reason}` : ""})`);
  }

  /* -------------------------------------------------------------------------
   *  6. newSeedPair determinism guards
   * ----------------------------------------------------------------------- */
  header("6. newSeedPair properties");
  {
    const p1 = newSeedPair({ userId: "u" });
    const p2 = newSeedPair({ userId: "u" });
    if (p1.id === p2.id) fail("seed pair ids must be unique across calls");
    pass("seed pair ids unique");
    if (p1.serverSeed === p2.serverSeed) fail("server seeds must be unique");
    pass("server seeds unique");
    assertEq(p1.serverSeedHash, hashServerSeed(p1.serverSeed ?? ""), "hash matches seed");
  }

  console.log("\nAll Supabase-ledger smoke tests passed ✓");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
