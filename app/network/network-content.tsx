"use client";

/* ================================================================== */
/*  NETWORK / MONEYFUND L1 WHITEPAPER PAGE                             */
/*  Source: The MoneyFund Network Whitepaper v6.1 (Shane Cloonan)      */
/*          + MoneyFund Architecture Illustration v6.2                 */
/* ================================================================== */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

/* ------------------------------------------------------------------ */
/*  SECTION HEADING                                                    */
/* ------------------------------------------------------------------ */

function SectionHeading({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="text-center space-y-1 pt-4">
      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
        {children}
      </h2>
      {sub && <p className="text-xs text-white/40">{sub}</p>}
      <div className="mx-auto mt-3 w-16 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/60 to-purple-500/60" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ARCHITECTURE ILLUSTRATION                                          */
/*  Faithful SVG version of the v6.2 illustration:                     */
/*     USER/APP  →  EXECUTION (PROVER)  ⇄  STORAGE (VERIFIER)          */
/*                       ↓ Permanence Tax (Gas)                        */
/*                  $MONEY ENDOWMENT  →  Sustains Network              */
/* ------------------------------------------------------------------ */

function ArchitectureIllustration() {
  return (
    <div className={`${card} p-4 sm:p-6 md:p-8`}>
      <svg
        viewBox="0 0 1100 720"
        className="w-full h-auto"
        aria-label="MoneyFund Network Architecture v6.2"
      >
        <defs>
          {/* Layer gradients */}
          <linearGradient id="userGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1A2F3C" />
            <stop offset="100%" stopColor="#1F3A4A" />
          </linearGradient>
          <linearGradient id="execGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3F2A6D" />
            <stop offset="100%" stopColor="#4B367E" />
          </linearGradient>
          <linearGradient id="storeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1A3C34" />
            <stop offset="100%" stopColor="#1F4A40" />
          </linearGradient>
          <linearGradient id="endowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B6A1A" />
            <stop offset="100%" stopColor="#D4A843" />
          </linearGradient>

          {/* Animated coin glow */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Arrow markers */}
          <marker
            id="arrowW"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.7)" />
          </marker>
          <marker
            id="arrowG"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#d4a843" />
          </marker>
          <marker
            id="arrowC"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#67e8f9" />
          </marker>
        </defs>

        {/* ───────────────────────── USER / APP ───────────────────────── */}
        <g>
          <rect
            x="450"
            y="20"
            width="200"
            height="80"
            rx="14"
            ry="14"
            fill="url(#userGrad)"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1.5"
          />
          <text
            x="550"
            y="50"
            fill="#67e8f9"
            fontSize="11"
            fontWeight="700"
            letterSpacing="2"
            textAnchor="middle"
          >
            USER / APP
          </text>
          <text
            x="550"
            y="72"
            fill="rgba(255,255,255,0.7)"
            fontSize="11"
            textAnchor="middle"
          >
            Initiates compute or storage
          </text>
          <text
            x="550"
            y="88"
            fill="rgba(255,255,255,0.5)"
            fontSize="10"
            fontStyle="italic"
            textAnchor="middle"
          >
            request via RingCT
          </text>
        </g>

        {/* USER → EXECUTION (Compute Request) */}
        <path
          d="M 510 100 Q 350 130 250 200"
          fill="none"
          stroke="rgba(167,139,250,0.5)"
          strokeWidth="2"
          strokeDasharray="6 4"
          markerEnd="url(#arrowW)"
        />
        <text x="295" y="155" fill="rgba(167,139,250,0.85)" fontSize="10" fontWeight="600">
          Compute Request
        </text>

        {/* USER → STORAGE (Data Payload) */}
        <path
          d="M 590 100 Q 750 130 850 200"
          fill="none"
          stroke="rgba(110,231,183,0.5)"
          strokeWidth="2"
          strokeDasharray="6 4"
          markerEnd="url(#arrowW)"
        />
        <text x="755" y="155" fill="rgba(110,231,183,0.85)" fontSize="10" fontWeight="600">
          Data Payload
        </text>

        {/* ─────────────────────── EXECUTION (PROVER) ─────────────────── */}
        <g>
          <rect
            x="40"
            y="200"
            width="420"
            height="220"
            rx="16"
            ry="16"
            fill="url(#execGrad)"
            stroke="rgba(167,139,250,0.4)"
            strokeWidth="1.5"
          />
          <text
            x="60"
            y="230"
            fill="#c4b5fd"
            fontSize="12"
            fontWeight="700"
            letterSpacing="2"
          >
            EXECUTION ⟶ PROVER
          </text>
          <text
            x="60"
            y="250"
            fill="rgba(255,255,255,0.45)"
            fontSize="10"
            letterSpacing="1.5"
          >
            OFF-CHAIN COMPUTE LAYER
          </text>

          <line
            x1="60"
            y1="262"
            x2="440"
            y2="262"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
          />

          <text x="60" y="288" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#c4b5fd">Hardware:</tspan>
            <tspan dx="6">High-End GPU Clusters</tspan>
          </text>
          <text x="60" y="318" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#c4b5fd">Logic:</tspan>
            <tspan dx="6">High-Performance zkVM</tspan>
          </text>
          <text x="60" y="348" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#c4b5fd">Scaling:</tspan>
            <tspan dx="6">Recursive SNARKs</tspan>
          </text>
          <text x="60" y="368" fill="rgba(255,255,255,0.6)" fontSize="11">
            process 1MB increments off-chain
          </text>
          <text x="60" y="398" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#c4b5fd">Yield:</tspan>
            <tspan dx="6">Generates compute fees → endowment</tspan>
          </text>
        </g>

        {/* ──────────────── zk-BRIDGE (Succinct Proof) ────────────────── */}
        <g>
          <path
            d="M 460 310 H 640"
            fill="none"
            stroke="#67e8f9"
            strokeWidth="2.5"
            markerEnd="url(#arrowC)"
          />
          {/* Animated proof packet */}
          <circle r="6" fill="#67e8f9" filter="url(#glow)">
            <animateMotion dur="3s" repeatCount="indefinite" path="M 470 310 H 635" />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.1;0.85;1"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
          <rect
            x="470"
            y="278"
            width="160"
            height="22"
            rx="11"
            ry="11"
            fill="rgba(8,9,14,0.95)"
            stroke="rgba(103,232,249,0.5)"
            strokeWidth="1"
          />
          <text
            x="550"
            y="293"
            fill="#67e8f9"
            fontSize="10"
            fontWeight="700"
            textAnchor="middle"
            letterSpacing="1"
          >
            zk-BRIDGE · π &lt; 1KB
          </text>
        </g>

        {/* ─────────────────────── STORAGE (VERIFIER) ─────────────────── */}
        <g>
          <rect
            x="640"
            y="200"
            width="420"
            height="220"
            rx="16"
            ry="16"
            fill="url(#storeGrad)"
            stroke="rgba(110,231,183,0.4)"
            strokeWidth="1.5"
          />
          <text
            x="660"
            y="230"
            fill="#6ee7b7"
            fontSize="12"
            fontWeight="700"
            letterSpacing="2"
          >
            STORAGE ⟶ VERIFIER
          </text>
          <text
            x="660"
            y="250"
            fill="rgba(255,255,255,0.45)"
            fontSize="10"
            letterSpacing="1.5"
          >
            ON-CHAIN PERMANENT LEDGER
          </text>

          <line
            x1="660"
            y1="262"
            x2="1040"
            y2="262"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
          />

          <text x="660" y="288" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#6ee7b7">Hardware:</tspan>
            <tspan dx="6">Standard HDDs / SSDs</tspan>
          </text>
          <text x="660" y="318" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#6ee7b7">Logic:</tspan>
            <tspan dx="6">&quot;Dumb&quot; storage · no compute</tspan>
          </text>
          <text x="660" y="348" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#6ee7b7">Action:</tspan>
            <tspan dx="6">Verifies proofs in &lt; 1ms</tspan>
          </text>
          <text x="660" y="368" fill="rgba(255,255,255,0.6)" fontSize="11">
            updates permanent ledger
          </text>
          <text x="660" y="398" fill="rgba(255,255,255,0.85)" fontSize="12">
            <tspan fontWeight="700" fill="#6ee7b7">Funded:</tspan>
            <tspan dx="6">Yield from $MONEY endowment</tspan>
          </text>
        </g>

        {/* EXECUTION → ENDOWMENT (Permanence Tax / Gas) */}
        <path
          d="M 250 420 Q 250 510 450 560"
          fill="none"
          stroke="#d4a843"
          strokeWidth="2.5"
          markerEnd="url(#arrowG)"
        />
        <circle r="5" fill="#d4a843" filter="url(#glow)">
          <animateMotion dur="3.5s" repeatCount="indefinite" path="M 250 420 Q 250 510 450 560" />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.85;1"
            dur="3.5s"
            repeatCount="indefinite"
          />
        </circle>
        <circle r="5" fill="#d4a843" filter="url(#glow)">
          <animateMotion dur="3.5s" repeatCount="indefinite" path="M 250 420 Q 250 510 450 560" begin="1.7s" />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.85;1"
            dur="3.5s"
            repeatCount="indefinite"
            begin="1.7s"
          />
        </circle>
        <text x="115" y="500" fill="#d4a843" fontSize="11" fontWeight="700">
          Permanence Tax (Gas)
        </text>
        <text x="115" y="516" fill="rgba(212,168,67,0.7)" fontSize="10">
          routes into endowment
        </text>

        {/* ENDOWMENT → STORAGE (Sustains Network) */}
        <path
          d="M 650 560 Q 850 510 850 420"
          fill="none"
          stroke="#d4a843"
          strokeWidth="2.5"
          markerEnd="url(#arrowG)"
        />
        <circle r="5" fill="#d4a843" filter="url(#glow)">
          <animateMotion dur="3.5s" repeatCount="indefinite" path="M 650 560 Q 850 510 850 420" begin="0.8s" />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.85;1"
            dur="3.5s"
            repeatCount="indefinite"
            begin="0.8s"
          />
        </circle>
        <text x="870" y="500" fill="#d4a843" fontSize="11" fontWeight="700">
          Sustains Network
        </text>
        <text x="870" y="516" fill="rgba(212,168,67,0.7)" fontSize="10">
          yield (r) &gt; inflation (i)
        </text>

        {/* ─────────────────────── $MONEY ENDOWMENT ───────────────────── */}
        <g>
          <rect
            x="320"
            y="560"
            width="460"
            height="140"
            rx="16"
            ry="16"
            fill="url(#endowGrad)"
            stroke="rgba(212,168,67,0.5)"
            strokeWidth="2"
          />
          {/* Coin */}
          <circle
            cx="380"
            cy="630"
            r="32"
            fill="#0c0a09"
            stroke="#d4a843"
            strokeWidth="2.5"
          />
          <text
            x="380"
            y="640"
            fill="#d4a843"
            fontSize="34"
            fontWeight="800"
            textAnchor="middle"
          >
            $
          </text>

          <text
            x="430"
            y="600"
            fill="#0c0a09"
            fontSize="14"
            fontWeight="800"
            letterSpacing="2"
          >
            $MONEY ENDOWMENT
          </text>
          <text
            x="430"
            y="624"
            fill="rgba(12,10,9,0.85)"
            fontSize="11"
            fontWeight="600"
          >
            Inflation-Resilient Protocol-Owned Liquidity
          </text>
          <text
            x="430"
            y="650"
            fill="rgba(12,10,9,0.7)"
            fontSize="11"
          >
            E₀ = C₀ · (1+i) / (r − i)
          </text>
          <text
            x="430"
            y="672"
            fill="rgba(12,10,9,0.65)"
            fontSize="10"
            fontStyle="italic"
          >
            Ensures Yield (r) &gt; Inflation (i) → forever-solvent
          </text>
        </g>

        {/* Footer label */}
        <text
          x="550"
          y="715"
          fill="rgba(255,255,255,0.25)"
          fontSize="10"
          letterSpacing="3"
          textAnchor="middle"
        >
          MONEYFUND NETWORK · TECHNICAL ILLUSTRATION v6.2
        </text>
      </svg>

      <p className="text-[11px] text-white/40 leading-relaxed mt-5 text-center max-w-2xl mx-auto">
        Decoupled consensus separates expensive compute (Execution / Prover) from
        cheap, permanent verification (Storage / Verifier). A succinct
        zero-knowledge proof bridges the two layers, while gas fees from compute
        continuously refill the $MONEY endowment that pays storage operators in
        perpetuity.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PRIVACY PRIMITIVES                                                 */
/* ------------------------------------------------------------------ */

const PRIVACY_PRIMITIVES: {
  title: string;
  icon: string;
  description: string;
}[] = [
  {
    title: "Ring Signatures",
    icon: "◉",
    description:
      "Storage transactions are signed by a group of possible signers, making it mathematically impossible to distinguish the actual spender from decoy signers.",
  },
  {
    title: "Stealth Addresses",
    icon: "◈",
    description:
      "For every storage allocation, $MONEY is sent to a unique, one-time address. Prevents external observers from linking multiple storage requests to a single user or entity.",
  },
  {
    title: "Confidential Amounts",
    icon: "◇",
    description:
      "Pedersen Commitments hide the amount of $MONEY allocated to an endowment on-chain — yet storage nodes can still mathematically verify that the required E₀ was satisfied.",
  },
  {
    title: "Privacy-Preserving Execution",
    icon: "◐",
    description:
      "Off-chain zkVMs hide state-transition logic. Users update permanent records by submitting a succinct proof (π); the storage layer verifies validity without ever seeing inputs, balances, or identities.",
  },
];

/* ------------------------------------------------------------------ */
/*  COMPARATIVE ECONOMICS                                              */
/* ------------------------------------------------------------------ */

const COMPARISON_ROWS: {
  metric: string;
  arweave: string;
  moneyfund: string;
  highlight?: boolean;
}[] = [
  {
    metric: "Hardware-cost assumption",
    arweave: "30%/yr decline (Kryder's Law)",
    moneyfund: "Inflation ≥ 0% (post-Kryder)",
  },
  {
    metric: "Solvency model",
    arweave: "Passive endowment, depletes if costs flat",
    moneyfund: "Active yield endowment, r > i forever",
    highlight: true,
  },
  {
    metric: "Compute layer",
    arweave: "None / external (AO)",
    moneyfund: "Native zkVM, recursive SNARKs",
  },
  {
    metric: "Privacy",
    arweave: "Pseudonymous wallets",
    moneyfund: "RingCT + stealth + confidential amounts",
  },
  {
    metric: "Storage cost · 1 TB permanent",
    arweave: "~$3,500–$8,000+",
    moneyfund: "$1,500–$2,000",
    highlight: true,
  },
  {
    metric: "Insolvency risk",
    arweave: "High (bets against thermodynamics)",
    moneyfund: "Mathematically eliminated",
  },
];

/* ------------------------------------------------------------------ */
/*  CAVEATS · OPEN PROBLEMS & REAL-WORLD FAILURE MODES                 */
/*  Honest engineering review of where the v6.1 model is fragile.      */
/* ------------------------------------------------------------------ */

type Severity = "existential" | "critical" | "material";

const CAVEATS: {
  number: string;
  title: string;
  severity: Severity;
  problem: string;
  detail: string;
  mitigation: string;
}[] = [
  {
    number: "01",
    title: "The r > i Guarantee Is a Hypothesis, Not a Theorem",
    severity: "existential",
    problem:
      "We can require r > i in the protocol. We cannot produce r > i in the market.",
    detail:
      "Yield is a function of exogenous compute demand and $MONEY market price — both macro-driven and beyond protocol control. The endowment series E₀ = C₀(1+i)/(r−i) does not gracefully degrade when r < i; the denominator goes negative and the model breaks. Arweave's bet on hardware deflation has been replaced with a bet on perpetual compute-fee growth. That bet is plausibly more defensible — compute demand has been elastic and growing — but it remains a macro hypothesis, not a mathematical guarantee.",
    mitigation:
      "Frame r > i as a credible economic hypothesis with stress-tested fallbacks (insurance fund, graceful-degradation tiers) rather than as a theorem.",
  },
  {
    number: "02",
    title: "Reflexive Single-Token Economy",
    severity: "existential",
    problem:
      "Endowment principal, gas, fees, and POL are all denominated in $MONEY — a single demand shock cascades through every layer at once.",
    detail:
      "If compute demand softens, fee accrual falls, $MONEY price drops, the endowment loses USD value, storage operators receive less, confidence erodes, and the cycle compounds. Arweave isolates this by denominating its endowment in AR alone; here the storage and compute economies are fused. A correlated drawdown across all three (price, demand, yield) does not require any single failure — it only requires the same macro condition that hits crypto every cycle.",
    mitigation:
      "Hold endowment POL as a basket (stablecoins + ETH + $MONEY) so a $MONEY drawdown does not directly threaten storage solvency.",
  },
  {
    number: "03",
    title: "Data Availability Has No Replication Proof",
    severity: "existential",
    problem:
      "A succinct proof verifies state-transition validity — not that the underlying bytes were actually stored.",
    detail:
      "A malicious prover can publish a valid SNARK over a commitment to data that never reaches the storage layer. Storage operators are then economically incentivized to not store the data and just collect endowment yield. Arweave addresses this with SPoRA (Succinct Proofs of Random Access); Filecoin uses Proof-of-Replication + Proof-of-Spacetime; Celestia uses DA sampling. v6.1 specifies none of these. Without an analogous mechanism, the entire storage layer is theater.",
    mitigation:
      "Add a Proof-of-Replication / Proof-of-Spacetime layer with random-challenge audits and slashable stakes for non-responsive operators.",
  },
  {
    number: "04",
    title: "zkVM Proving Overhead vs. Centralized Compute",
    severity: "critical",
    problem:
      "General-purpose zkVMs impose 10,000×–1,000,000× overhead vs. native execution. That is a steep premium to charge.",
    detail:
      "Recursive SNARKs over restricted arithmetic circuits (e.g., Nova/Hypernova) can plausibly hit the 1MB-increment throughput target, but arbitrary business logic on a general zkVM (RiscZero, SP1, Jolt) is well beyond current SOTA at that scale. The economic question for a user is: why pay 10,000× the AWS price when the alternative is a centralized prover with a hardware attestation? The honest answer is permanence + privacy — but that confines the addressable workload to a narrower set than the paper currently implies.",
    mitigation:
      "Identify the specific compute workloads where permanence + privacy justify the premium, and benchmark proving time per workload class.",
  },
  {
    number: "05",
    title: "Bootstrap Requires an Explicit Subsidy Phase",
    severity: "critical",
    problem:
      "At t=0 there is no compute demand, so r ≈ 0, so E₀ → ∞. The first uploads cannot be priced under the model.",
    detail:
      "The closed-form deposit formula breaks at network genesis precisely when the network most needs to attract its first users. The protocol implicitly requires a subsidy phase — token emission, treasury reserves, or ICO proceeds — to seed the endowment until organic compute fees can sustain it. The transition curve from subsidized to self-funded has not been specified, and that curve is the single most fragile period in the network's life.",
    mitigation:
      "Specify a subsidy schedule, target self-sufficiency milestone (e.g., r ≥ 5% measured over rolling 12 months), and explicit conditions for subsidy removal.",
  },
  {
    number: "06",
    title: "Permanence + Untraceability = Maximum Regulatory Surface",
    severity: "material",
    problem:
      "Combining Arweave's permanence with Monero's unlinkability is strictly additive in regulatory exposure, not neutral.",
    detail:
      "Arweave alone faces continuous pressure over CSAM, copyright, and sanctioned content. Monero alone has been delisted from Binance, Kraken EU, OKX, and most major Western exchanges. A network that is forever and untraceable presents storage operators with legal liability they cannot mitigate via takedown — and the privacy primitives prevent any user-level compliance affordance. This is not solvable with engineering; it is a posture decision.",
    mitigation:
      "Explicitly choose a posture: (a) Tor-grade — expect no exchange listings, target privacy-maximalist users; or (b) hybrid — optional view-keys / compliance hooks that selectively de-anonymize on legal request, at the cost of some unlinkability.",
  },
];

const SEVERITY_COPY: Record<Severity, { label: string; pill: string; ring: string; dot: string }> = {
  existential: {
    label: "Existential",
    pill: "bg-rose-500/10 text-rose-300 border-rose-400/30",
    ring: "border-rose-400/20",
    dot: "bg-rose-400",
  },
  critical: {
    label: "Critical",
    pill: "bg-amber-500/10 text-amber-300 border-amber-400/30",
    ring: "border-amber-400/20",
    dot: "bg-amber-400",
  },
  material: {
    label: "Material",
    pill: "bg-white/[0.05] text-white/60 border-white/[0.1]",
    ring: "border-white/[0.08]",
    dot: "bg-white/40",
  },
};

/* ================================================================== */
/*  PAGE                                                                */
/* ================================================================== */

export default function NetworkContent() {
  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-16 space-y-20">
        {/* ─────────────────────── HERO ─────────────────────── */}
        <section className="space-y-6 scroll-mt-28">
          <div className="text-center space-y-3 pt-6">
            <p className="text-[10px] tracking-[0.4em] uppercase text-cyan-400/70 font-semibold">
              Layer 1 Whitepaper · v6.1
            </p>
            <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">
              The MoneyFund Network
            </h1>
            <p className="text-[13px] text-white/50 max-w-2xl mx-auto leading-relaxed">
              Decoupled zkVM consensus for yield-sustained data permanence.
              Privacy-integrated through Ring Confidential Transactions.
            </p>
            <div className="mx-auto mt-4 w-24 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-amber-500/40" />
            <p className="text-[10px] text-white/30 tracking-[0.2em] uppercase">
              Shane Cloonan · May 2026
            </p>
          </div>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 font-semibold mb-3">
              Abstract
            </p>
            <p className="text-[13px] text-white/70 leading-relaxed">
              Current decentralized permanent storage networks rely on the
              macroeconomic assumption of indefinitely declining hardware costs
              (Kryder&rsquo;s Law). As semiconductor scaling hits physical
              thermodynamic limits, these economic models trend toward
              insolvency. This paper proposes a novel Layer 1 architecture
              achieving mathematically guaranteed data permanence through an
              <span className="text-cyan-300/90 font-semibold">
                {" "}
                Inflation-Resilient Endowment
              </span>
              . Version 6.1 introduces{" "}
              <span className="text-amber-300/90 font-semibold">$MONEY</span>, a
              privacy-integrated utility token that uses Ring Confidential
              Transactions (RingCT) and zero-knowledge proofs to decouple
              network utility from user identity, providing a truly untraceable
              layer for permanent data storage.
            </p>
          </div>
        </section>

        {/* ─────────────────────── ARCHITECTURE ─────────────────────── */}
        <section className="space-y-8 scroll-mt-28">
          <SectionHeading sub="MoneyFund Network · Technical Illustration v6.2">
            Architecture
          </SectionHeading>
          <ArchitectureIllustration />
        </section>

        {/* ─────────────────────── HARDWARE REALITY ─────────────────────── */}
        <section className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Why the foundational assumption of legacy permanence is broken">
            §1 · The End of Kryder&rsquo;s Law
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/70 leading-relaxed">
              The foundational flaw of legacy permanence models (e.g., Arweave)
              is the assumption of a continuous{" "}
              <span className="text-rose-300/90 font-semibold">
                30% annual decay
              </span>{" "}
              in cost-per-gigabyte. Current storage mediums are bottlenecking at
              the laws of physics:
            </p>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-4">
                <p className="text-[11px] tracking-[0.2em] uppercase text-rose-300/80 font-bold">
                  Magnetic Density (HDD)
                </p>
                <p className="text-xs text-white/60 mt-2 leading-relaxed">
                  Has reached the{" "}
                  <span className="text-white/80">superparamagnetic limit</span>{" "}
                  — bits become thermally unstable below a critical grain size.
                </p>
              </div>
              <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-4">
                <p className="text-[11px] tracking-[0.2em] uppercase text-rose-300/80 font-bold">
                  Silicon Density (SSD)
                </p>
                <p className="text-xs text-white/60 mt-2 leading-relaxed">
                  Faces{" "}
                  <span className="text-white/80">quantum tunneling</span> —
                  electrons leak across the gate oxide as feature sizes
                  approach atomic scale.
                </p>
              </div>
            </div>

            <p className="text-[13px] text-white/70 leading-relaxed mt-5">
              A mathematically sound permanence network for 2026 and beyond must
              assume hardware inflation{" "}
              <span className="text-amber-300/90 font-mono">(i)</span> will
              outpace or match baseline technological deflation.
            </p>
          </div>
        </section>

        {/* ─────────────────────── ENDOWMENT MODEL ─────────────────────── */}
        <section className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Yield-generating Protocol-Owned Liquidity replaces passive vaults">
            §2 · The Inflation-Resilient Endowment
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8 space-y-5`}>
            <p className="text-[13px] text-white/70 leading-relaxed">
              To survive a stagnant or inflating hardware market, the protocol
              abandons passive storage vaults in favor of a dynamic,
              yield-generating endowment. Let{" "}
              <span className="text-cyan-300/90 font-mono">C₀</span> be the
              initial cost,{" "}
              <span className="text-cyan-300/90 font-mono">i</span> the annual
              inflation rate, and{" "}
              <span className="text-cyan-300/90 font-mono">r</span> the dynamic
              yield generated by the execution layer.
            </p>

            <div className="rounded-xl border border-white/[0.08] bg-black/30 p-6 text-center">
              <p className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-3">
                Total Upfront Endowment
              </p>
              <p className="text-2xl sm:text-3xl text-white font-light tracking-wider font-mono">
                E₀ = ∑<sub className="text-base text-white/60">t=1</sub>
                <sup className="text-base text-white/60">∞</sup> C₀ ·
                <span className="inline-block align-middle mx-2 text-left">
                  <span className="block border-b border-white/40 px-2 leading-tight">
                    (1+i)
                    <sup>t</sup>
                  </span>
                  <span className="block px-2 leading-tight">
                    (1+r)
                    <sup>t</sup>
                  </span>
                </span>
              </p>
              <p className="text-xs text-white/40 mt-4 italic">
                For the endowment to remain solvent forever, the protocol
                mathematically enforces{" "}
                <span className="text-amber-300/90 font-mono not-italic">
                  r &gt; i
                </span>
                .
              </p>
            </div>

            <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-6 text-center">
              <p className="text-[10px] tracking-[0.3em] uppercase text-amber-300/80 mb-3 font-bold">
                Closed-Form User Deposit
              </p>
              <p className="text-3xl sm:text-4xl text-amber-100 font-light tracking-wider font-mono">
                E₀ = C₀ ·
                <span className="inline-block align-middle mx-2 text-left">
                  <span className="block border-b border-amber-300/60 px-2 leading-tight">
                    (1 + i)
                  </span>
                  <span className="block px-2 leading-tight">(r − i)</span>
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ─────────────────────── $MONEY PRIVACY ─────────────────────── */}
        <section className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Untraceable utility, confidential storage allocations">
            §3 · $MONEY · Privacy-Integrated Utility Token
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/70 leading-relaxed">
              The MoneyFund Network is powered by{" "}
              <span className="text-amber-300/90 font-semibold">$MONEY</span>, a
              native privacy token designed to handle the &ldquo;Privacy
              Dilemma&rdquo; in permanent storage. While data is permanent, the
              identity of the storer must not be. $MONEY acts as the fuel for
              the execution layer and the principal for the endowment,
              integrated with untraceable privacy primitives.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PRIVACY_PRIMITIVES.map((p) => (
              <div
                key={p.title}
                className={`${card} p-5 sm:p-6 flex gap-4 hover:border-cyan-400/30 transition-colors`}
              >
                <div className="text-3xl text-cyan-300/80 leading-none shrink-0">
                  {p.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white/90 mb-1.5">
                    {p.title}
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    {p.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─────────────────────── DECOUPLED CONSENSUS ─────────────────────── */}
        <section className="space-y-6 scroll-mt-28">
          <SectionHeading sub="Two strictly bifurcated node classes">
            §4 · Decoupled Consensus Architecture
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/70 leading-relaxed">
              The network architecture is strictly bifurcated into two
              independent node classes:{" "}
              <span className="text-emerald-300/90 font-semibold">
                Storage Nodes
              </span>{" "}
              and{" "}
              <span className="text-violet-300/90 font-semibold">
                Execution Nodes
              </span>
              . Execution Nodes compete for $MONEY compute fees by processing
              heavy read-write operations and arbitrary business logic. A
              <span className="text-amber-300/90 font-semibold">
                {" "}
                Permanence Tax
              </span>{" "}
              from these fees is automatically routed into the $MONEY endowment,
              ensuring the physical survival of data is funded by its active
              utility velocity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-gradient-to-br from-[#3F2A6D]/40 to-[#4B367E]/40 border border-violet-400/20 p-6">
              <p className="text-[10px] tracking-[0.3em] uppercase text-violet-300 font-bold">
                Execution Node
              </p>
              <h3 className="text-base font-bold text-white mt-2">
                Prover · Off-chain
              </h3>
              <ul className="mt-4 space-y-2 text-xs text-white/65">
                <li className="flex gap-2">
                  <span className="text-violet-300">·</span> High-end GPU
                  clusters
                </li>
                <li className="flex gap-2">
                  <span className="text-violet-300">·</span> High-performance
                  zkVM with arbitrary business logic
                </li>
                <li className="flex gap-2">
                  <span className="text-violet-300">·</span> Recursive SNARKs
                  process 1MB increments off-chain
                </li>
                <li className="flex gap-2">
                  <span className="text-violet-300">·</span> Earns $MONEY
                  compute fees · pays Permanence Tax
                </li>
              </ul>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-[#1A3C34]/60 to-[#1F4A40]/60 border border-emerald-400/20 p-6">
              <p className="text-[10px] tracking-[0.3em] uppercase text-emerald-300 font-bold">
                Storage Node
              </p>
              <h3 className="text-base font-bold text-white mt-2">
                Verifier · On-chain
              </h3>
              <ul className="mt-4 space-y-2 text-xs text-white/65">
                <li className="flex gap-2">
                  <span className="text-emerald-300">·</span> Standard
                  HDDs / SSDs · commodity hardware
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-300">·</span> &ldquo;Dumb&rdquo;
                  storage · no compute responsibilities
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-300">·</span> Verifies succinct
                  proofs in &lt; 1ms
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-300">·</span> Paid in perpetuity
                  by endowment yield (r &gt; i)
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ─────────────────────── COMPARATIVE ECONOMICS ─────────────────────── */}
        <section className="space-y-6 scroll-mt-28">
          <SectionHeading sub="MoneyFund vs. legacy permanence networks">
            §5 · Comparative Economics
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/70 leading-relaxed mb-6">
              MoneyFund assumes hardware inflation and relies on native compute
              yield. By routing $MONEY gas into the endowment and restaking
              Protocol-Owned Liquidity, the network can price{" "}
              <span className="text-amber-300/90 font-semibold">
                1 TB of permanent storage closer to $1,500 – $2,000
              </span>{" "}
              — significantly lower than Arweave while eliminating the risk of
              insolvency inherent in models betting against the laws of
              thermodynamics.
            </p>

            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/[0.04] border-b border-white/[0.06]">
                    <th className="text-left px-4 py-3 text-[10px] tracking-[0.2em] uppercase text-white/40 font-semibold">
                      Metric
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] tracking-[0.2em] uppercase text-rose-300/70 font-semibold">
                      Arweave (Legacy)
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] tracking-[0.2em] uppercase text-emerald-300/80 font-semibold">
                      MoneyFund
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((r) => (
                    <tr
                      key={r.metric}
                      className={`border-b border-white/[0.04] last:border-b-0 ${
                        r.highlight ? "bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-white/80 font-semibold align-top">
                        {r.metric}
                      </td>
                      <td className="px-4 py-3 text-white/55 align-top">
                        {r.arweave}
                      </td>
                      <td
                        className={`px-4 py-3 align-top ${
                          r.highlight
                            ? "text-amber-200 font-semibold"
                            : "text-white/75"
                        }`}
                      >
                        {r.moneyfund}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ─────────────────────── CAVEATS ─────────────────────── */}
        <section className="space-y-8 scroll-mt-28">
          <SectionHeading sub="Honest engineering review of where the v6.1 model is fragile">
            §6 · Caveats &amp; Open Problems
          </SectionHeading>

          <div className={`${card} p-6 sm:p-8`}>
            <p className="text-[13px] text-white/70 leading-relaxed">
              The architecture above is the version we want to build. This
              section is the version we have to defend in front of a hostile
              audit committee. Each item below identifies a real-world
              failure mode the v6.1 paper does not adequately address, ranked
              by severity. None are individually disqualifying. The
              combination of items 01–03, left unresolved, is.
            </p>
          </div>

          <div className="space-y-4">
            {CAVEATS.map((c) => {
              const s = SEVERITY_COPY[c.severity];
              return (
                <div
                  key={c.number}
                  className={`rounded-2xl border ${s.ring} bg-white/[0.02] backdrop-blur-sm overflow-hidden`}
                >
                  <div className="p-5 sm:p-6 sm:pl-7">
                    <div className="flex items-start gap-4 mb-3">
                      <span className="text-[11px] font-mono tabular-nums text-white/30 pt-1 shrink-0 w-7">
                        {c.number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="text-sm sm:text-base font-bold text-white/90 leading-snug">
                            {c.title}
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] tracking-[0.18em] uppercase font-bold border ${s.pill} shrink-0`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </span>
                        </div>
                        <p className="text-[12.5px] text-white/75 italic leading-relaxed">
                          {c.problem}
                        </p>
                      </div>
                    </div>

                    <div className="ml-0 sm:ml-11 space-y-3 mt-4">
                      <p className="text-xs text-white/55 leading-relaxed">
                        {c.detail}
                      </p>

                      <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-4 py-3">
                        <p className="text-[9.5px] tracking-[0.25em] uppercase text-white/35 font-bold mb-1.5">
                          v6.2 Mitigation
                        </p>
                        <p className="text-xs text-white/65 leading-relaxed">
                          {c.mitigation}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Closing path-forward card */}
          <div
            className={`${card} p-6 sm:p-8 border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.04] to-transparent`}
          >
            <p className="text-[10px] tracking-[0.3em] uppercase text-cyan-300/80 font-bold mb-3">
              Path Forward · v6.2 Targets
            </p>
            <p className="text-[13px] text-white/70 leading-relaxed mb-4">
              The combination of caveats 01, 02, and 03 is the project-killer.
              Resolving them is the minimum bar for a defensible v6.2 paper.
              The architecture itself remains sound — these are gaps in the
              economic and cryptographic specification, not in the underlying
              vision of decoupled consensus.
            </p>
            <ul className="space-y-2 text-xs text-white/60">
              <li className="flex gap-3">
                <span className="text-cyan-300/70 font-mono shrink-0">→</span>
                <span>
                  <span className="text-white/80 font-semibold">Reframe r &gt; i</span> as a
                  stress-tested economic hypothesis with insurance fund and
                  graceful-degradation tiers — not a mathematical guarantee.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-300/70 font-mono shrink-0">→</span>
                <span>
                  <span className="text-white/80 font-semibold">Diversify endowment denomination</span>
                  {" "}into a basket (stables + ETH + $MONEY) to break the
                  single-token reflexivity loop.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-300/70 font-mono shrink-0">→</span>
                <span>
                  <span className="text-white/80 font-semibold">Specify Proof-of-Replication</span>
                  {" "}with slashable stakes and random-challenge audits so
                  storage payment is contingent on actually storing.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-300/70 font-mono shrink-0">→</span>
                <span>
                  <span className="text-white/80 font-semibold">Publish a subsidy schedule</span>
                  {" "}with explicit self-sufficiency milestones and a
                  documented exit ramp.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-300/70 font-mono shrink-0">→</span>
                <span>
                  <span className="text-white/80 font-semibold">Choose a regulatory posture</span>
                  {" "}explicitly — Tor-grade or compliance-hybrid — and
                  design the privacy primitives accordingly.
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* ─────────────────────── FOOTER ─────────────────────── */}
        <section className="pt-4">
          <div className="text-center space-y-2">
            <p className="text-[10px] tracking-[0.3em] uppercase text-white/30">
              The MoneyFund Network
            </p>
            <p className="text-[10px] text-white/20">
              Whitepaper v6.1 · Architecture Illustration v6.2 · Shane Cloonan ·
              May 2026
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
