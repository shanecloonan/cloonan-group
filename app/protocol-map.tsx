"use client";

import { useRef, useCallback, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";

const ASSET_COLOR = "#34d399";
const DIST_COLOR = "#fb923c";
const PROFIT_COLOR = "#a78bfa";
const DEX_COLOR = "#9ca3af";
const UTILITY_COLOR = "#38bdf8";
const GOLD = "#d4a843";
const CYAN = "#00f7ff";

export default function ProtocolMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!mapRef.current || exporting) return;
    setExporting(true);
    try {
      const el = mapRef.current;
      const dataUrl = await toPng(el, {
        pixelRatio: 3,
        backgroundColor: "#0C0A09",
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: { overflow: "visible", maxWidth: "none" },
      });
      const link = document.createElement("a");
      link.download = "moneyfund-protocol-map.png";
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  return (
    <section className="relative bg-brand-950 overflow-visible">
      <div className="relative px-5 sm:px-8 pt-14 pb-6 sm:pt-20 sm:pb-10">
        <div className="absolute inset-0 bg-gradient-to-b from-forest/20 to-transparent" />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-lg sm:text-xl md:text-2xl font-bold tracking-tight uppercase mb-3 text-brand-200">
            Protocol Map
          </h2>
          <p className="text-brand-500 text-sm max-w-lg mx-auto mb-5">
            Overhead view of every contract, layer, and fee flow in the MoneyFund ecosystem.
          </p>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 border border-brand-700 hover:border-gold/40 text-brand-300 hover:text-gold px-5 py-2.5 text-[11px] tracking-[0.12em] uppercase font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            Export as PNG
          </button>
        </div>
      </div>

      <div className="px-2 sm:px-8 pb-16 sm:pb-20 overflow-visible">
        <div ref={mapRef} className="max-w-5xl mx-auto py-4 px-2">
          {/* Desktop SVG */}
          <svg
            viewBox="0 0 1000 820"
            className="w-full h-auto hidden md:block"
            style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
          >
            <defs>
              <radialGradient id="pm-glow-center" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={CYAN} stopOpacity="0.15" />
                <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="pm-glow-asset" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={ASSET_COLOR} stopOpacity="0.08" />
                <stop offset="100%" stopColor={ASSET_COLOR} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="pm-glow-dist" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={DIST_COLOR} stopOpacity="0.08" />
                <stop offset="100%" stopColor={DIST_COLOR} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="pm-glow-profit" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={PROFIT_COLOR} stopOpacity="0.08" />
                <stop offset="100%" stopColor={PROFIT_COLOR} stopOpacity="0" />
              </radialGradient>
              <marker id="pm-arrow-gold" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0,8 3,0 6" fill={GOLD} opacity="0.7" />
              </marker>
              <marker id="pm-arrow-cyan" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0,8 3,0 6" fill={CYAN} opacity="0.6" />
              </marker>
              <marker id="pm-arrow-white" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0,8 3,0 6" fill="white" opacity="0.3" />
              </marker>
              <filter id="pm-shadow">
                <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.5" />
              </filter>
            </defs>

            {/* Background layer zones */}
            <ellipse cx="240" cy="340" rx="200" ry="160" fill="url(#pm-glow-asset)" />
            <ellipse cx="760" cy="340" rx="200" ry="160" fill="url(#pm-glow-profit)" />
            <ellipse cx="500" cy="620" rx="220" ry="140" fill="url(#pm-glow-dist)" />

            {/* Layer labels */}
            <text x="240" y="195" fill={ASSET_COLOR} fontSize="11" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.5">ASSET LAYER</text>
            <text x="760" y="195" fill={PROFIT_COLOR} fontSize="11" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.5">PROFIT LAYER</text>
            <text x="500" y="530" fill={DIST_COLOR} fontSize="11" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.5">DISTRIBUTION LAYER</text>

            {/* ── CENTER: MONEY Dividends Pool ── */}
            <circle cx="500" cy="370" r="80" fill="url(#pm-glow-center)" />
            <circle cx="500" cy="370" r="62" fill="#001a33" stroke={CYAN} strokeWidth="2" opacity="0.9" filter="url(#pm-shadow)" />
            <circle cx="500" cy="370" r="62" fill="none" stroke={CYAN} strokeWidth="1" opacity="0.3">
              <animate attributeName="r" values="62;68;62" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0.1;0.3" dur="3s" repeatCount="indefinite" />
            </circle>
            <text x="500" y="358" fill={GOLD} fontSize="14" fontWeight="800" textAnchor="middle" letterSpacing="1">MONEY</text>
            <text x="500" y="375" fill={GOLD} fontSize="12" fontWeight="800" textAnchor="middle" letterSpacing="1">DIVIDENDS</text>
            <text x="500" y="393" fill="white" fontSize="9" textAnchor="middle" opacity="0.4">Central Fee Pool</text>

            {/* ── ASSET LAYER contracts ── */}
            <ContractNode x={155} y={260} label="Coin" sub="Launcher" color={ASSET_COLOR} icon="🚀" fee="0.1%" />
            <ContractNode x={305} y={260} label="ETF" sub="Launcher" color={ASSET_COLOR} icon="📈" fee="0.125%" />
            <ContractNode x={155} y={410} label="MONEY" sub="Token" color={ASSET_COLOR} icon="🪙" fee="" />

            {/* ── PROFIT LAYER contracts ── */}
            <ContractNode x={695} y={260} label="Storefront" sub="Launcher" color={PROFIT_COLOR} icon="🛍" fee="0.2%" />
            <ContractNode x={845} y={260} label="Ad Space" sub="Launcher" color={PROFIT_COLOR} icon="📰" fee="0.2%" />
            <ContractNode x={695} y={410} label="Multiswap" sub="Launcher" color={PROFIT_COLOR} icon="🔄" fee="0.05%" />

            {/* ── DISTRIBUTION LAYER contracts ── */}
            <ContractNode x={345} y={610} label="Dividend" sub="Launcher" color={DIST_COLOR} icon="🥩" fee="0.5%" />
            <ContractNode x={500} y={680} label="DAO" sub="Launcher" color={DIST_COLOR} icon="🏛" fee="0.25%" />
            <ContractNode x={655} y={610} label="Multisig" sub="Launcher" color={DIST_COLOR} icon="🔐" fee="" />

            {/* ── DEX + UTILITY ── */}
            <ContractNode x={845} y={410} label="MoneyFund" sub="DEX" color={DEX_COLOR} icon="💰" fee="0.1%" />
            <ContractNode x={305} y={440} label="Airdrop" sub="" color={UTILITY_COLOR} icon="🎁" fee="0.1%" />

            {/* ── EXTERNAL INTEGRATIONS ── */}
            <ExternalNode x={70} y={140} label="Arweave" sub="Permanent Storage" />
            <ExternalNode x={500} y={100} label="Chainlink" sub="ETH/USD Oracle" />
            <ExternalNode x={930} y={140} label="Uniswap V2" sub="Liquidity Routing" />
            <ExternalNode x={930} y={530} label="Solana" sub="Wormhole Bridge" />

            {/* ── FEE FLOW ARROWS → Center ── */}
            {/* Coin Launcher → Pool */}
            <FeeArrow x1={205} y1={280} x2={442} y2={355} />
            {/* ETF Launcher → Pool */}
            <FeeArrow x1={345} y1={275} x2={442} y2={360} />
            {/* Storefront → Pool */}
            <FeeArrow x1={735} y1={280} x2={558} y2={355} />
            {/* Ad Space → Pool */}
            <FeeArrow x1={845} y1={280} x2={558} y2={355} />
            {/* Multiswap → Pool */}
            <FeeArrow x1={735} y1={420} x2={558} y2={380} />
            {/* DEX → Pool */}
            <FeeArrow x1={845} y1={425} x2={560} y2={385} />
            {/* Dividends → Pool */}
            <FeeArrow x1={385} y1={610} x2={480} y2={430} />
            {/* DAO → Pool */}
            <FeeArrow x1={510} y1={660} x2={505} y2={430} />
            {/* Airdrop → Pool */}
            <FeeArrow x1={330} y1={435} x2={440} y2={385} />

            {/* ── DATA FLOW ARROWS (white, between layers) ── */}
            {/* Coin Launcher ↔ Dividend Launcher */}
            <DataArrow x1={175} y1={305} x2={360} y2={590} />
            {/* ETF Launcher ↔ DAO */}
            <DataArrow x1={330} y1={305} x2={490} y2={660} />
            {/* Storefront ↔ Multisig */}
            <DataArrow x1={720} y1={305} x2={660} y2={590} />
            {/* Multiswap ↔ Multisig */}
            <DataArrow x1={710} y1={445} x2={660} y2={600} />
            {/* MONEY token → Dividend pool center */}
            <DataArrow x1={200} y1={420} x2={440} y2={390} />

            {/* ── EXTERNAL INTEGRATION LINES ── */}
            <IntegrationLine x1={120} y1={165} x2={155} y2={240} />
            <IntegrationLine x1={500} y1={130} x2={335} y2={245} />
            <IntegrationLine x1={880} y1={165} x2={845} y2={240} />
            <IntegrationLine x1={890} y1={530} x2={855} y2={445} />

            {/* ── MF WALLET (bottom-right) ── */}
            <rect x={790} y={640} width={140} height={50} rx="10" fill="#0C0A09" stroke={GOLD} strokeWidth="1.5" opacity="0.9" filter="url(#pm-shadow)" />
            <text x="860" y="660" fill={GOLD} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="1">MONEYFUND</text>
            <text x="860" y="675" fill={GOLD} fontSize="9" fontWeight="600" textAnchor="middle" opacity="0.7">WALLET</text>

            {/* Pool → MF Wallet */}
            <line x1="558" y1="395" x2="793" y2="655" stroke={GOLD} strokeWidth="1.5" strokeDasharray="6 3" opacity="0.4" markerEnd="url(#pm-arrow-gold)" />
            <text x="680" y="510" fill={GOLD} fontSize="8" textAnchor="middle" opacity="0.5" transform="rotate(22,680,510)">50% of fees</text>

            {/* Pool → MONEY Burn label */}
            <text x="500" y="445" fill={CYAN} fontSize="8" textAnchor="middle" opacity="0.45">50% of fees → stakers</text>

            {/* ── LEGEND ── */}
            <g transform="translate(20, 720)">
              <rect width="960" height="80" rx="12" fill="#0C0A09" stroke="white" strokeWidth="0.5" opacity="0.6" />
              <circle cx="30" cy="25" r="5" fill={ASSET_COLOR} />
              <text x="42" y="29" fill="white" fontSize="9" opacity="0.7">Asset Layer</text>
              <circle cx="140" cy="25" r="5" fill={DIST_COLOR} />
              <text x="152" y="29" fill="white" fontSize="9" opacity="0.7">Distribution Layer</text>
              <circle cx="290" cy="25" r="5" fill={PROFIT_COLOR} />
              <text x="302" y="29" fill="white" fontSize="9" opacity="0.7">Profit Layer</text>
              <circle cx="410" cy="25" r="5" fill={DEX_COLOR} />
              <text x="422" y="29" fill="white" fontSize="9" opacity="0.7">DEX</text>
              <circle cx="480" cy="25" r="5" fill={UTILITY_COLOR} />
              <text x="492" y="29" fill="white" fontSize="9" opacity="0.7">Utility</text>

              <line x1="30" y1="55" x2="70" y2="55" stroke={GOLD} strokeWidth="1.5" strokeDasharray="4 2" opacity="0.7" />
              <text x="78" y="59" fill="white" fontSize="9" opacity="0.7">Fee Flow → Pool / Wallet</text>
              <line x1="250" y1="55" x2="290" y2="55" stroke="white" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />
              <text x="298" y="59" fill="white" fontSize="9" opacity="0.7">Data / Token Flow</text>
              <line x1="470" y1="55" x2="510" y2="55" stroke="white" strokeWidth="1" strokeDasharray="1 3" opacity="0.2" />
              <text x="518" y="59" fill="white" fontSize="9" opacity="0.7">External Integration</text>
              <rect x="680" y="45" width="10" height="10" rx="2" fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.4" />
              <text x="698" y="55" fill="white" fontSize="9" opacity="0.7">External Service</text>
            </g>
          </svg>

          {/* Mobile layout */}
          <svg
            viewBox="0 0 400 1100"
            className="w-full h-auto md:hidden"
            style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
          >
            <defs>
              <radialGradient id="pm-m-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={CYAN} stopOpacity="0.15" />
                <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
              </radialGradient>
              <marker id="pm-m-arrow-gold" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <polygon points="0 0,7 2.5,0 5" fill={GOLD} opacity="0.7" />
              </marker>
            </defs>

            {/* CENTER: MONEY Dividends */}
            <circle cx="200" cy="80" r="55" fill="#001a33" stroke={CYAN} strokeWidth="2" opacity="0.9" />
            <circle cx="200" cy="80" r="55" fill="none" stroke={CYAN} strokeWidth="1" opacity="0.3">
              <animate attributeName="r" values="55;60;55" dur="3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.3;0.1;0.3" dur="3s" repeatCount="indefinite" />
            </circle>
            <text x="200" y="72" fill={GOLD} fontSize="13" fontWeight="800" textAnchor="middle">MONEY</text>
            <text x="200" y="88" fill={GOLD} fontSize="11" fontWeight="800" textAnchor="middle">DIVIDENDS</text>
            <text x="200" y="103" fill="white" fontSize="8" textAnchor="middle" opacity="0.4">Central Fee Pool</text>

            {/* Fee label */}
            <text x="200" y="150" fill={CYAN} fontSize="8" textAnchor="middle" opacity="0.5">All contract fees flow here</text>

            {/* ASSET LAYER */}
            <text x="200" y="190" fill={ASSET_COLOR} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.6">ASSET LAYER</text>
            <MobileNode x={60} y={210} label="Coin Launcher" icon="🚀" color={ASSET_COLOR} fee="0.1%" />
            <MobileNode x={210} y={210} label="ETF Launcher" icon="📈" color={ASSET_COLOR} fee="0.125%" />
            <MobileNode x={135} y={300} label="MONEY Token" icon="🪙" color={ASSET_COLOR} fee="" />

            {/* Fee arrows */}
            <line x1="120" y1="210" x2="185" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />
            <line x1="260" y1="210" x2="215" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />

            {/* DISTRIBUTION LAYER */}
            <text x="200" y="400" fill={DIST_COLOR} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.6">DISTRIBUTION LAYER</text>
            <MobileNode x={30} y={420} label="Dividend Lnchr" icon="🥩" color={DIST_COLOR} fee="0.5%" />
            <MobileNode x={155} y={420} label="DAO Launcher" icon="🏛" color={DIST_COLOR} fee="0.25%" />
            <MobileNode x={280} y={420} label="Multisig Lnchr" icon="🔐" color={DIST_COLOR} fee="" />

            <line x1="90" y1="420" x2="195" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />
            <line x1="205" y1="420" x2="200" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />

            {/* PROFIT LAYER */}
            <text x="200" y="560" fill={PROFIT_COLOR} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.6">PROFIT LAYER</text>
            <MobileNode x={30} y={580} label="Storefront" icon="🛍" color={PROFIT_COLOR} fee="0.2%" />
            <MobileNode x={155} y={580} label="Ad Space" icon="📰" color={PROFIT_COLOR} fee="0.2%" />
            <MobileNode x={280} y={580} label="Multiswap" icon="🔄" color={PROFIT_COLOR} fee="0.05%" />

            <line x1="90" y1="580" x2="195" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />
            <line x1="210" y1="580" x2="200" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />
            <line x1="330" y1="580" x2="210" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />

            {/* DEX + UTILITY */}
            <text x="200" y="720" fill={DEX_COLOR} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.6">DEX &amp; UTILITY</text>
            <MobileNode x={60} y={740} label="MoneyFund DEX" icon="💰" color={DEX_COLOR} fee="0.1%" />
            <MobileNode x={210} y={740} label="Airdrop" icon="🎁" color={UTILITY_COLOR} fee="0.1%" />

            <line x1="120" y1="740" x2="195" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />
            <line x1="260" y1="740" x2="205" y2="135" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.35" markerEnd="url(#pm-m-arrow-gold)" />

            {/* EXTERNAL */}
            <text x="200" y="860" fill="white" fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="3" opacity="0.35">EXTERNAL INTEGRATIONS</text>
            <MobileExtNode x={20} y={880} label="Arweave" />
            <MobileExtNode x={120} y={880} label="Chainlink" />
            <MobileExtNode x={220} y={880} label="Uniswap V2" />
            <MobileExtNode x={320} y={880} label="Solana" />

            {/* MF WALLET */}
            <rect x={120} y={960} width={160} height={44} rx="10" fill="#0C0A09" stroke={GOLD} strokeWidth="1.5" opacity="0.9" />
            <text x="200" y="978" fill={GOLD} fontSize="10" fontWeight="700" textAnchor="middle" letterSpacing="1">MONEYFUND</text>
            <text x="200" y="992" fill={GOLD} fontSize="9" fontWeight="600" textAnchor="middle" opacity="0.7">WALLET</text>
            <text x="200" y="950" fill={GOLD} fontSize="8" textAnchor="middle" opacity="0.4">50% of all fees</text>

            {/* Legend */}
            <g transform="translate(20, 1030)">
              <circle cx="8" cy="8" r="4" fill={ASSET_COLOR} />
              <text x="18" y="12" fill="white" fontSize="8" opacity="0.6">Asset</text>
              <circle cx="68" cy="8" r="4" fill={DIST_COLOR} />
              <text x="78" y="12" fill="white" fontSize="8" opacity="0.6">Distribution</text>
              <circle cx="158" cy="8" r="4" fill={PROFIT_COLOR} />
              <text x="168" y="12" fill="white" fontSize="8" opacity="0.6">Profit</text>
              <circle cx="218" cy="8" r="4" fill={DEX_COLOR} />
              <text x="228" y="12" fill="white" fontSize="8" opacity="0.6">DEX</text>
              <circle cx="268" cy="8" r="4" fill={UTILITY_COLOR} />
              <text x="278" y="12" fill="white" fontSize="8" opacity="0.6">Utility</text>
              <line x1="0" y1="30" x2="30" y2="30" stroke={GOLD} strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
              <text x="38" y="34" fill="white" fontSize="8" opacity="0.6">Fee Flow</text>
              <line x1="100" y1="30" x2="130" y2="30" stroke="white" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />
              <text x="138" y="34" fill="white" fontSize="8" opacity="0.6">Data Flow</text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ── SVG sub-components (desktop) ── */

function ContractNode({ x, y, label, sub, color, icon, fee }: {
  x: number; y: number; label: string; sub: string; color: string; icon: string; fee: string;
}) {
  const w = 110, h = 65, rx = 10;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={rx} fill="#0C0A09" stroke={color} strokeWidth="1.5" opacity="0.9" filter="url(#pm-shadow)" />
      <text x={x} y={y - 16} fontSize="16" textAnchor="middle">{icon}</text>
      <text x={x} y={y + 2} fill="white" fontSize="11" fontWeight="700" textAnchor="middle">{label}</text>
      {sub && <text x={x} y={y + 14} fill="white" fontSize="9" fontWeight="500" textAnchor="middle" opacity="0.5">{sub}</text>}
      {fee && (
        <g>
          <rect x={x + w / 2 - 32} y={y - h / 2 - 8} width={32} height={16} rx={4} fill={color} opacity="0.2" />
          <text x={x + w / 2 - 16} y={y - h / 2 + 3} fill={color} fontSize="8" fontWeight="700" textAnchor="middle">{fee}</text>
        </g>
      )}
    </g>
  );
}

function ExternalNode({ x, y, label, sub }: { x: number; y: number; label: string; sub: string }) {
  return (
    <g>
      <rect x={x - 55} y={y - 18} width={110} height={36} rx={8} fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.25" />
      <text x={x} y={y - 2} fill="white" fontSize="10" fontWeight="600" textAnchor="middle" opacity="0.5">{label}</text>
      <text x={x} y={y + 10} fill="white" fontSize="7" textAnchor="middle" opacity="0.3">{sub}</text>
    </g>
  );
}

function FeeArrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={GOLD} strokeWidth="1.5" strokeDasharray="6 3" opacity="0.35" markerEnd="url(#pm-arrow-gold)" />
  );
}

function DataArrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="white" strokeWidth="1" strokeDasharray="3 3" opacity="0.15" markerEnd="url(#pm-arrow-white)" />
  );
}

function IntegrationLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="white" strokeWidth="0.8" strokeDasharray="2 4" opacity="0.15" />
  );
}

/* ── SVG sub-components (mobile) ── */

function MobileNode({ x, y, label, icon, color, fee }: {
  x: number; y: number; label: string; icon: string; color: string; fee: string;
}) {
  const w = 100, h = 56;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="#0C0A09" stroke={color} strokeWidth="1.2" opacity="0.9" />
      <text x={x + 14} y={y + 28} fontSize="14">{icon}</text>
      <text x={x + 30} y={y + 22} fill="white" fontSize="9" fontWeight="700">{label}</text>
      {fee && <text x={x + 30} y={y + 36} fill={color} fontSize="8" fontWeight="600" opacity="0.7">{fee}</text>}
    </g>
  );
}

function MobileExtNode({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={80} height={28} rx={6} fill="none" stroke="white" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.2" />
      <text x={x + 40} y={y + 18} fill="white" fontSize="9" fontWeight="500" textAnchor="middle" opacity="0.4">{label}</text>
    </g>
  );
}
