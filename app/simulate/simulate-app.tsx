"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

/* ================================================================== */
/*  DESIGN TOKENS (matching about-app)                                 */
/* ================================================================== */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary =
  "h-11 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-amber-600 to-amber-500 text-white hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer";
const btnSecondary =
  "h-11 px-6 rounded-xl font-semibold text-sm border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer";

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const API_KEY = "MB89VXUF27QJHA7QYJMPE9W55UGYZNV39C";
const ETH_PRICE_URL = `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=${API_KEY}`;
const GAS_PRICE_URL = `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${API_KEY}`;
const DEFAULT_ETH_PRICE = 4321.05;
const DEFAULT_GAS_PRICE = 0.21;

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

interface CalcInputs {
  stakeAmount: number;
  totalPoolStaked: number;
  totalSupply: number;
  tokenPrice: number;
  hardLockDuration: number;
  initialPenaltyPercent: number;
  penaltyDecayPercent: number;
  withdrawalDay: number;
  profitSources: number;
  swapCount: number;
  swapFee: number;
  swapVolume: number;
  airdropCount: number;
  airdropFee: number;
  airdropVolume: number;
  nftSalePrice: number;
  nftSaleCount: number;
  nftShareholderPercent: number;
  bidAmount: number;
  bidFee: number;
  auctionCount: number;
  signFeeEth: number;
  commentCount: number;
}

interface CalcResults {
  totalYield: number;
  multiswapYield: number;
  storefrontYield: number;
  adspaceYield: number;
  stakingFee: number;
  penaltyMftl: number;
  gasCostEth: number;
  gasCostUsd: number;
  yieldPercent: number;
  poolShare: number;
  breakevenDays: number;
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function validateInputs(inputs: CalcInputs): string[] {
  const errors: string[] = [];
  if (inputs.stakeAmount <= 0) errors.push("Stake amount must be positive.");
  if (inputs.totalPoolStaked <= 0)
    errors.push("Total pool staked must be positive.");
  if (inputs.totalSupply <= 0) errors.push("Total supply must be positive.");
  if (inputs.tokenPrice <= 0) errors.push("Token price must be positive.");
  if (inputs.hardLockDuration < 0)
    errors.push("Hard lock duration cannot be negative.");
  if (
    inputs.initialPenaltyPercent < 0 ||
    inputs.initialPenaltyPercent > 100
  )
    errors.push("Initial penalty must be 0–100%.");
  if (inputs.penaltyDecayPercent < 0 || inputs.penaltyDecayPercent > 100)
    errors.push("Penalty decay must be 0–100%.");
  if (inputs.withdrawalDay < 0)
    errors.push("Withdrawal day cannot be negative.");
  if (inputs.stakeAmount > inputs.totalPoolStaked)
    errors.push("Stake cannot exceed pool.");
  if (inputs.totalPoolStaked > inputs.totalSupply)
    errors.push("Pool cannot exceed total supply.");
  if (
    inputs.swapCount < 0 ||
    inputs.airdropCount < 0 ||
    inputs.swapVolume < 0 ||
    inputs.airdropVolume < 0
  )
    errors.push("Counts and volumes cannot be negative.");
  if (
    inputs.swapFee < 0 ||
    inputs.swapFee > 3 ||
    inputs.airdropFee < 0 ||
    inputs.airdropFee > 3
  )
    errors.push("Fees must be 0–3%.");
  if (inputs.nftSalePrice < 0 || inputs.nftSaleCount < 0)
    errors.push("NFT sale price and count cannot be negative.");
  if (
    inputs.nftShareholderPercent < 0 ||
    inputs.nftShareholderPercent > 99.6
  )
    errors.push("Payee share must be 0–99.6%.");
  if (
    inputs.bidAmount < 0 ||
    inputs.auctionCount < 0 ||
    inputs.commentCount < 0 ||
    inputs.signFeeEth < 0
  )
    errors.push(
      "Bid amount, auction count, comment count, and comment fee cannot be negative."
    );
  if (inputs.bidFee < 0 || inputs.bidFee > 100)
    errors.push("Bid fee must be 0–100%.");
  return errors;
}

function calculateYield(
  inputs: CalcInputs,
  gasPrice: number,
  ethPrice: number
): CalcResults {
  const stakeShare = inputs.stakeAmount / inputs.totalPoolStaked;
  const poolShare = (inputs.totalPoolStaked / inputs.totalSupply) * 100;
  const stakingFee = inputs.stakeAmount * 0.005;

  let multiswapYield = 0,
    storefrontYield = 0,
    adspaceYield = 0;
  if (inputs.profitSources >= 1) {
    const swapFee =
      inputs.swapCount * inputs.swapFee * 0.01 * inputs.swapVolume;
    const airdropFee =
      inputs.airdropCount * inputs.airdropFee * 0.01 * inputs.airdropVolume;
    multiswapYield = (swapFee + airdropFee) * stakeShare;
  }
  if (inputs.profitSources >= 2) {
    const shareholderProfit =
      inputs.nftSalePrice *
      inputs.nftSaleCount *
      (inputs.nftShareholderPercent * 0.01);
    storefrontYield = shareholderProfit * stakeShare;
  }
  if (inputs.profitSources === 3) {
    const bidFee =
      inputs.bidAmount * inputs.auctionCount * (inputs.bidFee * 0.01);
    adspaceYield = bidFee * stakeShare;
  }

  let totalYield = multiswapYield + storefrontYield + adspaceYield;
  let penaltyMftl = 0;
  const breakevenDays =
    inputs.penaltyDecayPercent > 0
      ? inputs.hardLockDuration +
        inputs.initialPenaltyPercent / inputs.penaltyDecayPercent
      : 0;

  if (
    inputs.withdrawalDay > 0 &&
    inputs.withdrawalDay < inputs.hardLockDuration
  ) {
    penaltyMftl =
      inputs.stakeAmount * (inputs.initialPenaltyPercent / 100);
  } else if (inputs.withdrawalDay >= inputs.hardLockDuration) {
    const daysAfterLock =
      inputs.withdrawalDay - inputs.hardLockDuration;
    const penaltyPercent = Math.max(
      0,
      inputs.initialPenaltyPercent -
        daysAfterLock * inputs.penaltyDecayPercent
    );
    penaltyMftl = inputs.stakeAmount * (penaltyPercent / 100);
  }
  totalYield -= penaltyMftl * inputs.tokenPrice;

  const gasUnits = {
    stake: 80000,
    withdraw: 60000,
    swap: 120000,
    airdrop: 100000,
    nftSale: 150000,
    bid: 70000,
    comment: 50000,
    launch: 1000000,
  };
  let totalGasUnits =
    gasUnits.stake + (inputs.withdrawalDay > 0 ? gasUnits.withdraw : 0);
  if (inputs.profitSources >= 1)
    totalGasUnits +=
      inputs.swapCount * gasUnits.swap +
      inputs.airdropCount * gasUnits.airdrop;
  if (inputs.profitSources >= 2)
    totalGasUnits += inputs.nftSaleCount * gasUnits.nftSale;
  if (inputs.profitSources === 3)
    totalGasUnits +=
      inputs.auctionCount * gasUnits.bid +
      inputs.commentCount * gasUnits.comment;
  totalGasUnits += gasUnits.launch;

  const gasCostEth = totalGasUnits * gasPrice * 1e-9;
  const gasCostUsd = gasCostEth * ethPrice;

  return {
    totalYield,
    multiswapYield,
    storefrontYield,
    adspaceYield,
    stakingFee,
    penaltyMftl,
    gasCostEth,
    gasCostUsd,
    yieldPercent:
      (totalYield / (inputs.stakeAmount * inputs.tokenPrice)) * 100,
    poolShare,
    breakevenDays,
  };
}

/* ================================================================== */
/*  SECTION HEADING (matching about-app)                               */
/* ================================================================== */

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
      {sub && <p className="text-xs text-white/30">{sub}</p>}
      <div className="mx-auto mt-3 w-16 h-[2px] rounded-full bg-gradient-to-r from-cyan-500/60 to-purple-500/60" />
    </div>
  );
}

/* ================================================================== */
/*  INPUT GROUP                                                        */
/* ================================================================== */

function InputGroup({
  label,
  tooltip,
  id,
  value,
  onChange,
  type = "number",
  min,
  max,
  step,
  readOnly,
}: {
  label: string;
  tooltip: string;
  id: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}) {
  return (
    <div className="group relative">
      <label
        htmlFor={id}
        className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        readOnly={readOnly}
        className={`${inputCls} ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
      />
      <div className="absolute left-0 bottom-full mb-1 px-3 py-1.5 rounded-lg bg-brand-900 border border-white/[0.08] text-[10px] text-white/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
        {tooltip}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  COLLAPSIBLE SECTION                                                */
/* ================================================================== */

function CollapsibleSection({
  id,
  title,
  gradient,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  gradient: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all cursor-pointer hover:brightness-110 ${gradient}`}
        aria-expanded={open}
        aria-controls={`${id}-body`}
      >
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
        {title}
      </button>
      <div
        id={`${id}-body`}
        className={`overflow-hidden transition-all duration-300 ${
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

const DEFAULTS: CalcInputs = {
  stakeAmount: 1000,
  totalPoolStaked: 10000,
  totalSupply: 1000000,
  tokenPrice: 0.00001,
  hardLockDuration: 2,
  initialPenaltyPercent: 30,
  penaltyDecayPercent: 2,
  withdrawalDay: 6,
  profitSources: 3,
  swapCount: 100,
  swapFee: 1,
  swapVolume: 100,
  airdropCount: 50,
  airdropFee: 1,
  airdropVolume: 50,
  nftSalePrice: 10,
  nftSaleCount: 10,
  nftShareholderPercent: 50,
  bidAmount: 5,
  bidFee: 5,
  auctionCount: 10,
  signFeeEth: 0.0001,
  commentCount: 50,
};

export default function SimulateApp() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    staking: false,
    profit: false,
    settings: false,
    info: false,
  });
  const [inputs, setInputs] = useState<CalcInputs>(DEFAULTS);
  const [ethPrice, setEthPrice] = useState(DEFAULT_ETH_PRICE);
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [results, setResults] = useState<CalcResults | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showInputsSummary, setShowInputsSummary] = useState(false);

  const pieChartRef = useRef<HTMLCanvasElement>(null);
  const lineChartRef = useRef<HTMLCanvasElement>(null);
  const pieChartInst = useRef<Chart | null>(null);
  const lineChartInst = useRef<Chart | null>(null);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => (next[k] = false));
      next[id] = !prev[id];
      return next;
    });
  }, []);

  const updateInput = useCallback(
    (key: keyof CalcInputs, value: string) => {
      setInputs((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
    },
    []
  );

  const fetchPrices = useCallback(async () => {
    let ethOk = false,
      gasOk = false;
    try {
      const res = await fetch(ETH_PRICE_URL);
      const data = await res.json();
      if (data.status === "1" && data.result?.ethusd) {
        const p = parseFloat(data.result.ethusd);
        setEthPrice(p);
        ethOk = true;
      }
    } catch {
      /* use default */
    }
    try {
      const res = await fetch(GAS_PRICE_URL);
      const data = await res.json();
      if (data.status === "1" && data.result?.ProposeGasPrice) {
        const p = parseFloat(data.result.ProposeGasPrice);
        setGasPrice(p);
        gasOk = true;
      }
    } catch {
      /* use default */
    }
    return { ethOk, gasOk };
  }, []);

  const renderCharts = useCallback(
    (res: CalcResults, inp: CalcInputs) => {
      if (pieChartInst.current) pieChartInst.current.destroy();
      if (lineChartInst.current) lineChartInst.current.destroy();

      if (pieChartRef.current) {
        pieChartInst.current = new Chart(pieChartRef.current, {
          type: "pie",
          data: {
            labels: ["Multiswap", "Storefront", "Adspace"],
            datasets: [
              {
                data: [
                  inp.profitSources >= 1 ? res.multiswapYield : 0,
                  inp.profitSources >= 2 ? res.storefrontYield : 0,
                  inp.profitSources === 3 ? res.adspaceYield : 0,
                ],
                backgroundColor: [
                  "rgba(20,184,166,0.8)",
                  "rgba(16,185,129,0.8)",
                  "rgba(245,158,11,0.8)",
                ],
                borderColor: "rgba(255,255,255,0.1)",
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "top",
                labels: { color: "#ccc", font: { size: 11 } },
              },
              title: {
                display: true,
                text: "Dividend Breakdown",
                color: "#ccc",
                font: { size: 13 },
              },
            },
          },
        });
      }

      if (lineChartRef.current && window.innerWidth > 640) {
        lineChartInst.current = new Chart(lineChartRef.current, {
          type: "line",
          data: {
            labels: Array.from(
              { length: 5 },
              (_, i) =>
                (
                  ((i + 1) * inp.totalPoolStaked) /
                  5 /
                  inp.totalSupply *
                  100
                ).toFixed(2) + "%"
            ),
            datasets: [
              {
                label: "Yield (ETH)",
                data: Array.from({ length: 5 }, (_, i) => {
                  const tempInputs = {
                    ...inp,
                    stakeAmount: ((i + 1) * inp.stakeAmount) / 5,
                  };
                  return calculateYield(tempInputs, gasPrice, ethPrice)
                    .totalYield;
                }),
                borderColor: "#7C3AED",
                backgroundColor: "rgba(91, 33, 182, 0.2)",
                fill: true,
                tension: 0.4,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "top",
                labels: { color: "#ccc", font: { size: 11 } },
              },
              title: {
                display: true,
                text: "Yield vs. Pool Share",
                color: "#ccc",
                font: { size: 13 },
              },
            },
            scales: {
              x: {
                title: {
                  display: true,
                  text: "Pool Share (% of Supply)",
                  color: "#999",
                },
                ticks: { color: "#999" },
              },
              y: {
                title: {
                  display: true,
                  text: "Yield (ETH)",
                  color: "#999",
                },
                ticks: { color: "#999" },
              },
            },
          },
        });
      }
    },
    [ethPrice, gasPrice]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError("");

      const errors = validateInputs(inputs);
      if (errors.length > 0) {
        setError(errors.join(" "));
        setLoading(false);
        return;
      }

      const { ethOk, gasOk } = await fetchPrices();
      if (!ethOk || !gasOk) {
        setError("Using default prices due to API failure.");
      }

      const res = calculateYield(inputs, gasPrice, ethPrice);
      setResults(res);
      renderCharts(res, inputs);
      setLoading(false);

      setTimeout(() => {
        document
          .getElementById("results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    },
    [inputs, fetchPrices, gasPrice, ethPrice, renderCharts]
  );

  const handleReset = useCallback(() => {
    setInputs(DEFAULTS);
    setResults(null);
    setError("");
    setShowInputsSummary(false);
    if (pieChartInst.current) pieChartInst.current.destroy();
    if (lineChartInst.current) lineChartInst.current.destroy();
    pieChartInst.current = null;
    lineChartInst.current = null;
  }, []);

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-16 space-y-12">
        {/* Header */}
        <div className="text-center space-y-3 pt-6">
          <h1 className="text-3xl sm:text-[42px] font-extrabold text-white uppercase tracking-wider">
            Dividend Calculator
          </h1>
          <p className="text-sm text-white/40 max-w-lg mx-auto leading-relaxed">
            Simulate your annual dividend yield from staked MFTL tokens
            across the MoneyFund protocol.
          </p>
          <div className="mx-auto mt-4 w-24 h-[2px] rounded-full bg-gradient-to-r from-amber-500/40 via-purple-500/40 to-teal-500/40" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ═══════════ STAKING POOL ═══════════ */}
          <section id="staking" className="scroll-mt-28">
            <div className={`${card} p-5 sm:p-8`}>
              <CollapsibleSection
                id="staking"
                title="Staking Pool"
                gradient="bg-gradient-to-r from-[#8B3A2B] to-[#A65343]"
                open={openSections.staking}
                onToggle={() => toggleSection("staking")}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                  <InputGroup
                    label="Stake Amount (Tokens)"
                    tooltip="Your staked MFTL tokens"
                    id="stakeAmount"
                    value={inputs.stakeAmount}
                    onChange={(v) => updateInput("stakeAmount", v)}
                    min={1}
                  />
                  <InputGroup
                    label="Total Pool Staked (Tokens)"
                    tooltip="Total tokens in the staking pool"
                    id="totalPoolStaked"
                    value={inputs.totalPoolStaked}
                    onChange={(v) => updateInput("totalPoolStaked", v)}
                    min={1}
                  />
                  <InputGroup
                    label="Total Token Supply"
                    tooltip="Total MFTL tokens in circulation"
                    id="totalSupply"
                    value={inputs.totalSupply}
                    onChange={(v) => updateInput("totalSupply", v)}
                    min={1}
                  />
                  <InputGroup
                    label="Token Price (ETH)"
                    tooltip="MFTL token price in ETH"
                    id="tokenPrice"
                    value={inputs.tokenPrice}
                    onChange={(v) => updateInput("tokenPrice", v)}
                    min={0}
                    step={0.00000001}
                  />
                  <InputGroup
                    label="Hard Lock Duration (Days)"
                    tooltip="Days tokens are locked without withdrawal"
                    id="hardLockDuration"
                    value={inputs.hardLockDuration}
                    onChange={(v) => updateInput("hardLockDuration", v)}
                    min={0}
                  />
                  <InputGroup
                    label="Initial Penalty (%)"
                    tooltip="Penalty % for early withdrawal after hard lock"
                    id="initialPenaltyPercent"
                    value={inputs.initialPenaltyPercent}
                    onChange={(v) => updateInput("initialPenaltyPercent", v)}
                    min={0}
                    max={100}
                    step={0.01}
                  />
                  <InputGroup
                    label="Penalty Decay (%/Day)"
                    tooltip="Daily reduction in penalty % after hard lock"
                    id="penaltyDecayPercent"
                    value={inputs.penaltyDecayPercent}
                    onChange={(v) => updateInput("penaltyDecayPercent", v)}
                    min={0}
                    max={100}
                    step={0.01}
                  />
                  <InputGroup
                    label="Withdrawal Day"
                    tooltip="Day of withdrawal since staking (0 for no early withdrawal)"
                    id="withdrawalDay"
                    value={inputs.withdrawalDay}
                    onChange={(v) => updateInput("withdrawalDay", v)}
                    min={0}
                  />
                </div>
              </CollapsibleSection>
            </div>
          </section>

          {/* ═══════════ PROFIT LAYER ═══════════ */}
          <section id="profit" className="scroll-mt-28">
            <div className={`${card} p-5 sm:p-8`}>
              <CollapsibleSection
                id="profit"
                title="Profit Layer"
                gradient="bg-gradient-to-r from-[#3F2A6D] to-[#4B367E]"
                open={openSections.profit}
                onToggle={() => toggleSection("profit")}
              >
                <div className="space-y-6 pt-4">
                  {/* Profit Sources Selector */}
                  <div className="max-w-xs">
                    <label
                      htmlFor="profitSources"
                      className="text-[10px] text-white/30 font-bold uppercase tracking-wider block mb-1.5"
                    >
                      Profit Sources
                    </label>
                    <select
                      id="profitSources"
                      value={inputs.profitSources}
                      onChange={(e) =>
                        updateInput("profitSources", e.target.value)
                      }
                      className={selectCls}
                    >
                      <option value={1}>1/3 (Multiswap)</option>
                      <option value={2}>2/3 (Multiswap + Storefront)</option>
                      <option value={3}>3/3 (All)</option>
                    </select>
                  </div>

                  {/* Multiswap */}
                  <div>
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                      Multiswap
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <InputGroup
                        label="Swaps"
                        tooltip="Number of swaps (0–3% fee)"
                        id="swapCount"
                        value={inputs.swapCount}
                        onChange={(v) => updateInput("swapCount", v)}
                        min={0}
                      />
                      <InputGroup
                        label="Swap Fee (%)"
                        tooltip="Fee per swap (0–3%, to staking pool)"
                        id="swapFee"
                        value={inputs.swapFee}
                        onChange={(v) => updateInput("swapFee", v)}
                        min={0}
                        max={3}
                        step={0.01}
                      />
                      <InputGroup
                        label="Swap Volume (ETH)"
                        tooltip="Total swap transaction volume"
                        id="swapVolume"
                        value={inputs.swapVolume}
                        onChange={(v) => updateInput("swapVolume", v)}
                        min={0}
                        step={0.01}
                      />
                      <InputGroup
                        label="Distributions"
                        tooltip="Number of airdrops/transfers (0–3% fee)"
                        id="airdropCount"
                        value={inputs.airdropCount}
                        onChange={(v) => updateInput("airdropCount", v)}
                        min={0}
                      />
                      <InputGroup
                        label="Distribution Fee (%)"
                        tooltip="Fee per airdrop/transfer (0–3%, to staking pool)"
                        id="airdropFee"
                        value={inputs.airdropFee}
                        onChange={(v) => updateInput("airdropFee", v)}
                        min={0}
                        max={3}
                        step={0.01}
                      />
                      <InputGroup
                        label="Distribution Volume (ETH)"
                        tooltip="Total airdrop/transfer volume"
                        id="airdropVolume"
                        value={inputs.airdropVolume}
                        onChange={(v) => updateInput("airdropVolume", v)}
                        min={0}
                        step={0.01}
                      />
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Storefront */}
                  <div>
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                      Storefront
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <InputGroup
                        label="NFT Sale Price (ETH)"
                        tooltip="Price per NFT sale"
                        id="nftSalePrice"
                        value={inputs.nftSalePrice}
                        onChange={(v) => updateInput("nftSalePrice", v)}
                        min={0}
                        step={0.01}
                      />
                      <InputGroup
                        label="Number of Sales"
                        tooltip="Total number of NFT sales"
                        id="nftSaleCount"
                        value={inputs.nftSaleCount}
                        onChange={(v) => updateInput("nftSaleCount", v)}
                        min={0}
                      />
                      <InputGroup
                        label="Payee Share (%)"
                        tooltip="Share to payees (0–99.6%, to staking pool)"
                        id="nftShareholderPercent"
                        value={inputs.nftShareholderPercent}
                        onChange={(v) =>
                          updateInput("nftShareholderPercent", v)
                        }
                        min={0}
                        max={99.6}
                        step={0.01}
                      />
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Adspace */}
                  <div>
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                      Adspace
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <InputGroup
                        label="Bid Amount (ETH)"
                        tooltip="Total bid amount per auction"
                        id="bidAmount"
                        value={inputs.bidAmount}
                        onChange={(v) => updateInput("bidAmount", v)}
                        min={0}
                        step={0.01}
                      />
                      <InputGroup
                        label="Bid Fee (%)"
                        tooltip="Fee to receivers (0–100%, to staking pool)"
                        id="bidFee"
                        value={inputs.bidFee}
                        onChange={(v) => updateInput("bidFee", v)}
                        min={0}
                        max={100}
                        step={0.01}
                      />
                      <InputGroup
                        label="Number of Auctions"
                        tooltip="Total number of ad auctions"
                        id="auctionCount"
                        value={inputs.auctionCount}
                        onChange={(v) => updateInput("auctionCount", v)}
                        min={0}
                      />
                      <InputGroup
                        label="Comment Fee (ETH)"
                        tooltip="Fee per comment (0.4% to recipients, 99.6% to bidder)"
                        id="signFeeEth"
                        value={inputs.signFeeEth}
                        onChange={(v) => updateInput("signFeeEth", v)}
                        min={0}
                        step={0.0001}
                      />
                      <InputGroup
                        label="Comments"
                        tooltip="Number of comments (pays comment fee)"
                        id="commentCount"
                        value={inputs.commentCount}
                        onChange={(v) => updateInput("commentCount", v)}
                        min={0}
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          </section>

          {/* ═══════════ SETTINGS ═══════════ */}
          <section id="settings" className="scroll-mt-28">
            <div className={`${card} p-5 sm:p-8`}>
              <CollapsibleSection
                id="settings"
                title="Settings"
                gradient="bg-gradient-to-r from-[#475569] to-[#64748B]"
                open={openSections.settings}
                onToggle={() => toggleSection("settings")}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                  <InputGroup
                    label="ETH Price (USD)"
                    tooltip="Fetched from Etherscan API"
                    id="ethPrice"
                    value={ethPrice.toFixed(2)}
                    onChange={() => {}}
                    readOnly
                  />
                  <InputGroup
                    label="Gas Price (Gwei)"
                    tooltip="Fetched from Etherscan API"
                    id="gasPrice"
                    value={gasPrice.toFixed(2)}
                    onChange={() => {}}
                    readOnly
                  />
                </div>
              </CollapsibleSection>
            </div>
          </section>

          {/* Buttons */}
          <div className="flex gap-3 justify-center">
            <button
              type="submit"
              disabled={loading}
              className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed relative`}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                  Calculating...
                </span>
              ) : (
                "Calculate"
              )}
            </button>
            <button type="button" onClick={handleReset} className={btnSecondary}>
              Reset
            </button>
          </div>

          {error && (
            <p className="text-center text-sm text-red-400/80">{error}</p>
          )}
        </form>

        {/* ═══════════ RESULTS ═══════════ */}
        {results && (
          <section id="results" className="space-y-8 scroll-mt-28">
            <SectionHeading sub="Your estimated annual dividend yield from staked MFTL tokens">
              Results
            </SectionHeading>

            {/* Result cards grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className={`${card} p-5 text-center`}>
                <p className="text-[10px] text-white/30 uppercase tracking-wider">
                  Total Annual Yield
                </p>
                <p className="text-lg font-bold text-amber-400 mt-2">
                  {results.totalYield.toFixed(4)} ETH
                </p>
                <p className="text-xs text-white/40 mt-1">
                  ${(results.totalYield * ethPrice).toFixed(2)}
                </p>
              </div>
              <div className={`${card} p-5 text-center`}>
                <p className="text-[10px] text-white/30 uppercase tracking-wider">
                  Annualized Yield
                </p>
                <p className="text-lg font-bold text-emerald-400 mt-2">
                  {results.yieldPercent.toFixed(2)}%
                </p>
              </div>
              <div className={`${card} p-5 text-center`}>
                <p className="text-[10px] text-white/30 uppercase tracking-wider">
                  Pool Share (% of Supply)
                </p>
                <p className="text-lg font-bold text-cyan-400 mt-2">
                  {results.poolShare.toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-teal-400/50 uppercase tracking-wider">
                  Multiswap
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.multiswapYield.toFixed(4)} ETH
                </p>
                <p className="text-xs text-white/30">
                  ${(results.multiswapYield * ethPrice).toFixed(2)}
                </p>
              </div>
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-emerald-400/50 uppercase tracking-wider">
                  Storefront
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.storefrontYield.toFixed(4)} ETH
                </p>
                <p className="text-xs text-white/30">
                  ${(results.storefrontYield * ethPrice).toFixed(2)}
                </p>
              </div>
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-amber-400/50 uppercase tracking-wider">
                  Adspace
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.adspaceYield.toFixed(4)} ETH
                </p>
                <p className="text-xs text-white/30">
                  ${(results.adspaceYield * ethPrice).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Deductions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-red-400/50 uppercase tracking-wider">
                  Staking Fee
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.stakingFee.toFixed(2)} MFTL
                </p>
              </div>
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-red-400/50 uppercase tracking-wider">
                  Penalty (if early)
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.penaltyMftl.toFixed(2)} MFTL
                </p>
              </div>
              <div className={`${card} p-5`}>
                <p className="text-[10px] text-red-400/50 uppercase tracking-wider">
                  Gas Cost
                </p>
                <p className="text-sm font-bold text-white/80 mt-1">
                  {results.gasCostEth.toFixed(4)} ETH
                </p>
                <p className="text-xs text-white/30">
                  ${results.gasCostUsd.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Breakeven */}
            <div className={`${card} p-5 text-center`}>
              <p className="text-[10px] text-white/30 uppercase tracking-wider">
                Breakeven Days
              </p>
              <p className="text-lg font-bold text-purple-400 mt-2">
                {results.breakevenDays.toFixed(2)} days
              </p>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`${card} p-5`} style={{ height: 320 }}>
                <canvas ref={pieChartRef} />
              </div>
              <div
                className={`${card} p-5 hidden sm:block`}
                style={{ height: 320 }}
              >
                <canvas ref={lineChartRef} />
              </div>
            </div>

            {/* View Inputs Toggle */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowInputsSummary(!showInputsSummary)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white/60 border border-white/[0.08] hover:bg-white/[0.04] transition-all cursor-pointer`}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${showInputsSummary ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
                View Inputs
              </button>
            </div>

            {showInputsSummary && (
              <div className={`${card} p-5 sm:p-8 space-y-6`}>
                <div>
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                    Staking Pool
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {([
                      ["Stake Amount", `${inputs.stakeAmount} Tokens`],
                      ["Total Pool Staked", `${inputs.totalPoolStaked} Tokens`],
                      ["Total Supply", `${inputs.totalSupply} Tokens`],
                      ["Token Price", `${inputs.tokenPrice} ETH`],
                      ["Hard Lock", `${inputs.hardLockDuration} Days`],
                      ["Initial Penalty", `${inputs.initialPenaltyPercent}%`],
                      ["Penalty Decay", `${inputs.penaltyDecayPercent}%/Day`],
                      ["Withdrawal Day", `${inputs.withdrawalDay}`],
                    ] as const).map(([label, value]) => (
                      <div
                        key={label}
                        className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      >
                        <span className="text-white/30 block text-[10px]">
                          {label}
                        </span>
                        <span className="text-white/70 font-semibold">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                    Multiswap
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {([
                      [
                        "Profit Sources",
                        inputs.profitSources === 1
                          ? "1/3"
                          : inputs.profitSources === 2
                            ? "2/3"
                            : "3/3",
                      ],
                      ["Swaps", `${inputs.swapCount}`],
                      ["Swap Fee", `${inputs.swapFee}%`],
                      ["Swap Volume", `${inputs.swapVolume} ETH`],
                      ["Distributions", `${inputs.airdropCount}`],
                      ["Distribution Fee", `${inputs.airdropFee}%`],
                      ["Distribution Volume", `${inputs.airdropVolume} ETH`],
                    ] as const).map(([label, value]) => (
                      <div
                        key={label}
                        className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      >
                        <span className="text-white/30 block text-[10px]">
                          {label}
                        </span>
                        <span className="text-white/70 font-semibold">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                    Storefront
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {([
                      ["NFT Sale Price", `${inputs.nftSalePrice} ETH`],
                      ["Number of Sales", `${inputs.nftSaleCount}`],
                      ["Payee Share", `${inputs.nftShareholderPercent}%`],
                    ] as const).map(([label, value]) => (
                      <div
                        key={label}
                        className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      >
                        <span className="text-white/30 block text-[10px]">
                          {label}
                        </span>
                        <span className="text-white/70 font-semibold">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                    Adspace
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {([
                      ["Bid Amount", `${inputs.bidAmount} ETH`],
                      ["Bid Fee", `${inputs.bidFee}%`],
                      ["Auctions", `${inputs.auctionCount}`],
                      ["Comment Fee", `${inputs.signFeeEth} ETH`],
                      ["Comments", `${inputs.commentCount}`],
                    ] as const).map(([label, value]) => (
                      <div
                        key={label}
                        className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      >
                        <span className="text-white/30 block text-[10px]">
                          {label}
                        </span>
                        <span className="text-white/70 font-semibold">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="h-px bg-white/[0.06]" />
                <div>
                  <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">
                    Settings
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-white/30 block text-[10px]">
                        ETH Price
                      </span>
                      <span className="text-white/70 font-semibold">
                        ${ethPrice.toFixed(2)}
                      </span>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-white/30 block text-[10px]">
                        Gas Price
                      </span>
                      <span className="text-white/70 font-semibold">
                        {gasPrice.toFixed(2)} Gwei
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ═══════════ INFO ═══════════ */}
        <section id="info" className="space-y-6 scroll-mt-28">
          <SectionHeading sub="How calculations are performed">
            How It Works
          </SectionHeading>

          <div className={`${card} p-5 sm:p-8`}>
            <CollapsibleSection
              id="info"
              title="Calculation Details"
              gradient="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6]"
              open={openSections.info}
              onToggle={() => toggleSection("info")}
            >
              <div className="space-y-6 pt-4 text-xs text-white/50 leading-relaxed">
                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Overview
                  </h3>
                  <p>
                    Estimates your annual dividend yield from staked MFTL
                    tokens in the StakingPool, based on fees deposited from
                    Multiswap, Storefront, and Adspace contracts.
                  </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Stake Share
                  </h3>
                  <p>
                    Your staked tokens / total pool staked, determining your
                    share of dividends.
                  </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Pool Share
                  </h3>
                  <p className="font-mono text-white/40 mb-1">
                    (Total Pool Staked / Total Token Supply) x 100
                  </p>
                  <p>
                    Percentage of total token supply staked in the pool.
                  </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Dividends
                  </h3>
                  <div className="space-y-4 pl-4">
                    <div>
                      <h4 className="text-xs font-semibold text-teal-400/70 mb-1">
                        Multiswap
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        (Swap Fee + Airdrop Fee) x Stake Share
                      </p>
                      <p>
                        Your share of fees (0–3%) from swaps and
                        distributions sent to custom fee receivers, assumed
                        to include the staking pool.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-emerald-400/70 mb-1">
                        Storefront
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        NFT Sale Price x Number of Sales x Payee Share % x
                        Stake Share
                      </p>
                      <p>
                        Your share of payee profits (0–99.6%) from NFT
                        sales sent to payees, assumed to include the
                        staking pool.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-amber-400/70 mb-1">
                        Adspace
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        Bid Amount x Auction Count x Bid Fee % x Stake
                        Share
                      </p>
                      <p>
                        Your share of non-refunded bid fees (0–100%) from
                        ad auctions sent to fee receivers, assumed to
                        include the staking pool.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <h4 className="text-xs font-semibold text-white/60 mb-1">
                      Total Annual Yield
                    </h4>
                    <p className="font-mono text-white/40 mb-1">
                      Multiswap + Storefront + Adspace - (Penalty x Token
                      Price)
                    </p>
                  </div>
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-white/60 mb-1">
                      Annualized Yield %
                    </h4>
                    <p className="font-mono text-white/40 mb-1">
                      (Total Yield / (Stake Amount x Token Price)) x 100
                    </p>
                  </div>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Deductions
                  </h3>
                  <div className="space-y-4 pl-4">
                    <div>
                      <h4 className="text-xs font-semibold text-red-400/70 mb-1">
                        Staking Fee
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        Stake Amount x 0.005
                      </p>
                      <p>
                        0.5% fee in MFTL tokens on staking, unstaking, or
                        claiming rewards, sent to a hardcoded recipient.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-red-400/70 mb-1">
                        Penalty
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        If day &lt; hardLock: Stake x (initPenalty% / 100)
                      </p>
                      <p className="font-mono text-white/40 mb-1">
                        If day &ge; hardLock: Stake x max(0, initPenalty -
                        (daysAfterLock x decay))
                      </p>
                      <p>
                        Penalty in MFTL tokens for early unstaking,
                        decreasing after hard lock duration until reaching
                        0%.
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-red-400/70 mb-1">
                        Gas Cost
                      </h4>
                      <p className="font-mono text-white/40 mb-1">
                        Total Gas Units x Gas Price x 10^-9
                      </p>
                      <p>
                        Gas units: Stake (80k), Withdraw (60k), Swap
                        (120k/ea), Airdrop (100k/ea), NFT Sale (150k/ea),
                        Bid (70k/ea), Comment (50k/ea), Launch (1M).
                      </p>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-red-400/70 mb-1">
                        Adspace Comment Fee
                      </h4>
                      <p>
                        Configurable ETH amount per comment, with 0.4%
                        sent to hardcoded recipients and 99.6% to the
                        current bidder (not a dividend).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-white/[0.06]" />

                <div>
                  <h3 className="text-sm font-bold text-white/70 mb-2">
                    Breakeven Days
                  </h3>
                  <p className="font-mono text-white/40 mb-1">
                    Hard Lock Duration + (Initial Penalty % / Penalty Decay
                    %)
                  </p>
                  <p>
                    Number of days until the penalty reaches 0%.
                  </p>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        </section>

      </div>
    </div>
  );
}
