"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

/* ================================================================== */
/*  DESIGN TOKENS                                                      */
/* ================================================================== */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";

/* ================================================================== */
/*  FLOW DIAGRAM PRIMITIVES                                            */
/* ================================================================== */

function Node({
  icon,
  label,
  sub,
  color = "border-white/10",
  glow,
  size = "md",
}: {
  icon: string;
  label: string;
  sub?: string;
  color?: string;
  glow?: string;
  size?: "sm" | "md" | "lg";
}) {
  const pad = size === "sm" ? "px-3 py-2" : size === "lg" ? "px-5 py-4" : "px-4 py-3";
  const iconSize = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  const labelSize = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <div
      className={`${pad} rounded-xl border ${color} bg-white/[0.03] flex flex-col items-center gap-1 min-w-[80px] relative`}
      style={glow ? { boxShadow: `0 0 20px 2px ${glow}` } : undefined}
    >
      <span className={iconSize}>{icon}</span>
      <span className={`${labelSize} font-semibold text-white/80 text-center leading-tight`}>
        {label}
      </span>
      {sub && (
        <span className="text-[9px] text-white/30 text-center leading-tight">{sub}</span>
      )}
    </div>
  );
}

function Arrow({
  dir = "right",
  label,
  color = "text-white/20",
  dashed,
}: {
  dir?: "right" | "down" | "left" | "up";
  label?: string;
  color?: string;
  dashed?: boolean;
}) {
  const arrows: Record<string, string> = { right: "→", down: "↓", left: "←", up: "↑" };
  const isVert = dir === "down" || dir === "up";
  return (
    <div
      className={`flex ${isVert ? "flex-col" : "flex-row"} items-center gap-0.5 ${color}`}
    >
      {label && (
        <span className="text-[9px] text-white/30 font-medium whitespace-nowrap">
          {label}
        </span>
      )}
      <div
        className={`flex items-center justify-center ${
          isVert ? "h-6 w-px" : "w-8 h-px"
        }`}
      >
        <div
          className={`${isVert ? "w-px h-full" : "h-px w-full"} ${
            dashed ? "border-dashed" : ""
          }`}
          style={{
            background: dashed
              ? undefined
              : "currentColor",
            borderTop: dashed && !isVert ? "1px dashed currentColor" : undefined,
            borderLeft: dashed && isVert ? "1px dashed currentColor" : undefined,
          }}
        />
      </div>
      <span className="text-sm font-bold">{arrows[dir]}</span>
    </div>
  );
}

function FlowRow({
  children,
  wrap,
}: {
  children: React.ReactNode;
  wrap?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 ${
        wrap ? "flex-wrap" : ""
      }`}
    >
      {children}
    </div>
  );
}

function FlowCol({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">{children}</div>
  );
}

function Badge({
  text,
  color = "bg-white/5 text-white/40",
}: {
  text: string;
  color?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${color}`}
    >
      {text}
    </span>
  );
}

function SectionTitle({
  icon,
  title,
  sub,
  accent,
}: {
  icon: string;
  title: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <span className="text-3xl">{icon}</span>
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-white/90">{title}</h2>
        <p className={`text-xs mt-0.5 ${accent}`}>{sub}</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PENALTY TIMELINE VISUAL                                            */
/* ================================================================== */

function PenaltyTimeline({
  hardLock,
  initPenalty,
  decayPerDay,
}: {
  hardLock: number;
  initPenalty: number;
  decayPerDay: number;
}) {
  const breakeven = decayPerDay > 0 ? hardLock + initPenalty / decayPerDay : 0;
  const totalDays = Math.ceil(breakeven * 1.15) || 30;
  const segments = 40;

  const points = useMemo(() => {
    const pts: { day: number; penalty: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const day = (i / segments) * totalDays;
      let penalty: number;
      if (day < hardLock) {
        penalty = 100;
      } else {
        const elapsed = day - hardLock;
        penalty = Math.max(0, initPenalty - elapsed * decayPerDay);
      }
      pts.push({ day, penalty });
    }
    return pts;
  }, [hardLock, initPenalty, decayPerDay, totalDays]);

  const hardLockPct = (hardLock / totalDays) * 100;
  const breakevenPct = (breakeven / totalDays) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] text-white/40 font-semibold uppercase tracking-wider">
        <span>Penalty Decay Timeline</span>
        <span className="text-white/15">|</span>
        <span>
          Breakeven: <span className="text-emerald-400">{breakeven.toFixed(1)} days</span>
        </span>
      </div>

      {/* Chart area */}
      <div className="relative h-28 rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
        {/* Hard lock zone */}
        <div
          className="absolute top-0 left-0 h-full bg-red-500/[0.06] border-r border-red-500/20"
          style={{ width: `${hardLockPct}%` }}
        />
        {/* Breakeven marker */}
        <div
          className="absolute top-0 h-full border-r border-dashed border-emerald-500/30"
          style={{ left: `${Math.min(breakevenPct, 100)}%` }}
        />

        {/* Penalty curve */}
        <svg
          viewBox={`0 0 ${segments} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
        >
          <defs>
            <linearGradient id="penGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(239,68,68)" stopOpacity="0.6" />
              <stop offset="50%" stopColor="rgb(245,158,11)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="penFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(239,68,68)" stopOpacity="0.08" />
              <stop offset="50%" stopColor="rgb(245,158,11)" stopOpacity="0.04" />
              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path
            d={
              `M 0 ${100 - points[0].penalty} ` +
              points
                .map((p, i) => `L ${i} ${100 - p.penalty}`)
                .join(" ") +
              ` L ${segments} 100 L 0 100 Z`
            }
            fill="url(#penFill)"
          />
          <path
            d={
              `M 0 ${100 - points[0].penalty} ` +
              points.map((p, i) => `L ${i} ${100 - p.penalty}`).join(" ")
            }
            fill="none"
            stroke="url(#penGrad)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Labels */}
        <div className="absolute bottom-1 left-1 text-[9px] text-red-400/60 font-semibold">
          LOCKED
        </div>
        <div
          className="absolute bottom-1 text-[9px] text-emerald-400/60 font-semibold"
          style={{ left: `${Math.min(breakevenPct, 98)}%` }}
        >
          0% PENALTY
        </div>
        <div className="absolute top-1 right-2 text-[9px] text-white/20">
          Day 0 → {totalDays.toFixed(0)}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500/40" /> Hard Lock ({hardLock}d)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-amber-500/40" /> Penalty Decay (−{decayPerDay}%/day)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-500/40" /> Penalty-free
        </span>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SECTIONS                                                           */
/* ================================================================== */

const DAPP_SECTIONS = [
  { id: "dividends", label: "Dividend Launcher", icon: "🥩" },
  { id: "etf", label: "ETF Launcher", icon: "📈" },
  { id: "dao", label: "DAO Launcher", icon: "🗳️" },
  { id: "dex", label: "MoneyFund DEX", icon: "🍒" },
  { id: "storefront", label: "Storefront", icon: "🛒" },
  { id: "auction", label: "Ad-space", icon: "🖼️" },
  { id: "multiswap", label: "Multiswap", icon: "🐙" },
  { id: "airdrop", label: "Airdrop", icon: "🎁" },
];

/* ================================================================== */
/*  DIVIDEND LAUNCHER SECTION                                          */
/* ================================================================== */

function DividendSection() {
  const [h, setH] = useState(7);
  const [p, setP] = useState(30);
  const [d, setD] = useState(1);

  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🥩"
        title="Dividend Launcher"
        sub="ERC-721 staking pools with time-locked rewards and penalty mechanics"
        accent="text-purple-400/80"
      />

      {/* ── Architecture overview ── */}
      <div className={`${card} p-5 sm:p-6 space-y-6`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Architecture Overview
        </h3>
        <div className="flex flex-col items-center gap-1">
          <FlowRow>
            <Node icon="👤" label="Pool Creator" color="border-purple-500/20" glow="rgba(168,85,247,0.08)" />
            <Arrow label="createPool()" color="text-purple-400/40" />
            <Node icon="🏭" label="Factory" sub="0x5ef0...128a" color="border-indigo-500/20" glow="rgba(99,102,241,0.08)" />
            <Arrow label="deploys" color="text-indigo-400/40" />
            <Node icon="🥩" label="Staking Pool" sub="per-token" color="border-purple-500/20" glow="rgba(168,85,247,0.1)" size="lg" />
          </FlowRow>
          <div className="text-[10px] text-white/20 py-2">Factory creates one pool per ERC-20 token with configurable penalty parameters</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-lg">
            {[
              { label: "token", desc: "ERC-20 address" },
              { label: "hardLock", desc: "Lock duration" },
              { label: "initPenalty", desc: "Starting penalty %" },
              { label: "decayRate", desc: "Daily reduction %" },
            ].map((p) => (
              <div
                key={p.label}
                className="text-center px-3 py-2 rounded-lg bg-purple-500/[0.05] border border-purple-500/10"
              >
                <div className="text-[10px] font-mono text-purple-400/80">{p.label}</div>
                <div className="text-[9px] text-white/30 mt-0.5">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Staking flow ── */}
      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Staking Flow — Tokens → NFT Receipt
        </h3>
        <div className="flex flex-col items-center gap-3">
          {/* Step 1: Approve */}
          <FlowRow wrap>
            <Node icon="👤" label="Staker" color="border-blue-500/20" />
            <Arrow label="approve(pool, amount)" color="text-blue-400/40" />
            <Node icon="🪙" label="ERC-20 Token" color="border-amber-500/20" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/15" />
          {/* Step 2: Stake */}
          <FlowRow wrap>
            <Node icon="👤" label="Staker" color="border-blue-500/20" />
            <Arrow label="stake(amount)" color="text-purple-400/40" />
            <Node icon="🥩" label="Pool" color="border-purple-500/20" glow="rgba(168,85,247,0.06)" />
          </FlowRow>
          <Arrow dir="down" label="pool executes" color="text-white/15" />
          {/* Step 3: Results */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <FlowRow>
                <Node icon="🪙" label="Tokens" sub="transferFrom" color="border-amber-500/20" size="sm" />
                <Arrow label="locked in" color="text-amber-400/30" />
                <Node icon="🔒" label="Pool Vault" color="border-amber-500/20" size="sm" />
              </FlowRow>
            </div>
            <span className="text-white/10 text-lg">+</span>
            <div className="flex flex-col items-center gap-1">
              <FlowRow>
                <Node icon="🥩" label="Pool" color="border-purple-500/20" size="sm" />
                <Arrow label="mint()" color="text-emerald-400/30" />
                <Node icon="🎫" label="NFT Receipt" sub="ERC-721" color="border-emerald-500/20" glow="rgba(16,185,129,0.06)" size="sm" />
              </FlowRow>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Badge text="0.5% Fee → MoneyFund Wallet" color="bg-purple-500/10 text-purple-400/60" />
            <Badge text="NFT = tradeable on OpenSea" color="bg-emerald-500/10 text-emerald-400/60" />
          </div>
        </div>
      </div>

      {/* ── Reward distribution ── */}
      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Reward Distribution — Proportional to Stake Share
        </h3>
        <div className="flex flex-col items-center gap-3">
          {/* Inflow */}
          <FlowRow wrap>
            <Node icon="Ξ" label="ETH" sub="receive()" color="border-sky-500/20" size="sm" />
            <Node icon="🪙" label="ERC-20" sub="transfer()" color="border-amber-500/20" size="sm" />
            <Arrow label="sent to pool" color="text-sky-400/30" />
            <Node icon="🥩" label="Reward Pool" color="border-purple-500/20" glow="rgba(168,85,247,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="distributed by share" color="text-white/15" />
          {/* Distribution */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-md">
            {[
              { pct: "50%", tokens: "5,000", total: "10,000" },
              { pct: "30%", tokens: "3,000", total: "10,000" },
              { pct: "20%", tokens: "2,000", total: "10,000" },
            ].map((s, i) => (
              <div
                key={i}
                className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
              >
                <div className="text-lg mb-1">🎫</div>
                <div className="text-xs font-bold text-purple-400">{s.pct}</div>
                <div className="text-[9px] text-white/25 mt-0.5">
                  {s.tokens} / {s.total}
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-white/25 text-center">
            reward = (userStake / totalStaked) × rewardBalance
          </div>
          <FlowRow wrap>
            <Node icon="🎫" label="NFT Holder" color="border-emerald-500/20" size="sm" />
            <Arrow label="claimAllRewards(tokenId)" color="text-emerald-400/30" />
            <Node icon="💰" label="ETH + Tokens" sub="rewards sent" color="border-sky-500/20" size="sm" />
          </FlowRow>
          <Badge text="0.5% claim fee → MoneyFund Wallet" color="bg-purple-500/10 text-purple-400/60" />
        </div>
      </div>

      {/* ── Unstaking flow ── */}
      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Unstaking — NFT Burn + Penalty Mechanics
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="🎫" label="NFT" sub="ERC-721" color="border-emerald-500/20" />
            <Arrow label="unstake(tokenId)" color="text-red-400/40" />
            <Node icon="🥩" label="Pool" color="border-purple-500/20" />
          </FlowRow>
          <Arrow dir="down" label="pool executes" color="text-white/15" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
            <div className="text-center px-3 py-3 rounded-xl bg-red-500/[0.04] border border-red-500/10">
              <div className="text-lg mb-1">🔥</div>
              <div className="text-[10px] font-semibold text-red-400/80">NFT Burned</div>
              <div className="text-[9px] text-white/25 mt-0.5">Receipt destroyed</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/10">
              <div className="text-lg mb-1">💰</div>
              <div className="text-[10px] font-semibold text-emerald-400/80">Tokens Returned</div>
              <div className="text-[9px] text-white/25 mt-0.5">amount − penalty</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
              <div className="text-lg mb-1">⚠️</div>
              <div className="text-[10px] font-semibold text-amber-400/80">Penalty</div>
              <div className="text-[9px] text-white/25 mt-0.5">→ Pool Creator</div>
            </div>
          </div>

          {/* Penalty formula */}
          <div className="w-full max-w-lg px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
            <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-2">
              Penalty Formula
            </div>
            <div className="text-sm font-mono text-amber-400/80">
              penalty = initPenalty − (daysAfterLock × decayPerDay)
            </div>
            <div className="text-sm font-mono text-emerald-400/80 mt-1">
              breakeven = hardLock + (initPenalty / decayPerDay)
            </div>
          </div>
        </div>
      </div>

      {/* ── Interactive penalty timeline ── */}
      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Interactive Penalty Timeline
        </h3>
        <div className="grid grid-cols-3 gap-3 max-w-md">
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Hard Lock (days)
            </label>
            <input
              type="range"
              min={0}
              max={60}
              value={h}
              onChange={(e) => setH(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="text-xs text-purple-400 text-center mt-0.5">{h}</div>
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Init Penalty (%)
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={p}
              onChange={(e) => setP(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
            <div className="text-xs text-amber-400 text-center mt-0.5">{p}%</div>
          </div>
          <div>
            <label className="text-[10px] text-white/30 uppercase tracking-wider font-semibold block mb-1">
              Decay/Day (%)
            </label>
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={d}
              onChange={(e) => setD(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="text-xs text-emerald-400 text-center mt-0.5">{d}%</div>
          </div>
        </div>
        <PenaltyTimeline hardLock={h} initPenalty={p} decayPerDay={d} />
      </div>

      {/* ── NFT Mechanics ── */}
      <div className={`${card} p-5 sm:p-6 space-y-4`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          ERC-721 Receipt NFT — Lifecycle
        </h3>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { step: "1", icon: "🪙", title: "Stake Tokens", desc: "Deposit ERC-20 into pool", color: "border-blue-500/15" },
            { step: "2", icon: "🎫", title: "NFT Minted", desc: "Unique ERC-721 receipt", color: "border-emerald-500/15" },
            { step: "3", icon: "🔄", title: "Tradeable", desc: "Sell/transfer on OpenSea", color: "border-indigo-500/15" },
            { step: "4", icon: "💰", title: "Claim Rewards", desc: "NFT holder earns dividends", color: "border-amber-500/15" },
            { step: "5", icon: "🔥", title: "Unstake & Burn", desc: "Tokens returned, NFT destroyed", color: "border-red-500/15" },
          ].map((s) => (
            <div
              key={s.step}
              className={`w-28 px-3 py-3 rounded-xl bg-white/[0.02] border ${s.color} text-center`}
            >
              <div className="text-[9px] text-white/20 font-bold mb-1">STEP {s.step}</div>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="text-[11px] font-semibold text-white/70">{s.title}</div>
              <div className="text-[9px] text-white/25 mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  ETF LAUNCHER SECTION                                               */
/* ================================================================== */

function EtfSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="📈"
        title="ETF Launcher"
        sub="Weighted token baskets with Uniswap V2 swaps and Chainlink pricing"
        accent="text-amber-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Create → Mint → Burn Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-amber-500/20" />
            <Arrow label="createETF(name, symbol, tokens[], weights[])" color="text-amber-400/40" />
            <Node icon="🏭" label="ETF Manager" color="border-amber-500/20" glow="rgba(245,158,11,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="deploys ERC-20 share token" color="text-white/15" />
          <Node icon="📈" label="ETF Token" sub="ERC-20 shares" color="border-amber-500/20" glow="rgba(245,158,11,0.06)" size="lg" />
        </div>

        {/* Token basket */}
        <div className="text-center space-y-2">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            Weighted Token Basket
          </div>
          <div className="flex justify-center gap-2 flex-wrap">
            {[
              { sym: "WETH", pct: "40%", color: "bg-blue-500/10 text-blue-400/80 border-blue-500/15" },
              { sym: "USDC", pct: "25%", color: "bg-green-500/10 text-green-400/80 border-green-500/15" },
              { sym: "LINK", pct: "20%", color: "bg-indigo-500/10 text-indigo-400/80 border-indigo-500/15" },
              { sym: "UNI", pct: "15%", color: "bg-pink-500/10 text-pink-400/80 border-pink-500/15" },
            ].map((t) => (
              <div
                key={t.sym}
                className={`px-3 py-2 rounded-lg border text-xs font-semibold ${t.color}`}
              >
                {t.sym} {t.pct}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mint / Burn */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`${card} p-5 space-y-3`}>
          <h4 className="text-xs font-bold text-emerald-400/80 uppercase tracking-wider">Mint (Buy In)</h4>
          <FlowCol>
            <FlowRow>
              <Node icon="Ξ" label="ETH" color="border-sky-500/20" size="sm" />
              <Arrow label="mintWithEth()" color="text-emerald-400/30" />
              <Node icon="🏭" label="Manager" color="border-amber-500/20" size="sm" />
            </FlowRow>
            <Arrow dir="down" color="text-emerald-400/20" />
            <div className="text-center text-[9px] text-white/25">
              Uniswap V2 swaps ETH → underlying tokens
            </div>
            <Arrow dir="down" color="text-emerald-400/20" />
            <FlowRow>
              <Node icon="📈" label="ETF Shares" sub="minted to user" color="border-emerald-500/20" size="sm" />
            </FlowRow>
          </FlowCol>
          <Badge text="0.35% fee: 0.125% wallet + 0.125% dividends + 0.1% MONEY burn" color="bg-amber-500/10 text-amber-400/60" />
        </div>

        <div className={`${card} p-5 space-y-3`}>
          <h4 className="text-xs font-bold text-red-400/80 uppercase tracking-wider">Burn (Redeem)</h4>
          <FlowCol>
            <FlowRow>
              <Node icon="📈" label="ETF Shares" color="border-amber-500/20" size="sm" />
              <Arrow label="burn()" color="text-red-400/30" />
              <Node icon="🏭" label="Manager" color="border-amber-500/20" size="sm" />
            </FlowRow>
            <Arrow dir="down" color="text-red-400/20" />
            <div className="text-center text-[9px] text-white/25">
              Underlying tokens sold → ETH via Uniswap
            </div>
            <Arrow dir="down" color="text-red-400/20" />
            <FlowRow>
              <Node icon="Ξ" label="ETH" sub="returned to user" color="border-sky-500/20" size="sm" />
            </FlowRow>
          </FlowCol>
          <Badge text="Shares burned, proportional ETH returned" color="bg-red-500/10 text-red-400/60" />
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  DAO SECTION                                                        */
/* ================================================================== */

function DaoSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🗳️"
        title="DAO Launcher"
        sub="On-chain governance with token-weighted voting and proposal execution"
        accent="text-sky-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Proposal Lifecycle
        </h3>
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { step: "1", icon: "📝", title: "Create Proposal", desc: "Send ETH or swap tokens", color: "border-sky-500/15" },
            { step: "2", icon: "🗳️", title: "Voting Period", desc: "Token holders vote Yes/No", color: "border-indigo-500/15" },
            { step: "3", icon: "⏱️", title: "Period Ends", desc: "Votes tallied by weight", color: "border-amber-500/15" },
            { step: "4", icon: "⚡", title: "Execute", desc: "If majority reached", color: "border-emerald-500/15" },
            { step: "5", icon: "🔓", title: "Reclaim", desc: "Unlock voting tokens", color: "border-purple-500/15" },
          ].map((s) => (
            <div
              key={s.step}
              className={`w-28 px-3 py-3 rounded-xl bg-white/[0.02] border ${s.color} text-center`}
            >
              <div className="text-[9px] text-white/20 font-bold mb-1">STEP {s.step}</div>
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="text-[11px] font-semibold text-white/70">{s.title}</div>
              <div className="text-[9px] text-white/25 mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2 pt-3">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            Vote Weight Mechanics
          </div>
          <div className="w-full max-w-md px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="text-[10px] text-white/40 space-y-1.5">
              <div className="flex justify-between">
                <span>Vote weight</span>
                <span className="text-sky-400/70 font-mono">userTokenBalance</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens locked during vote</span>
                <span className="text-amber-400/70 font-mono">voteLockPct% of balance</span>
              </div>
              <div className="flex justify-between">
                <span>Silence = Consent</span>
                <span className="text-emerald-400/70 font-mono">non-voters count as Yes</span>
              </div>
              <div className="flex justify-between">
                <span>Execution swap fee</span>
                <span className="text-purple-400/70 font-mono">0.5% → wallet + dividends</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  DEX SECTION                                                        */
/* ================================================================== */

function DexSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🍒"
        title="MoneyFund DEX"
        sub="Custom AMM with constant-product pools and LP rewards"
        accent="text-pink-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          AMM Architecture
        </h3>

        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="🪙" label="Token A" color="border-pink-500/20" />
            <span className="text-white/10 text-lg">×</span>
            <Node icon="🪙" label="Token B" color="border-pink-500/20" />
            <span className="text-white/10 text-lg">=</span>
            <Node icon="📊" label="k (constant)" sub="x × y = k" color="border-pink-500/20" glow="rgba(236,72,153,0.06)" />
          </FlowRow>

          <div className="w-full max-w-lg grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="text-center px-3 py-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/10">
              <div className="text-lg mb-1">💧</div>
              <div className="text-[11px] font-semibold text-emerald-400/80">Add Liquidity</div>
              <div className="text-[9px] text-white/25 mt-0.5">Deposit both tokens, receive LP shares</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-pink-500/[0.04] border border-pink-500/10">
              <div className="text-lg mb-1">⇄</div>
              <div className="text-[11px] font-semibold text-pink-400/80">Swap</div>
              <div className="text-[9px] text-white/25 mt-0.5">Trade along the curve, 0.5% fee</div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-red-500/[0.04] border border-red-500/10">
              <div className="text-lg mb-1">🔥</div>
              <div className="text-[11px] font-semibold text-red-400/80">Remove Liquidity</div>
              <div className="text-[9px] text-white/25 mt-0.5">Burn LP, reclaim both tokens</div>
            </div>
          </div>
        </div>

        {/* Fee split */}
        <div className="text-center space-y-2 pt-2">
          <div className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
            0.5% Swap Fee Distribution
          </div>
          <div className="flex justify-center gap-3">
            <Badge text="0.3% → Liquidity Providers" color="bg-emerald-500/10 text-emerald-400/60" />
            <Badge text="0.1% → Wallet" color="bg-pink-500/10 text-pink-400/60" />
            <Badge text="0.1% → Dividends" color="bg-purple-500/10 text-purple-400/60" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  STOREFRONT SECTION                                                 */
/* ================================================================== */

function StorefrontSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🛒"
        title="Storefront Launcher"
        sub="Decentralized NFT marketplace with custom payee splits"
        accent="text-emerald-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Marketplace Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-emerald-500/20" />
            <Arrow label="createNFTLocker(payees, shares)" color="text-emerald-400/40" />
            <Node icon="🏪" label="Storefront" sub="NFT Locker" color="border-emerald-500/20" glow="rgba(16,185,129,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/15" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 w-full max-w-xl">
            {[
              { icon: "📦", title: "Deposit NFT", desc: "ERC-721 → Locker" },
              { icon: "🏷️", title: "List NFT", desc: "Set price + timelock" },
              { icon: "💳", title: "Buy NFT", desc: "ETH or ERC-20" },
              { icon: "💸", title: "Split Payment", desc: "99.6% to payees" },
            ].map((s) => (
              <div key={s.title} className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-[10px] font-semibold text-white/70">{s.title}</div>
                <div className="text-[9px] text-white/25 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
          <Badge text="0.4% sale fee: 0.2% wallet + 0.2% dividends" color="bg-emerald-500/10 text-emerald-400/60" />
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  AUCTION SECTION                                                    */
/* ================================================================== */

function AuctionSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🖼️"
        title="Ad-space Launcher"
        sub="Continuous ascending auctions with configurable refund and comment mechanics"
        accent="text-orange-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Auction Lifecycle
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Creator" color="border-orange-500/20" />
            <Arrow label="deployAuction()" color="text-orange-400/40" />
            <Node icon="🖼️" label="Auction Contract" color="border-orange-500/20" glow="rgba(249,115,22,0.08)" />
          </FlowRow>
          <Arrow dir="down" color="text-white/15" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg">
            {[
              { icon: "💰", title: "Place Bid", desc: "Must exceed previous + increment" },
              { icon: "↩️", title: "Refund", desc: "0-100% of outbid amount returned" },
              { icon: "✍️", title: "Sign Ad", desc: "Comment for a fee ($1+ USD)" },
            ].map((s) => (
              <div key={s.title} className="text-center px-2 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-[10px] font-semibold text-white/70">{s.title}</div>
                <div className="text-[9px] text-white/25 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
          <Badge text="0.4% bid fee: 0.2% wallet + 0.2% dividends" color="bg-orange-500/10 text-orange-400/60" />
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  MULTISWAP SECTION                                                  */
/* ================================================================== */

function MultiswapSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🐙"
        title="Multiswap Launcher"
        sub="Batch swaps and distributions via Uniswap V2 in a single transaction"
        accent="text-teal-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Swap + Distribute Architecture
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Deployer" color="border-teal-500/20" />
            <Arrow label="deploy(swapReceivers, distReceivers)" color="text-teal-400/40" />
            <Node icon="🐙" label="Multiswap Widget" color="border-teal-500/20" glow="rgba(20,184,166,0.08)" />
          </FlowRow>
          <Arrow dir="down" color="text-white/15" />
          <div className="grid grid-cols-2 gap-3 w-full max-w-md">
            <div className="text-center px-3 py-3 rounded-xl bg-teal-500/[0.04] border border-teal-500/10">
              <div className="text-lg mb-1">⇄</div>
              <div className="text-[11px] font-semibold text-teal-400/80">Batch Swaps</div>
              <div className="text-[9px] text-white/25 mt-1 space-y-0.5">
                <div>ETH → Multiple tokens</div>
                <div>Token → Multiple tokens</div>
                <div>Multi-hop routing</div>
              </div>
            </div>
            <div className="text-center px-3 py-3 rounded-xl bg-teal-500/[0.04] border border-teal-500/10">
              <div className="text-lg mb-1">📤</div>
              <div className="text-[11px] font-semibold text-teal-400/80">Batch Distributions</div>
              <div className="text-[9px] text-white/25 mt-1 space-y-0.5">
                <div>ETH to many wallets</div>
                <div>Tokens to many wallets</div>
                <div>Custom split %</div>
              </div>
            </div>
          </div>
          <Badge text="0.1% fee: 0.05% wallet + 0.05% dividends" color="bg-teal-500/10 text-teal-400/60" />
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  AIRDROP SECTION                                                    */
/* ================================================================== */

function AirdropSection() {
  return (
    <section className="space-y-8">
      <SectionTitle
        icon="🎁"
        title="Airdrop Tool"
        sub="Batch ERC-20 distribution to multiple recipients in one transaction"
        accent="text-rose-400/80"
      />

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className="text-sm font-bold text-white/60 uppercase tracking-wider">
          Airdrop Flow
        </h3>
        <div className="flex flex-col items-center gap-3">
          <FlowRow wrap>
            <Node icon="👤" label="Sender" color="border-rose-500/20" />
            <Arrow label="approve(contract, total)" color="text-rose-400/40" />
            <Node icon="🪙" label="ERC-20" color="border-amber-500/20" />
          </FlowRow>
          <Arrow dir="down" label="then" color="text-white/15" />
          <FlowRow wrap>
            <Node icon="👤" label="Sender" color="border-rose-500/20" />
            <Arrow label="airdropTokens(token, recipients[], amounts[])" color="text-rose-400/40" />
            <Node icon="🎁" label="Airdrop Contract" color="border-rose-500/20" glow="rgba(244,63,94,0.08)" />
          </FlowRow>
          <Arrow dir="down" label="distributes" color="text-white/15" />
          <div className="flex gap-2 flex-wrap justify-center">
            {["👤", "👤", "👤", "👤", "👤"].map((_, i) => (
              <Node key={i} icon="👤" label={`Recipient ${i + 1}`} color="border-white/[0.06]" size="sm" />
            ))}
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <Badge text="Uniform mode: same amount to all" color="bg-rose-500/10 text-rose-400/60" />
            <Badge text="Individual mode: custom per-recipient" color="bg-amber-500/10 text-amber-400/60" />
          </div>
          <Badge text="0.2% fee: 0.1% wallet + 0.1% dividends" color="bg-rose-500/10 text-rose-400/60" />
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/*  MAIN DOCS APP                                                      */
/* ================================================================== */

export default function DocsApp() {
  const [active, setActive] = useState("dividends");

  const sectionComponents: Record<string, React.ReactNode> = {
    dividends: <DividendSection />,
    etf: <EtfSection />,
    dao: <DaoSection />,
    dex: <DexSection />,
    storefront: <StorefrontSection />,
    auction: <AuctionSection />,
    multiswap: <MultiswapSection />,
    airdrop: <AirdropSection />,
  };

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="max-w-[900px] mx-auto space-y-6">
        {/* Header */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
            Smart Contract Docs
          </h1>
          <p className="text-xs text-white/30 mt-1">
            Visual architecture diagrams for every MoneyFund dApp
          </p>
        </div>

        {/* Navigation */}
        <div className={`${card} p-1.5 flex gap-1 overflow-x-auto`} style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
          {DAPP_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={`shrink-0 h-10 px-3 sm:px-4 rounded-xl text-xs sm:text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                active === s.id
                  ? "bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  : "text-white/35 hover:text-white/55 hover:bg-white/[0.03]"
              }`}
            >
              <span className="text-xs">{s.icon}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Active section */}
        <div>{sectionComponents[active]}</div>

        {/* Back link */}
        <div className="text-center pt-4 pb-8">
          <Link href="/" className="text-xs text-white/20 hover:text-white/40 transition-colors">
            ← Back to MoneyFund
          </Link>
        </div>
      </div>
    </div>
  );
}
