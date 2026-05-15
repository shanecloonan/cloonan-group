/* ===========================================================================
 *  MoneyFund Parlay Scanner — service layer on top of the quant engine
 *  ---------------------------------------------------------------------------
 *  This module turns the pure-math engine into a daily pipeline:
 *
 *    1. Ingest    — pull live odds from N books (The Odds API v4 or mocks).
 *    2. De-Vig    — derive "fair price" per market from the sharpest available.
 *    3. Identify  — find books whose line is lagging the consensus (the alpha).
 *    4. Simulate  — pair lagging legs that share a game and check correlation.
 *    5. Rank      — sort candidate parlays by expected ROI % and surface them.
 *
 *  When NEXT_PUBLIC_ODDS_API_KEY is set we hit the real Odds API. When it's
 *  not (which is the default in this repo), we fall back to a deterministic
 *  but plausible mock so the UI is always populated and the engine is always
 *  exercised end-to-end. The mock is shaped *exactly* like the real API so
 *  swapping in a key changes nothing downstream.
 * ========================================================================= */

import {
  americanToDecimal,
  americanToImpliedProbability,
  calculateParlayAlpha,
  devig,
  pairwiseEmpiricalCorrelation,
  type DevigMethod,
  type Leg,
  type ParlayResult,
} from "./parlay-engine";

/* ---------------------------------------------------------------------------
 *  Public types — shaped to match The Odds API v4 + small extensions
 * ------------------------------------------------------------------------- */

export interface OddsApiOutcome {
  name: string;
  price: number; // American odds
  point?: number;
}

export interface OddsApiMarket {
  key: string; // "h2h" | "spreads" | "totals" | "player_pass_yds" | ...
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
  last_update?: string;
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/** Marker for which bookmakers we treat as "sharp" for de-vig consensus. */
export const SHARP_BOOKS = new Set<string>([
  "pinnacle",
  "circasports",
  "bookmakerxch",
  "betcris",
  "matchbook",
]);

export interface LaggingLine {
  eventId: string;
  sport: string;
  game: string;
  market: string;
  outcomeName: string;
  point?: number;

  bookKey: string;
  bookTitle: string;
  bookAmericanOdds: number;

  consensusFairProbability: number;
  consensusFairAmericanOdds: number;

  edgePct: number;        // (trueProb / bookImpliedProb - 1) * 100
  expectedValuePct: number; // (trueProb * bookDecimal - 1) * 100
}

export interface ParlayCandidate {
  legs: LaggingLine[];
  result: ParlayResult;
  /** Estimated empirical correlation between leg 0 and leg 1 (if 2-leg SGP). */
  estimatedCorrelation?: number;
  /** Stable identifier for caching / dedup. */
  signature: string;
}

export interface ScanOptions {
  sports?: string[];           // e.g. ["americanfootball_nfl", "basketball_nba"]
  markets?: string[];          // e.g. ["h2h", "spreads", "totals"]
  bookmakers?: string[];       // restrict to specific books, by key
  minLegs?: number;            // default 2
  maxLegs?: number;            // default 3
  minLegEvPct?: number;        // require each leg to have ≥ this EV% standalone. default 1
  minParlayEvPct?: number;     // require parlay EV% above this. default 5
  bankroll?: number;
  devigMethod?: DevigMethod;
  monteCarloTrials?: number;
  maxResults?: number;         // cap final ranked list
  useMockData?: boolean;       // force mock even if API key is set
  oddsApiKey?: string;         // override env
  oddsApiRegion?: string;      // default us
}

export interface ScanReport {
  generatedAt: string;
  source: "odds-api" | "mock";
  eventsConsidered: number;
  laggingLines: LaggingLine[];
  candidates: ParlayCandidate[];
  topPicks: ParlayCandidate[];
  warnings: string[];
}

/* ---------------------------------------------------------------------------
 *  Step 1 — Ingest
 * ------------------------------------------------------------------------- */

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

/**
 * Default Odds API key — hardcoded so the scanner works out of the box.
 * Override priority is: explicit `options.oddsApiKey` → `ODDS_API_KEY` env →
 * `NEXT_PUBLIC_ODDS_API_KEY` env → this fallback.
 *
 * Rotate via the-odds-api.com dashboard if it ever leaks.
 */
const DEFAULT_ODDS_API_KEY = "cc92cb1fc046621b2b9ed8db04037e01";

async function fetchOddsApiEvents(
  sport: string,
  apiKey: string,
  region: string,
  markets: string[],
): Promise<OddsApiEvent[]> {
  const url = new URL(`${ODDS_API_BASE}/sports/${sport}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", region);
  url.searchParams.set("markets", markets.join(","));
  url.searchParams.set("oddsFormat", "american");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Odds API ${sport} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OddsApiEvent[];
}

/* ---------------------------------------------------------------------------
 *  Mock data — realistic shape so the engine is always exercised
 * ------------------------------------------------------------------------- */

function getMockEvents(): OddsApiEvent[] {
  // Deterministic mock — exact same lines every render so the UI is stable.
  // Mix of sports + markets, with intentional book-to-book disagreement
  // engineered so the scanner finds real (synthetic) alpha.
  return [
    {
      id: "mock-nfl-1",
      sport_key: "americanfootball_nfl",
      sport_title: "NFL",
      commence_time: new Date(Date.now() + 3 * 3600_000).toISOString(),
      home_team: "Kansas City Chiefs",
      away_team: "Buffalo Bills",
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Kansas City Chiefs", price: -135 },
              { name: "Buffalo Bills", price: 120 },
            ]},
            { key: "spreads", outcomes: [
              { name: "Kansas City Chiefs", price: -108, point: -2.5 },
              { name: "Buffalo Bills", price: -103, point: 2.5 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -107, point: 48.5 },
              { name: "Under", price: -104, point: 48.5 },
            ]},
          ],
        },
        {
          key: "fanduel",
          title: "FanDuel",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Kansas City Chiefs", price: -150 },
              { name: "Buffalo Bills", price: 128 },
            ]},
            { key: "spreads", outcomes: [
              { name: "Kansas City Chiefs", price: -110, point: -2.5 },
              { name: "Buffalo Bills", price: -110, point: 2.5 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -115, point: 48.5 },
              { name: "Under", price: -106, point: 48.5 },
            ]},
          ],
        },
        {
          key: "draftkings",
          title: "DraftKings",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Kansas City Chiefs", price: -140 },
              { name: "Buffalo Bills", price: 134 }, // <- lagging: better than Pinnacle
            ]},
            { key: "spreads", outcomes: [
              { name: "Kansas City Chiefs", price: -112, point: -2.5 },
              { name: "Buffalo Bills", price: -108, point: 2.5 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -110, point: 48.5 },
              { name: "Under", price: -110, point: 48.5 },
            ]},
          ],
        },
        {
          key: "betmgm",
          title: "BetMGM",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Kansas City Chiefs", price: -145 },
              { name: "Buffalo Bills", price: 125 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -102, point: 48.5 }, // <- lagging on Over
              { name: "Under", price: -118, point: 48.5 },
            ]},
          ],
        },
        {
          key: "caesars",
          title: "Caesars",
          markets: [
            { key: "h2h", outcomes: [
              { name: "Kansas City Chiefs", price: -138 },
              { name: "Buffalo Bills", price: 122 },
            ]},
            { key: "spreads", outcomes: [
              { name: "Kansas City Chiefs", price: -105, point: -2.5 }, // <- lagging
              { name: "Buffalo Bills", price: -115, point: 2.5 },
            ]},
          ],
        },
      ],
    },
    {
      id: "mock-nba-1",
      sport_key: "basketball_nba",
      sport_title: "NBA",
      commence_time: new Date(Date.now() + 5 * 3600_000).toISOString(),
      home_team: "Boston Celtics",
      away_team: "Denver Nuggets",
      bookmakers: [
        {
          key: "pinnacle", title: "Pinnacle", markets: [
            { key: "h2h", outcomes: [
              { name: "Boston Celtics", price: -160 },
              { name: "Denver Nuggets", price: 142 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -105, point: 224.5 },
              { name: "Under", price: -106, point: 224.5 },
            ]},
          ],
        },
        {
          key: "fanduel", title: "FanDuel", markets: [
            { key: "h2h", outcomes: [
              { name: "Boston Celtics", price: -175 },
              { name: "Denver Nuggets", price: 148 },
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -112, point: 224.5 },
              { name: "Under", price: -108, point: 224.5 },
            ]},
          ],
        },
        {
          key: "draftkings", title: "DraftKings", markets: [
            { key: "h2h", outcomes: [
              { name: "Boston Celtics", price: -155 },
              { name: "Denver Nuggets", price: 155 }, // lagging dog
            ]},
            { key: "totals", outcomes: [
              { name: "Over", price: -108, point: 224.5 },
              { name: "Under", price: -112, point: 224.5 },
            ]},
          ],
        },
        {
          key: "betmgm", title: "BetMGM", markets: [
            { key: "h2h", outcomes: [
              { name: "Boston Celtics", price: -165 },
              { name: "Denver Nuggets", price: 138 },
            ]},
          ],
        },
        {
          key: "caesars", title: "Caesars", markets: [
            { key: "h2h", outcomes: [
              { name: "Boston Celtics", price: -158 },
              { name: "Denver Nuggets", price: 144 },
            ]},
          ],
        },
      ],
    },
    {
      id: "mock-mlb-1",
      sport_key: "baseball_mlb",
      sport_title: "MLB",
      commence_time: new Date(Date.now() + 7 * 3600_000).toISOString(),
      home_team: "Los Angeles Dodgers",
      away_team: "New York Yankees",
      bookmakers: [
        { key: "pinnacle", title: "Pinnacle", markets: [
          { key: "h2h", outcomes: [
            { name: "Los Angeles Dodgers", price: -118 },
            { name: "New York Yankees", price: 108 },
          ]},
          { key: "totals", outcomes: [
            { name: "Over", price: -107, point: 8.5 },
            { name: "Under", price: -104, point: 8.5 },
          ]},
        ]},
        { key: "fanduel", title: "FanDuel", markets: [
          { key: "h2h", outcomes: [
            { name: "Los Angeles Dodgers", price: -130 },
            { name: "New York Yankees", price: 110 },
          ]},
        ]},
        { key: "draftkings", title: "DraftKings", markets: [
          { key: "h2h", outcomes: [
            { name: "Los Angeles Dodgers", price: -125 },
            { name: "New York Yankees", price: 115 }, // lagging dog
          ]},
          { key: "totals", outcomes: [
            { name: "Over", price: -118, point: 8.5 },
            { name: "Under", price: 102, point: 8.5 }, // lagging Under
          ]},
        ]},
        { key: "betmgm", title: "BetMGM", markets: [
          { key: "h2h", outcomes: [
            { name: "Los Angeles Dodgers", price: -122 },
            { name: "New York Yankees", price: 105 },
          ]},
        ]},
        { key: "caesars", title: "Caesars", markets: [
          { key: "h2h", outcomes: [
            { name: "Los Angeles Dodgers", price: -120 },
            { name: "New York Yankees", price: 108 },
          ]},
        ]},
      ],
    },
    {
      id: "mock-nhl-1",
      sport_key: "icehockey_nhl",
      sport_title: "NHL",
      commence_time: new Date(Date.now() + 9 * 3600_000).toISOString(),
      home_team: "Toronto Maple Leafs",
      away_team: "Boston Bruins",
      bookmakers: [
        { key: "pinnacle", title: "Pinnacle", markets: [
          { key: "h2h", outcomes: [
            { name: "Toronto Maple Leafs", price: -112 },
            { name: "Boston Bruins", price: 102 },
          ]},
        ]},
        { key: "fanduel", title: "FanDuel", markets: [
          { key: "h2h", outcomes: [
            { name: "Toronto Maple Leafs", price: -125 },
            { name: "Boston Bruins", price: 108 }, // lagging dog
          ]},
        ]},
        { key: "draftkings", title: "DraftKings", markets: [
          { key: "h2h", outcomes: [
            { name: "Toronto Maple Leafs", price: -118 },
            { name: "Boston Bruins", price: 100 },
          ]},
        ]},
        { key: "betmgm", title: "BetMGM", markets: [
          { key: "h2h", outcomes: [
            { name: "Toronto Maple Leafs", price: -120 },
            { name: "Boston Bruins", price: 102 },
          ]},
        ]},
        { key: "caesars", title: "Caesars", markets: [
          { key: "h2h", outcomes: [
            { name: "Toronto Maple Leafs", price: -115 },
            { name: "Boston Bruins", price: 105 },
          ]},
        ]},
      ],
    },
  ];
}

/* ---------------------------------------------------------------------------
 *  Step 2 — De-vig consensus
 * ------------------------------------------------------------------------- */

interface ConsensusEntry {
  /** Each outcome → its de-vigged probability per book, plus implied prob. */
  outcomeName: string;
  point?: number;
  /** Pinnacle/Circa-derived fair probability if available, else cross-book median. */
  fairProbability: number;
  /** Source label, used for transparency. */
  fairProbabilitySource: string;
}

/**
 * Build per-event-per-market "fair" probability for each outcome using the
 * sharpest available book. Fallback chain:
 *   1. A sharp book → de-vig its 2-way/N-way market.
 *   2. Median of de-vigged probabilities across all books.
 */
function buildConsensus(
  event: OddsApiEvent,
  market: string,
  devigMethod: DevigMethod,
): ConsensusEntry[] {
  // Collect implied probs per book for this market.
  const perBookOutcomes: Map<string, Map<string, { price: number; point?: number }>> = new Map();
  for (const bm of event.bookmakers) {
    const mk = bm.markets.find((m) => m.key === market);
    if (!mk) continue;
    const map = new Map<string, { price: number; point?: number }>();
    for (const o of mk.outcomes) {
      const key = o.point !== undefined ? `${o.name}@${o.point}` : o.name;
      map.set(key, { price: o.price, point: o.point });
    }
    perBookOutcomes.set(bm.key, map);
  }
  if (perBookOutcomes.size === 0) return [];

  // Pull canonical outcome list from any book that has it.
  const firstBookOutcomes = perBookOutcomes.values().next().value;
  if (!firstBookOutcomes) return [];
  const outcomeKeys = Array.from(firstBookOutcomes.keys());

  // 1) Try a sharp book first.
  let sharpBookKey: string | null = null;
  for (const key of perBookOutcomes.keys()) {
    if (SHARP_BOOKS.has(key)) {
      sharpBookKey = key;
      break;
    }
  }

  if (sharpBookKey) {
    const sharpMarket = perBookOutcomes.get(sharpBookKey)!;
    const implied = outcomeKeys.map((k) => americanToImpliedProbability(sharpMarket.get(k)!.price));
    const fair = devig(implied, devigMethod).trueProbabilities;
    return outcomeKeys.map((k, i) => ({
      outcomeName: k.split("@")[0],
      point: sharpMarket.get(k)?.point,
      fairProbability: fair[i],
      fairProbabilitySource: `sharp:${sharpBookKey}`,
    }));
  }

  // 2) Cross-book de-vigged median per outcome.
  const perOutcomeProbs: Map<string, number[]> = new Map(outcomeKeys.map((k) => [k, []]));
  for (const outcomes of perBookOutcomes.values()) {
    const implied: number[] = [];
    let ok = true;
    for (const k of outcomeKeys) {
      const o = outcomes.get(k);
      if (!o) {
        ok = false;
        break;
      }
      implied.push(americanToImpliedProbability(o.price));
    }
    if (!ok) continue;
    const fair = devig(implied, devigMethod).trueProbabilities;
    outcomeKeys.forEach((k, i) => perOutcomeProbs.get(k)!.push(fair[i]));
  }

  return outcomeKeys.map((k) => {
    const samples = perOutcomeProbs.get(k)!;
    samples.sort((a, b) => a - b);
    const median =
      samples.length === 0
        ? 0.5
        : samples.length % 2 === 1
          ? samples[(samples.length - 1) / 2]
          : (samples[samples.length / 2 - 1] + samples[samples.length / 2]) / 2;
    return {
      outcomeName: k.split("@")[0],
      point: firstBookOutcomes.get(k)?.point,
      fairProbability: median,
      fairProbabilitySource: `median(${perOutcomeProbs.get(k)!.length} books)`,
    };
  });
}

/* ---------------------------------------------------------------------------
 *  Step 3 — Identify lagging lines
 * ------------------------------------------------------------------------- */

function findLaggingLines(
  events: OddsApiEvent[],
  options: ScanOptions,
): LaggingLine[] {
  const markets = options.markets ?? ["h2h", "spreads", "totals"];
  const bookmakerFilter = options.bookmakers ? new Set(options.bookmakers) : null;
  const minLegEv = options.minLegEvPct ?? 1;
  const devigMethod = options.devigMethod ?? "auto";
  const out: LaggingLine[] = [];

  for (const event of events) {
    for (const market of markets) {
      const consensus = buildConsensus(event, market, devigMethod);
      if (consensus.length === 0) continue;
      const consensusMap = new Map<string, ConsensusEntry>();
      for (const c of consensus) {
        const key = c.point !== undefined ? `${c.outcomeName}@${c.point}` : c.outcomeName;
        consensusMap.set(key, c);
      }

      for (const bm of event.bookmakers) {
        if (bookmakerFilter && !bookmakerFilter.has(bm.key)) continue;
        const mk = bm.markets.find((m) => m.key === market);
        if (!mk) continue;
        for (const o of mk.outcomes) {
          const key = o.point !== undefined ? `${o.name}@${o.point}` : o.name;
          const c = consensusMap.get(key);
          if (!c) continue;
          const trueProb = c.fairProbability;
          if (trueProb <= 0 || trueProb >= 1) continue;

          const bookImplied = americanToImpliedProbability(o.price);
          const bookDecimal = americanToDecimal(o.price);
          const evPct = (trueProb * bookDecimal - 1) * 100;
          const edgePct = (trueProb / bookImplied - 1) * 100;

          if (evPct < minLegEv) continue;

          out.push({
            eventId: event.id,
            sport: event.sport_title,
            game: `${event.away_team} @ ${event.home_team}`,
            market,
            outcomeName: o.name,
            point: o.point,
            bookKey: bm.key,
            bookTitle: bm.title,
            bookAmericanOdds: o.price,
            consensusFairProbability: trueProb,
            consensusFairAmericanOdds: probabilityToAmerican(trueProb),
            edgePct,
            expectedValuePct: evPct,
          });
        }
      }
    }
  }

  // Sort by best individual EV first.
  out.sort((a, b) => b.expectedValuePct - a.expectedValuePct);
  return out;
}

function probabilityToAmerican(p: number): number {
  // Inline to avoid importing the engine helper twice; keeps the file portable.
  if (p <= 0 || p >= 1) return 0;
  const decimal = 1 / p;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/* ---------------------------------------------------------------------------
 *  Step 4 — Pair / combine + correlate
 * ------------------------------------------------------------------------- */

/**
 * Heuristic prior on the latent-normal correlation between two parlay legs.
 * This is a *starting point* used inside Monte Carlo. A future iteration of
 * the engine will learn these from historical play-by-play data.
 */
export function priorCorrelation(a: LaggingLine, b: LaggingLine): number {
  if (a.eventId !== b.eventId) return 0;
  // Same game ---
  const sameOutcome = a.outcomeName === b.outcomeName;
  if (a.market === "h2h" && b.market === "totals") {
    // Favorite winning slightly correlates with under (game stays close-ish),
    // but the effect is small and depends on the spread. Conservative prior.
    return -0.05;
  }
  if (a.market === "spreads" && b.market === "totals") {
    return sameOutcome ? 0.1 : -0.05;
  }
  if (a.market === "h2h" && b.market === "spreads") {
    return sameOutcome ? 0.55 : -0.3;
  }
  if (a.market === b.market) {
    // Same market same game = the *other* side of the same bet. Heavy negative.
    return -0.8;
  }
  return 0.05;
}

function buildCorrelationMatrix(legs: LaggingLine[]): number[][] {
  const n = legs.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) m[i][i] = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rho = priorCorrelation(legs[i], legs[j]);
      m[i][j] = m[j][i] = rho;
    }
  }
  return m;
}

function laggingLineToLeg(l: LaggingLine): Leg {
  return {
    id: `${l.eventId}-${l.market}-${l.outcomeName}-${l.bookKey}`,
    description: `${l.outcomeName}${l.point !== undefined ? ` ${l.point}` : ""} (${l.market.toUpperCase()})`,
    sport: l.sport,
    game: l.game,
    market: l.market,
    bookName: l.bookTitle,
    americanOdds: l.bookAmericanOdds,
    trueProbability: l.consensusFairProbability,
  };
}

/** k-combination iterator (small k only). */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

function buildCandidates(
  lines: LaggingLine[],
  options: ScanOptions,
): ParlayCandidate[] {
  const minLegs = Math.max(2, options.minLegs ?? 2);
  const maxLegs = Math.max(minLegs, options.maxLegs ?? 3);
  const minParlayEv = options.minParlayEvPct ?? 5;
  const bankroll = options.bankroll ?? 1000;
  const trials = options.monteCarloTrials ?? 10_000;

  // Limit explosion: take top-K lines by individual EV.
  const pool = lines.slice(0, 24);
  const candidates: ParlayCandidate[] = [];

  for (let size = minLegs; size <= Math.min(maxLegs, pool.length); size++) {
    for (const combo of combinations(pool, size)) {
      // Filter: a parlay should never combine two outcomes of the same market.
      const marketGameKey = new Set<string>();
      let conflict = false;
      for (const l of combo) {
        const key = `${l.eventId}|${l.market}`;
        if (marketGameKey.has(key)) {
          conflict = true;
          break;
        }
        marketGameKey.add(key);
      }
      if (conflict) continue;

      // Combined offered parlay decimal odds = product of book decimals.
      const offeredDecimal = combo.reduce(
        (acc, l) => acc * americanToDecimal(l.bookAmericanOdds),
        1,
      );
      // Convert to American for the engine.
      const offeredAmerican =
        offeredDecimal >= 2
          ? Math.round((offeredDecimal - 1) * 100)
          : Math.round(-100 / (offeredDecimal - 1));

      const correlationMatrix = buildCorrelationMatrix(combo);

      const legs: Leg[] = combo.map(laggingLineToLeg);
      let result: ParlayResult;
      try {
        result = calculateParlayAlpha(legs, offeredAmerican, bankroll, correlationMatrix, {
          monteCarloTrials: trials,
          devigMethod: options.devigMethod ?? "auto",
          kellyFraction: 0.25,
        });
      } catch {
        continue;
      }

      if (result.expectedRoiPercent < minParlayEv) continue;

      let estimatedCorrelation: number | undefined;
      if (combo.length === 2) {
        const rho = correlationMatrix[0][1];
        estimatedCorrelation = pairwiseEmpiricalCorrelation(
          combo[0].consensusFairProbability,
          combo[1].consensusFairProbability,
          rho,
          5_000,
        );
      }

      candidates.push({
        legs: combo,
        result,
        estimatedCorrelation,
        signature: combo
          .map((l) => `${l.eventId}:${l.market}:${l.outcomeName}:${l.point ?? ""}:${l.bookKey}`)
          .sort()
          .join("|"),
      });
    }
  }

  // Rank: best by expected ROI %, then alpha %.
  candidates.sort((a, b) => {
    if (b.result.expectedRoiPercent !== a.result.expectedRoiPercent) {
      return b.result.expectedRoiPercent - a.result.expectedRoiPercent;
    }
    return b.result.alphaPercent - a.result.alphaPercent;
  });

  return candidates;
}

/* ---------------------------------------------------------------------------
 *  Step 5 — Public entrypoints
 * ------------------------------------------------------------------------- */

export async function scanDailyParlays(options: ScanOptions = {}): Promise<ScanReport> {
  const warnings: string[] = [];

  const apiKey =
    options.oddsApiKey ??
    (typeof process !== "undefined" ? process.env.ODDS_API_KEY : undefined) ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ODDS_API_KEY : undefined) ??
    DEFAULT_ODDS_API_KEY;

  const useMock = options.useMockData || !apiKey;
  const region = options.oddsApiRegion ?? "us";
  const markets = options.markets ?? ["h2h", "spreads", "totals"];
  const sports = options.sports ?? [
    "americanfootball_nfl",
    "basketball_nba",
    "baseball_mlb",
    "icehockey_nhl",
  ];

  let events: OddsApiEvent[] = [];
  let source: "odds-api" | "mock" = "mock";
  if (useMock) {
    events = getMockEvents();
    warnings.push("Using mock odds data (mock mode explicitly enabled).");
  } else {
    source = "odds-api";
    for (const sport of sports) {
      try {
        const evs = await fetchOddsApiEvents(sport, apiKey!, region, markets);
        events.push(...evs);
      } catch (err) {
        warnings.push(`Failed to fetch ${sport}: ${(err as Error).message}`);
      }
    }
    if (events.length === 0) {
      warnings.push("No events returned from Odds API — falling back to mock data.");
      events = getMockEvents();
      source = "mock";
    }
  }

  const lagging = findLaggingLines(events, options);
  const candidates = buildCandidates(lagging, options);

  const maxResults = options.maxResults ?? 20;
  const topPicks = candidates.slice(0, maxResults);

  return {
    generatedAt: new Date().toISOString(),
    source,
    eventsConsidered: events.length,
    laggingLines: lagging,
    candidates,
    topPicks,
    warnings,
  };
}

/** Convenience wrapper: pre-tuned defaults, returns just the ranked picks. */
export async function getBestParlaysToday(
  bankroll: number = 1000,
  maxResults: number = 12,
): Promise<ParlayCandidate[]> {
  const report = await scanDailyParlays({
    bankroll,
    maxResults,
    minLegs: 2,
    maxLegs: 3,
    minLegEvPct: 1,
    minParlayEvPct: 3,
    monteCarloTrials: 10_000,
  });
  return report.topPicks;
}

/* ---------------------------------------------------------------------------
 *  Supabase persistence (optional)
 * ------------------------------------------------------------------------- */

import { supabase } from "./supabase";

export interface ScanHistoryRow {
  id?: string;
  user_id?: string;
  created_at?: string;
  source: string;
  events_considered: number;
  picks: ParlayCandidate[];
  warnings: string[];
}

/**
 * Persist a scan to Supabase if the `parlay_scans` table exists. Silently
 * no-ops if the table is missing (mirrors the pattern used in
 * lib/arweave.ts for upload logging).
 */
export async function persistScanReport(report: ScanReport): Promise<void> {
  try {
    const { error } = await supabase.from("parlay_scans").insert([
      {
        source: report.source,
        events_considered: report.eventsConsidered,
        picks: report.topPicks,
        warnings: report.warnings,
      },
    ]);
    if (error && !/relation .* does not exist/i.test(error.message)) {
      console.warn("[parlay-scanner] persistScanReport failed:", error.message);
    }
  } catch (err) {
    console.warn("[parlay-scanner] persistScanReport threw:", err);
  }
}
