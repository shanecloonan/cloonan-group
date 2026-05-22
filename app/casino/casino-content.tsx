"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CHAIN_ADAPTERS,
  DEV_TOKEN,
  ETH_NATIVE,
  SOL_NATIVE,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
  USDC_SEPOLIA,
  USDC_SOLANA,
  makeEthereumAdapter,
  makeSolanaAdapter,
  type ChainAdapter,
  type ChainId,
  type TokenSpec,
} from "@/lib/casino";
import { CasinoProvider } from "./casino-context";
import { CasinoShell } from "./casino-shell";
import { GameLobby } from "./game-lobby";
import { GamePlayHeader } from "./game-play-header";
import type { GameTab } from "./game-types";
import { isPlayableGame } from "./game-catalog";
import { btnGhost } from "./casino-ui";
import { CasinoActionStrip } from "./casino-action-strip";
import type { CasinoGameId } from "./casino-ui";

const BlackjackTable = dynamic(() => import("./blackjack-table"), { ssr: false });
const BaccaratTable = dynamic(() => import("./baccarat-table"), { ssr: false });
const CoinflipTable = dynamic(() => import("./coinflip-table"), { ssr: false });
const DiceTable = dynamic(() => import("./dice-table"), { ssr: false });
const RouletteTable = dynamic(() => import("./roulette-table"), { ssr: false });
const SlotsTable = dynamic(() => import("./slots-table"), { ssr: false });
const CrashTable = dynamic(() => import("./crash-table"), { ssr: false });
const PlinkoTable = dynamic(() => import("./plinko-table"), { ssr: false });
const MinesTable = dynamic(() => import("./mines-table"), { ssr: false });
const HiloTable = dynamic(() => import("./hilo-table"), { ssr: false });
const PokerTable = dynamic(() => import("./poker-table"), { ssr: false });
const VideoPokerTable = dynamic(() => import("./video-poker-table"), { ssr: false });
const KenoTable = dynamic(() => import("./keno-table"), { ssr: false });
const WheelTable = dynamic(() => import("./wheel-table"), { ssr: false });
const SicBoTable = dynamic(() => import("./sic-bo-table"), { ssr: false });
const DragonTigerTable = dynamic(() => import("./dragon-tiger-table"), { ssr: false });
const CasinoWarTable = dynamic(() => import("./casino-war-table"), { ssr: false });
const RedDogTable = dynamic(() => import("./red-dog-table"), { ssr: false });
const ThreeCardPokerTable = dynamic(() => import("./three-card-poker-table"), { ssr: false });
const AndarBaharTable = dynamic(() => import("./andar-bahar-table"), { ssr: false });
const CaribbeanStudTable = dynamic(() => import("./caribbean-stud-table"), { ssr: false });
const CasinoHoldemTable = dynamic(() => import("./casino-holdem-table"), { ssr: false });
const LetItRideTable = dynamic(() => import("./let-it-ride-table"), { ssr: false });
const MississippiStudTable = dynamic(() => import("./mississippi-stud-table"), { ssr: false });
const ChuckALuckTable = dynamic(() => import("./chuck-a-luck-table"), { ssr: false });
const UltimateTexasHoldemTable = dynamic(() => import("./ultimate-texas-holdem-table"), { ssr: false });
const CrapsTable = dynamic(() => import("./craps-table"), { ssr: false });
const TeenPattiTable = dynamic(() => import("./teen-patti-table"), { ssr: false });

/* ---------------------------------------------------------------------------
 *  Styling vocabulary
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
/* ---------------------------------------------------------------------------
 *  Chain catalog â€” which chain is the user playing on?
 * ------------------------------------------------------------------------- */

interface ChainTile {
  id: ChainId;
  display: string;
  tag: string;
  status: "live" | "queued";
  phase: string;
  blurb: string;
  bestFor: string;
  tokens: TokenSpec[];
}

const CHAIN_TILES: ChainTile[] = [
  {
    id: "dev-mock",
    display: "Dev / Play Money",
    tag: "DEV",
    status: "live",
    phase: "Phase 0",
    blurb: "Free chips, random guest name, no sign-up. Instant refills via the chip bar.",
    bestFor: "Learning the game Â· UI development Â· zero-stakes fun",
    tokens: [DEV_TOKEN],
  },
  {
    id: "ethereum-sepolia",
    display: "Sepolia (testnet)",
    tag: "TEST",
    status: "queued",
    phase: "Phase 1",
    blurb: "ETH vault on Sepolia for deposit/withdraw and settlement smoke tests before mainnet rails go live.",
    bestFor: "Vault E2E Â· operator QA Â· test ETH only",
    tokens: [USDC_SEPOLIA, ETH_NATIVE],
  },
  {
    id: "ethereum-base",
    display: "Base (L2)",
    tag: "ETH",
    status: "queued",
    phase: "Phase 2",
    blurb: "USDC on Base â€” 2 sec finality, ~$0.01 fees. Withdraws settle via EIP-712 sigs from the operator.",
    bestFor: "Large bets Â· audit trail Â· trustless settlement",
    tokens: [ETH_NATIVE, USDC_BASE],
  },
  {
    id: "ethereum-mainnet",
    display: "Ethereum mainnet",
    tag: "ETH",
    status: "queued",
    phase: "Phase 2.1",
    blurb: "Same vault contract, mainnet liquidity. Higher gas â†’ high-stakes only.",
    bestFor: "Whales Â· maximum security Â· regulated treasuries",
    tokens: [ETH_NATIVE, USDC_ETHEREUM_MAINNET],
  },
  {
    id: "solana-mainnet",
    display: "Solana",
    tag: "SOL",
    status: "queued",
    phase: "Phase 3",
    blurb: "Anchor PDA vault. ~400ms slots, sub-cent fees â†’ every roll on-chain is viable.",
    bestFor: "Micro-bets Â· slot pulls Â· crash Â· fast game loops",
    tokens: [SOL_NATIVE, USDC_SOLANA],
  },
];

/* ===========================================================================
 *  Page
 * ========================================================================= */

function syncGameUrl(tab: GameTab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "lobby" || tab === "fairness") url.searchParams.delete("game");
  else if (isPlayableGame(tab)) url.searchParams.set("game", tab);
  const q = url.searchParams.toString();
  window.history.replaceState(null, "", q ? `${url.pathname}?${q}` : url.pathname);
}

function CasinoContentInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<GameTab>("lobby");
  const [chainId, setChainId] = useState<ChainId>("dev-mock");
  const [token, setToken] = useState<TokenSpec>(DEV_TOKEN);
  const [vaultLiveChains, setVaultLiveChains] = useState<ReadonlySet<string>>(() => new Set());

  const goTab = useCallback((next: GameTab) => {
    setTab(next);
    syncGameUrl(next);
  }, []);

  useEffect(() => {
    const g = searchParams.get("game");
    if (g && isPlayableGame(g)) setTab(g);
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/casino/vault-status")
      .then((r) => r.json())
      .then((body: { chains?: { chainId: string; ready: boolean }[] }) => {
        setVaultLiveChains(
          new Set((body.chains ?? []).filter((c) => c.ready).map((c) => c.chainId)),
        );
      })
      .catch(() => setVaultLiveChains(new Set()));
  }, []);

  const adapter = useMemo<ChainAdapter>(() => {
    if (chainId === "dev-mock") return CHAIN_ADAPTERS["dev-mock"];
    if (chainId.startsWith("ethereum-"))
      return makeEthereumAdapter(chainId as "ethereum-base" | "ethereum-mainnet" | "ethereum-arbitrum" | "ethereum-sepolia");
    return makeSolanaAdapter(chainId as "solana-mainnet" | "solana-devnet");
  }, [chainId]);

  const selectChain = (id: ChainId) => {
    setChainId(id);
    const tile = CHAIN_TILES.find((c) => c.id === id);
    if (tile) setToken(tile.tokens[0]);
  };

  const inGame = tab !== "lobby" && tab !== "fairness" && isPlayableGame(tab);
  const currentTile = CHAIN_TILES.find((c) => c.id === chainId);

  return (
    <CasinoProvider chainId={chainId} token={token}>
      <CasinoShell>
        {tab === "lobby" && (
          <GameLobby
            chainId={chainId}
            token={token}
            tokens={currentTile?.tokens ?? [DEV_TOKEN]}
            adapter={adapter}
            vaultLiveChains={vaultLiveChains}
            onSelectChain={selectChain}
            onSelectToken={setToken}
            onOpenGame={(g) => goTab(g)}
            onOpenFairness={() => goTab("fairness")}
          />
        )}
        {tab === "fairness" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => goTab("lobby")}
              className={btnGhost + " !h-10 !min-h-10 !px-3 text-sm"}
            >
              ← Games
            </button>
            <FairnessPanel />
          </div>
        )}
        {inGame && (
          <>
            <GamePlayHeader gameId={tab as CasinoGameId} onBack={() => goTab("lobby")} />
            <CasinoActionStrip />
          {tab === "blackjack" && (
            <BlackjackTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "baccarat" && (
            <BaccaratTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "coinflip" && (
            <CoinflipTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "dice" && (
            <DiceTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "roulette" && (
            <RouletteTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "slots" && (
            <SlotsTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "crash" && (
            <CrashTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "plinko" && (
            <PlinkoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "mines" && (
            <MinesTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "hilo" && (
            <HiloTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "poker" && (
            <PokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "video-poker" && (
            <VideoPokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "keno" && (
            <KenoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "wheel" && (
            <WheelTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "sic-bo" && (
            <SicBoTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "dragon-tiger" && (
            <DragonTigerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "casino-war" && (
            <CasinoWarTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "red-dog" && (
            <RedDogTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "three-card-poker" && (
            <ThreeCardPokerTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "andar-bahar" && (
            <AndarBaharTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "caribbean-stud" && (
            <CaribbeanStudTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "casino-holdem" && (
            <CasinoHoldemTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "let-it-ride" && (
            <LetItRideTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "mississippi-stud" && (
            <MississippiStudTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "chuck-a-luck" && (
            <ChuckALuckTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "ultimate-texas-holdem" && (
            <UltimateTexasHoldemTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "craps" && (
            <CrapsTable chainId={chainId} token={token} adapter={adapter} />
          )}
          {tab === "teen-patti" && (
            <TeenPattiTable chainId={chainId} token={token} adapter={adapter} />
          )}
          </>
        )}
      </CasinoShell>
    </CasinoProvider>
  );
}

export default function CasinoContent() {
  return (
    <Suspense fallback={<div className="min-h-[40vh] flex items-center justify-center text-white/40 text-sm">Loading…</div>}>
      <CasinoContentInner />
    </Suspense>
  );
}

function FairnessPanel() {
  return (
    <div className="mt-8 space-y-6">
      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">How the RNG works</h2>
        <p className="text-white/60 leading-relaxed text-sm">
          We use a commit-reveal HMAC-SHA256 scheme — the same protocol Stake,
          BC.Game, and Crash.com use. Before any hand is dealt the server picks
          a random <span className="text-emerald-300">server seed</span> and
          publishes its SHA-256 hash. The player supplies (or accepts a default)
          a <span className="text-emerald-300">client seed</span>. Each action
          consumes a <span className="text-emerald-300">nonce</span> that we hash
          into the byte stream that picks the next card.
        </p>
        <pre className="mt-4 p-4 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/80 overflow-x-auto">
{`stream = HMAC-SHA256(
  key  = server_seed,
  data = client_seed || ":" || nonce || ":" || block_index
)
card_index = unbiased_mod(stream, 52 - cards_drawn)`}
        </pre>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">Verification flow</h2>
        <ol className="text-sm text-white/70 space-y-2 list-decimal list-inside">
          <li>Open any table — note the <code className="text-emerald-300">server_seed_hash</code> before you bet.</li>
          <li>Play any number of hands. Each settled hand stores the full action log.</li>
          <li>Rotate your client seed any time — we publish the server seed and every past hand becomes verifiable.</li>
          <li>Re-hash the revealed seed, compare to the originally published hash. Then replay any hand by re-deriving the byte stream.</li>
        </ol>
      </section>

      <section className={card + " p-6"}>
        <h2 className="text-xl font-semibold mb-2">No-trust mode (Phase 2.2+)</h2>
        <p className="text-white/60 leading-relaxed text-sm">
          For whales who want zero trust in our server, we will support an
          <span className="text-emerald-300"> on-chain VRF</span> path: Chainlink
          VRF v2 on Ethereum, Switchboard On-Demand or Pyth Entropy on Solana.
          Every random byte for the hand comes from a verifiable on-chain
          source and the vault contract enforces the binding before paying
          out. Higher fees, slower pace, ultimate trustlessness.
        </p>
      </section>
    </div>
  );
}

