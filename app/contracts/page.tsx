"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Copy, Check, ExternalLink, ArrowRight } from "lucide-react";

interface Contract {
  name: string;
  address: string;
  explorer: string;
  go: string;
  internal?: boolean;
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
    address: "0x6B440ADBA6085b68e2677Ce77dC65bbAc39005d8",
    explorer:
      "https://etherscan.io/address/0x6B440ADBA6085b68e2677Ce77dC65bbAc39005d8",
    go: "/etf",
    internal: true,
  },
  {
    name: "Dividends Launcher",
    address: "0x5ef0404f344e9c0ff2ab83b44d8827a78db7128a",
    explorer:
      "https://etherscan.io/address/0x5ef0404f344e9c0ff2ab83b44d8827a78db7128a",
    go: "/dividends",
    internal: true,
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
    address: "0xc346ecabc9d5c6fb943231c4b9d73ca91178545a",
    explorer:
      "https://etherscan.io/address/0xc346ecabc9d5c6fb943231c4b9d73ca91178545a",
    go: "/dao",
    internal: true,
  },
  {
    name: "Multiswap Launcher",
    address: "0x40af76d95100372232a9fe2ddd92de7e103eb2db",
    explorer:
      "https://etherscan.io/address/0x40af76d95100372232a9fe2ddd92de7e103eb2db",
    go: "/multiswap",
    internal: true,
  },
  {
    name: "Ad-space Launcher",
    address: "0xE01FE1C2A22736da756BDc2C9144464E8A73fCd7",
    explorer:
      "https://etherscan.io/address/0xE01FE1C2A22736da756BDc2C9144464E8A73fCd7",
    go: "/auction",
    internal: true,
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
    address: "0x15a3c66121b927f38bffef5d8017370aaf46ab68",
    explorer:
      "https://etherscan.io/address/0x15a3c66121b927f38bffef5d8017370aaf46ab68",
    go: "/storefront",
    internal: true,
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
    internal: true,
  },
  {
    name: "MoneyFund Dividends",
    address: "0xab18bbaf4e7e04a120d031129a47e27be04b86bf",
    explorer:
      "https://etherscan.io/address/0xab18bbaf4e7e04a120d031129a47e27be04b86bf",
    go: "/moneydividends",
    internal: true,
  },
  {
    name: "MoneyFund Airdropper",
    address: "0x6785cd86a65f3d8336fdc3b0e54c78215501dca2",
    explorer:
      "https://etherscan.io/address/0x6785cd86a65f3d8336fdc3b0e54c78215501dca2",
    go: "/airdrop",
    internal: true,
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
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all shrink-0 cursor-pointer ${
        copied
          ? "bg-gold/20 text-gold"
          : "bg-brand-800/80 text-brand-400 hover:bg-brand-700/80 hover:text-brand-200"
      }`}
      title={copied ? "Copied!" : "Copy address"}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function GoLink({ c }: { c: Contract }) {
  const cls =
    "inline-flex items-center justify-center w-7 h-7 rounded-md bg-gold/15 text-gold hover:bg-gold/25 transition-colors shrink-0";
  return c.internal ? (
    <Link href={c.go} className={cls} title="Open app">
      <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  ) : (
    <a href={c.go} target="_blank" rel="noopener noreferrer" className={cls} title="Open app">
      <ArrowRight className="w-3.5 h-3.5" />
    </a>
  );
}

export default function ContractsPage() {
  return (
    <div className="min-h-screen bg-brand-950 px-4 py-10 sm:px-6 sm:py-14">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-brand-100">
            Money<span className="text-gold">Fund</span> Contracts
          </h1>
          <p className="text-xs text-brand-500 mt-1.5">
            On-chain addresses and explorer links
          </p>
          <div className="mx-auto mt-3 w-12 h-px bg-gold/30" />
        </div>

        <div className="rounded-2xl border border-brand-800/60 bg-brand-950 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-brand-800/60">
                  <th className="px-4 py-2.5 text-[10px] uppercase font-semibold tracking-[0.15em] text-brand-500">
                    Contract
                  </th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-semibold tracking-[0.15em] text-brand-500">
                    Address
                  </th>
                  <th className="px-4 py-2.5 text-[10px] uppercase font-semibold tracking-[0.15em] text-brand-500 text-right">
                    Links
                  </th>
                </tr>
              </thead>
              <tbody>
                {CONTRACTS.map((c) => (
                  <tr
                    key={c.address}
                    className="border-b border-brand-800/40 last:border-b-0 hover:bg-brand-800/20 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-brand-200 whitespace-nowrap">
                      {c.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] text-brand-400 whitespace-nowrap">
                        {c.address}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <CopyButton text={c.address} />
                        <a
                          href={c.explorer}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-800/80 text-brand-400 hover:bg-brand-700/80 hover:text-brand-200 transition-colors shrink-0"
                          title="View on explorer"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <GoLink c={c} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="sm:hidden divide-y divide-brand-800/40">
            {CONTRACTS.map((c) => (
              <div
                key={c.address}
                className="px-4 py-3 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-brand-200 mb-1">
                    {c.name}
                  </div>
                  <div className="overflow-x-auto scrollbar-none">
                    <span className="font-mono text-[11px] text-brand-500 whitespace-nowrap">
                      {c.address}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <CopyButton text={c.address} />
                  <a
                    href={c.explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-brand-800/80 text-brand-400 hover:bg-brand-700/80 hover:text-brand-200 transition-colors"
                    title="View on explorer"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <GoLink c={c} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Simulate Dividends CTA */}
        <div className="mt-6 rounded-2xl border border-brand-800/60 bg-brand-950 px-6 py-6 text-center">
          <p className="text-lg sm:text-xl font-bold text-brand-100 mb-1">
            Simulate Dividends
          </p>
          <p className="text-xs text-brand-500 mb-4">
            See how staking rewards work before you commit
          </p>
          <a
            href="https://moneyfund.com/try"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-gold/15 text-gold font-semibold text-sm px-6 py-2.5 rounded-lg border border-gold/25 hover:bg-gold/25 transition-all"
          >
            Try It Now
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
