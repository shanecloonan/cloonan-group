"use client";

import { useState, useCallback } from "react";
import { Copy, Check, ExternalLink, Play } from "lucide-react";

interface Contract {
  name: string;
  address: string;
  explorer: string;
  go: string;
  solana?: boolean;
}

const CONTRACTS: Contract[] = [
  {
    name: "Arweave",
    address: "eS5YbYQhuDOjDttzgM2YP7_26q37k_Me5czIoMwVlfw",
    explorer:
      "https://viewblock.io/arweave/address/eS5YbYQhuDOjDttzgM2YP7_26q37k_Me5czIoMwVlfw",
    go: "https://moneyfund.com",
  },
  {
    name: "MONEY",
    address: "0x100DB67F41A2dF3c32cC7c0955694b98339B7311",
    explorer:
      "https://etherscan.io/address/0x100DB67F41A2dF3c32cC7c0955694b98339B7311",
    go: "https://moneyfund.com/money",
  },
  {
    name: "Fund Launcher",
    address: "0x6b440adba6085b68e2677ce77dc65bbac39005d8",
    explorer:
      "https://etherscan.io/address/0x6b440adba6085b68e2677ce77dc65bbac39005d8",
    go: "/etf",
  },
  {
    name: "Dividends Launcher",
    address: "0xdf1ec23286333da4cc9d320369153c9bad1605f9",
    explorer:
      "https://etherscan.io/address/0xdf1ec23286333da4cc9d320369153c9bad1605f9",
    go: "/dividends",
  },
  {
    name: "Coin Launcher",
    address: "0x059490a29e7059f30bac2350a46f9d49ff3800b5",
    explorer:
      "https://etherscan.io/address/0x059490a29e7059f30bac2350a46f9d49ff3800b5",
    go: "https://moneyfund.com/deploy",
  },
  {
    name: "DAO Launcher",
    address: "0x8ef4bc69750da8f59335da8083a00ef6ea864f9f",
    explorer:
      "https://etherscan.io/address/0x8ef4bc69750da8f59335da8083a00ef6ea864f9f",
    go: "/dao",
  },
  {
    name: "Multiswap Launcher",
    address: "0xe01fe1c2a22736da756bdc2c9144464e8a73fcd7",
    explorer:
      "https://etherscan.io/address/0xe01fe1c2a22736da756bdc2c9144464e8a73fcd7",
    go: "/multiswap",
  },
  {
    name: "Ad-space Launcher",
    address: "0x346a4f3bb3582396eb62624d25c03568ceb8c94c",
    explorer:
      "https://etherscan.io/address/0x346a4f3bb3582396eb62624d25c03568ceb8c94c",
    go: "/auction",
  },
  {
    name: "Multisig Launcher",
    address: "0x9eb611624425239ac6f41e3a55c8f1cce8bde32d",
    explorer:
      "https://etherscan.io/address/0x9eb611624425239ac6f41e3a55c8f1cce8bde32d",
    go: "https://moneyfund.com/multisig",
  },
  {
    name: "Storefront Launcher",
    address: "0x20c855f8cf408ee3a481409993e4d3ce04c2e509",
    explorer:
      "https://etherscan.io/address/0x20c855f8cf408ee3a481409993e4d3ce04c2e509",
    go: "/storefront",
  },
  {
    name: "MoneyFund Multiswap",
    address: "0xDfEa3460341A5D3e8B034607dd60D10bcEE4cFc9",
    explorer:
      "https://etherscan.io/address/0xDfEa3460341A5D3e8B034607dd60D10bcEE4cFc9",
    go: "https://moneyfund.com/moneyswap",
  },
  {
    name: "MoneyFund DAO",
    address: "0x8cf5e3797aabb62698f9c4a3f0234667fd981754",
    explorer:
      "https://etherscan.io/address/0x8cf5e3797aabb62698f9c4a3f0234667fd981754",
    go: "https://moneyfund.com/vote",
  },
  {
    name: "MoneyFund DEX",
    address: "0xc79c7dbf7ac78fd5307a4631131b0a4e98e902c7",
    explorer:
      "https://etherscan.io/address/0xc79c7dbf7ac78fd5307a4631131b0a4e98e902c7",
    go: "/dex",
  },
  {
    name: "MoneyFund Dividends",
    address: "0xab18bbaf4e7e04a120d031129a47e27be04b86bf",
    explorer:
      "https://etherscan.io/address/0xab18bbaf4e7e04a120d031129a47e27be04b86bf",
    go: "/moneydividends",
  },
  {
    name: "MoneyFund Airdropper",
    address: "0x6785cd86a65f3d8336fdc3b0e54c78215501dca2",
    explorer:
      "https://etherscan.io/address/0x6785cd86a65f3d8336fdc3b0e54c78215501dca2",
    go: "/airdrop",
  },
  {
    name: "Solana Wormhole",
    address: "Hi3w7Niu46dxwk8not3LihcFT4Aa4yMvLSGECykE9iEp",
    explorer:
      "https://solscan.io/account/Hi3w7Niu46dxwk8not3LihcFT4Aa4yMvLSGECykE9iEp",
    go: "https://moneyfund.com/solanawormhole",
    solana: true,
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all ${
        copied
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
      }`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function ContractsPage() {
  return (
    <div
      className="min-h-screen px-4 py-12 sm:px-6 sm:py-16"
      style={{ background: "linear-gradient(135deg, #1a0d2e 0%, #0f0a1e 100%)" }}
    >
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white mb-2">
            Money<span className="text-emerald-400">Fund</span> Contracts
          </h1>
          <p className="text-sm text-slate-400">
            On-chain contract addresses and explorer links.
          </p>
        </div>

        {/* Table card */}
        <div className="relative rounded-2xl overflow-hidden">
          {/* Animated border glow */}
          <div
            className="absolute -inset-[2px] rounded-2xl z-0"
            style={{
              background: "linear-gradient(45deg, #6aa174, #8bbf91, #6aa174)",
              animation: "glow 4s ease-in-out infinite",
            }}
          />
          <div className="relative z-10 bg-[#0A0C1E] rounded-2xl p-3 sm:p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="px-3 sm:px-4 py-3 text-[11px] sm:text-xs uppercase font-semibold tracking-wider text-white bg-gradient-to-r from-slate-600 to-slate-500 rounded-l-lg">
                      Contract
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-[11px] sm:text-xs uppercase font-semibold tracking-wider text-white bg-gradient-to-r from-slate-500 to-slate-600">
                      Address
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-[11px] sm:text-xs uppercase font-semibold tracking-wider text-white bg-gradient-to-r from-slate-600 to-slate-500 rounded-r-lg text-center">
                      Go
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACTS.map((c) => (
                    <tr
                      key={c.address}
                      className="border-b border-emerald-400/10 hover:bg-emerald-400/[0.06] transition-colors"
                    >
                      <td className="px-3 sm:px-4 py-3 text-sm font-semibold text-white whitespace-nowrap">
                        {c.name}
                      </td>
                      <td className="px-3 sm:px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CopyButton text={c.address} />
                          <span
                            className={`font-mono text-white break-all ${c.solana ? "text-[11px]" : "text-xs"}`}
                          >
                            {c.address}
                          </span>
                          <a
                            href={c.explorer}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-center">
                        <a
                          href={c.go}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 text-white hover:from-violet-500 hover:to-purple-400 transition-all hover:-translate-y-0.5 shadow-lg shadow-violet-500/25"
                        >
                          <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="white" />
                        </a>
                      </td>
                    </tr>
                  ))}

                  {/* Simulate Dividends row */}
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-center"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(106,161,116,0.12), rgba(139,191,145,0.08))",
                      }}
                    >
                      <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-white to-emerald-300 bg-clip-text text-transparent mb-5">
                        Simulate Dividends
                      </div>
                      <a
                        href="https://moneyfund.com/try"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2.5 bg-gradient-to-r from-violet-600 to-purple-500 text-white font-semibold text-sm sm:text-base px-8 py-3.5 rounded-xl shadow-[0_8px_20px_rgba(107,70,193,0.4)] hover:shadow-[0_12px_30px_rgba(107,70,193,0.6)] hover:from-violet-500 hover:to-purple-400 hover:-translate-y-1 transition-all"
                      >
                        <svg
                          className="w-5 h-5"
                          viewBox="0 0 24 24"
                          fill="white"
                        >
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        </svg>
                        Try It Now
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes glow {
          0%,
          100% {
            opacity: 0.5;
          }
          50% {
            opacity: 0.85;
          }
        }
      `}</style>
    </div>
  );
}
