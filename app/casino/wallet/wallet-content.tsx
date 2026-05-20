"use client";

/* ===========================================================================
 *  /casino/wallet — deposit / withdraw / audit
 *  ---------------------------------------------------------------------------
 *  Single page that surfaces the full on-chain deposit / withdraw flow
 *  against `CasinoVault.sol`. Three tabs:
 *
 *    • Deposit   — pick chain + token + amount → approve + deposit (2-tx) →
 *                  poll for confirmation → ledger credit
 *    • Withdraw  — pick chain + token + amount → request EIP-712 voucher
 *                  from `/api/casino/withdraw-authorize` → submit withdraw
 *                  tx → poll for confirmation
 *    • History   — list of deposit/withdraw txs (localStorage), with
 *                  explorer links
 *
 *  Dev fallback: when no vault address is configured for the selected
 *  chain (env var unset), the UI shows a clear configuration banner and
 *  blocks the on-chain submit buttons. The dev-mock chain is fully
 *  functional and lets you exercise the UX end-to-end against the
 *  in-memory ledger.
 *
 *  The user's wallet comes from `useWallet` (`lib/wallet-context.tsx`) —
 *  same wallet they use everywhere else in MoneyFund. We accept either a
 *  MoneyFund vault wallet (custodial) or a MetaMask wallet.
 * ========================================================================= */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CasinoShell } from "../casino-shell";
import { supabase } from "@/lib/supabase";
import { useWallet } from "@/lib/wallet-context";
import {
  CHAIN_ADAPTERS,
  ETH_NATIVE,
  USDC_BASE,
  USDC_ETHEREUM_MAINNET,
  ensureCasinoUserRow,
  isAdapterReady,
  makeRealEthereumAdapter,
  type ChainId,
  type TokenSpec,
} from "@/lib/casino";

/* ---------------------------------------------------------------------------
 *  Style vocab
 * ------------------------------------------------------------------------- */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const labelCls =
  "block text-white/40 text-[10px] font-medium uppercase tracking-[0.15em] mb-1.5";
const inputCls =
  "w-full h-10 px-3 rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/30 transition-all";
const btnPrimary =
  "h-11 px-6 rounded-lg font-semibold text-sm bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnGhost =
  "h-10 px-4 rounded-lg font-medium text-sm bg-white/[0.06] border border-white/[0.08] text-white/80 hover:bg-white/[0.10] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";

/* ---------------------------------------------------------------------------
 *  Chain catalog (UI side — what the user can pick)
 * ------------------------------------------------------------------------- */

type EvmChainKind =
  | "ethereum-mainnet"
  | "ethereum-base"
  | "ethereum-arbitrum"
  | "ethereum-sepolia";

const CHAIN_CATALOG: { id: ChainId; display: string; kind: "dev" | "evm"; tokens: TokenSpec[] }[] = [
  { id: "dev-mock", display: "Dev (play money)", kind: "dev", tokens: [CHAIN_ADAPTERS["dev-mock"].supportedTokens[0]] },
  { id: "ethereum-base", display: "Base", kind: "evm", tokens: [USDC_BASE, ETH_NATIVE] },
  { id: "ethereum-mainnet", display: "Ethereum mainnet", kind: "evm", tokens: [USDC_ETHEREUM_MAINNET, ETH_NATIVE] },
  { id: "ethereum-arbitrum", display: "Arbitrum One", kind: "evm", tokens: [ETH_NATIVE] },
  { id: "ethereum-sepolia", display: "Sepolia testnet", kind: "evm", tokens: [ETH_NATIVE] },
];

/* ---------------------------------------------------------------------------
 *  Money helpers
 * ------------------------------------------------------------------------- */

function unitsToHuman(units: bigint, token: TokenSpec): number {
  const denom = 10n ** BigInt(token.decimals);
  const whole = units / denom;
  const frac = units % denom;
  return Number(`${whole}.${frac.toString().padStart(token.decimals, "0")}`);
}

function humanToUnits(amount: number, token: TokenSpec): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const denom = 10n ** BigInt(token.decimals);
  const whole = BigInt(Math.floor(amount));
  const frac = BigInt(Math.round((amount - Math.floor(amount)) * Number(denom)));
  return whole * denom + frac;
}

function fmtMoney(units: bigint, token: TokenSpec, digits = 4): string {
  return `${unitsToHuman(units, token).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })} ${token.symbol}`;
}

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/* ---------------------------------------------------------------------------
 *  History (localStorage)
 * ------------------------------------------------------------------------- */

interface WalletHistoryEntry {
  at: string;
  kind: "deposit" | "withdraw";
  chainId: ChainId;
  tokenSymbol: string;
  tokenDecimals: number;
  amountUnits: string;
  txHash: string;
  approveTxHash?: string;
  status: "submitted" | "confirming" | "finalized" | "failed";
  /** Explorer URL for `txHash`. */
  txUrl: string;
}

const WALLET_HISTORY_KEY = "mf_casino_wallet_history_v1";

function loadHistory(): WalletHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WALLET_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WalletHistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(history: WalletHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLET_HISTORY_KEY, JSON.stringify(history.slice(0, 200)));
  } catch {
    // quota / disabled — non-fatal
  }
}

/* ===========================================================================
 *  Page
 * ========================================================================= */

export default function WalletContent() {
  const wallet = useWallet();

  /* ----- Selected chain + token ----- */

  const [chainId, setChainId] = useState<ChainId>("dev-mock");
  const chainEntry = useMemo(
    () => CHAIN_CATALOG.find((c) => c.id === chainId)!,
    [chainId],
  );
  const [token, setToken] = useState<TokenSpec>(chainEntry.tokens[0]);

  // Reset selected token when chain changes.
  useEffect(() => {
    setToken(chainEntry.tokens[0]);
  }, [chainEntry]);

  /* ----- Real EVM adapter (when picked) ----- */

  const adapter = useMemo(() => {
    if (chainEntry.kind !== "evm") return null;
    return makeRealEthereumAdapter(chainEntry.id as EvmChainKind);
  }, [chainEntry]);

  const adapterReady = !!adapter && isAdapterReady(adapter);

  /* ----- User address ----- */

  const userAddress = wallet.selectedEthAddress;

  /* ----- Tabs ----- */

  const [tab, setTab] = useState<"deposit" | "withdraw" | "history">("deposit");

  /* ----- History ----- */

  const [history, setHistory] = useState<WalletHistoryEntry[]>([]);
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const recordEntry = useCallback((e: WalletHistoryEntry) => {
    setHistory((prev) => {
      const next = [e, ...prev].slice(0, 200);
      saveHistory(next);
      return next;
    });
  }, []);

  const updateEntry = useCallback((txHash: string, patch: Partial<WalletHistoryEntry>) => {
    setHistory((prev) => {
      const next = prev.map((e) => (e.txHash === txHash ? { ...e, ...patch } : e));
      saveHistory(next);
      return next;
    });
  }, []);

  /* =================== render =================== */

  return (
    <CasinoShell
      badge="On-chain vault"
      title="Wallet"
      subtitle="Deposit and withdraw against CasinoVault.sol — EIP-712 withdrawals, explorer-linked history."
    >
      <div className="space-y-6">
        {/* ───── Cloud sync banner ───── */}
        <CloudSyncBanner signedIn={!!wallet.user} />
        <VaultDeployBanner chainId={chainId} adapterReady={adapterReady} />
        <VaultDeploymentPanel />

        {/* ───── Top status row ───── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <StatusCard
            label="Connected wallet"
            value={shortAddr(userAddress)}
            sub={wallet.user ? wallet.user.email ?? "logged in" : "not signed in"}
            ok={!!userAddress}
          />
          <StatusCard
            label="Selected chain"
            value={chainEntry.display}
            sub={
              chainEntry.kind === "dev"
                ? "in-memory, instant"
                : adapter
                  ? `chain id ${adapter.evmChainId}`
                  : "—"
            }
            ok={true}
          />
          <StatusCard
            label="Vault contract"
            value={
              chainEntry.kind === "dev"
                ? "dev-mock"
                : adapterReady
                  ? shortAddr(adapter!.getVaultAddress())
                  : "not configured"
            }
            sub={
              chainEntry.kind === "dev"
                ? "no on-chain contract"
                : adapterReady
                  ? `${adapter!.requiredConfirmations} conf required`
                  : `Set NEXT_PUBLIC_CASINO_VAULT_${chainId.toUpperCase().replaceAll("-", "_")}`
            }
            ok={chainEntry.kind === "dev" || adapterReady}
          />
        </section>

        {/* ───── Chain + token selector ───── */}
        <section className={card + " p-5"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Chain</label>
              <select
                className={inputCls}
                value={chainId}
                onChange={(e) => setChainId(e.target.value as ChainId)}
              >
                {CHAIN_CATALOG.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Token</label>
              <select
                className={inputCls}
                value={token.address}
                onChange={(e) => {
                  const found = chainEntry.tokens.find(
                    (t) => t.address === e.target.value,
                  );
                  if (found) setToken(found);
                }}
              >
                {chainEntry.tokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol} — {t.display}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!adapterReady && chainEntry.kind === "evm" && (
            <NotConfiguredBanner chainId={chainId} />
          )}

          {token.isNative && chainEntry.kind === "evm" && (
            <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-400/20 text-[12px] text-amber-200">
              <strong>Native ETH path</strong> requires WETH wrapping (not yet
              implemented in CasinoVault v1). Select an ERC-20 token like USDC
              to test the live deposit flow.
            </div>
          )}
        </section>

        {/* ───── Tabs ───── */}
        <section className="flex items-center gap-2 border-b border-white/[0.06]">
          {(["deposit", "withdraw", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " +
                (tab === t
                  ? "border-emerald-400 text-white"
                  : "border-transparent text-white/50 hover:text-white/80")
              }
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "history" && history.length > 0 && (
                <span className="ml-2 text-[10px] text-white/40">
                  ({history.length})
                </span>
              )}
            </button>
          ))}
        </section>

        {/* ───── Tab body ───── */}
        {tab === "deposit" && (
          <DepositPanel
            wallet={wallet}
            chainId={chainId}
            chainKind={chainEntry.kind}
            adapter={adapter}
            adapterReady={adapterReady}
            token={token}
            userAddress={userAddress}
            onRecord={recordEntry}
            onUpdate={updateEntry}
          />
        )}
        {tab === "withdraw" && (
          <WithdrawPanel
            wallet={wallet}
            chainId={chainId}
            chainKind={chainEntry.kind}
            adapter={adapter}
            adapterReady={adapterReady}
            token={token}
            userAddress={userAddress}
            onRecord={recordEntry}
            onUpdate={updateEntry}
          />
        )}
        {tab === "history" && (
          <HistoryPanel history={history} adapter={adapter} />
        )}
      </div>
    </CasinoShell>
  );
}

/* ===========================================================================
 *  Status cards
 * ========================================================================= */

function StatusCard({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub?: string;
  ok: boolean;
}) {
  return (
    <div className={card + " p-4"}>
      <div className="text-[10px] uppercase tracking-[0.15em] text-white/40 mb-1">
        {label}
      </div>
      <div className="font-mono text-lg text-white/90 truncate">{value}</div>
      {sub && (
        <div className={"text-[11px] mt-0.5 " + (ok ? "text-white/40" : "text-amber-300")}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * Tells the user whether their post-deposit casino balance will land in
 * Supabase or stay in their browser. The contract:
 *   • Signed in → on-chain deposit → POST /api/casino/deposit-credit → balance
 *     follows them across devices, persisted in `casino_balances`.
 *   • Not signed in → on-chain deposit lands in the vault, but the casino
 *     can't credit it to a player ledger until they sign in (since the
 *     ledger is keyed by auth.users.id).
 */
type VaultStatusResponse = {
  anyDeployed: boolean;
  operatorConfigured: boolean;
  operatorWebhookConfigured: boolean;
  serviceRoleConfigured: boolean;
  chains: {
    chainId: string;
    display: string;
    ready: boolean;
    vaultAddress: string | null;
    rpcConfigured: boolean;
  }[];
};

function VaultDeploymentPanel() {
  const [status, setStatus] = useState<VaultStatusResponse | null>(null);

  useEffect(() => {
    fetch("/api/casino/vault-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  return (
    <section className={card + " p-5"}>
      <h2 className="text-lg font-semibold text-white mb-1">Vault deployment status</h2>
      <p className="text-xs text-white/45 mb-4">
        On-chain chains need <code className="text-emerald-300/90">NEXT_PUBLIC_CASINO_VAULT_*</code> and RPC env vars.
        Operator key enables EIP-712 withdrawals.
      </p>
      <ul className="space-y-2">
        {status.chains.map((c) => (
          <li
            key={c.chainId}
            className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm"
          >
            <span className="font-medium text-white/85">{c.display}</span>
            <span className="flex flex-wrap gap-2 text-[11px]">
              <span
                className={
                  "px-2 py-0.5 rounded-full border " +
                  (c.ready
                    ? "border-emerald-400/35 text-emerald-200 bg-emerald-500/10"
                    : "border-white/10 text-white/40")
                }
              >
                {c.ready ? "vault set" : "vault unset"}
              </span>
              <span
                className={
                  "px-2 py-0.5 rounded-full border " +
                  (c.rpcConfigured
                    ? "border-emerald-400/35 text-emerald-200 bg-emerald-500/10"
                    : "border-amber-400/30 text-amber-200/90 bg-amber-500/10")
                }
              >
                {c.rpcConfigured ? "RPC ok" : "RPC missing"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-white/45">
        <span>Operator key: {status.operatorConfigured ? "✓" : "✗"}</span>
        <span>Webhook secret: {status.operatorWebhookConfigured ? "✓" : "✗"}</span>
        <span>Service role: {status.serviceRoleConfigured ? "✓" : "✗"}</span>
      </div>
      {!status.anyDeployed && (
        <p className="mt-3 text-xs text-amber-200/80">
          Deploy with <code className="text-amber-300">scripts/deploy-casino-vault.ps1</code> then set env vars.
        </p>
      )}
      <Link href="/casino/docs#crypto" className="inline-block mt-3 text-xs text-amber-300 hover:underline">
        Deployment guide →
      </Link>
    </section>
  );
}

function VaultDeployBanner({
  chainId,
  adapterReady,
}: {
  chainId: ChainId;
  adapterReady: boolean;
}) {
  const [status, setStatus] = useState<VaultStatusResponse | null>(null);

  useEffect(() => {
    fetch("/api/casino/vault-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (chainId === "dev-mock" || adapterReady) return null;
  const row = status?.chains.find((c) => c.chainId === chainId);

  return (
    <div className="p-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] text-sm text-amber-100/90">
      <strong className="text-amber-200">Vault not live on this chain yet.</strong>{" "}
      {row
        ? `Deploy CasinoVault.sol and set NEXT_PUBLIC_CASINO_VAULT_${chainId.toUpperCase().replaceAll("-", "_")}.`
        : "Check /api/casino/vault-status or use Dev play money on the lobby."}{" "}
      {status && !status.anyDeployed && (
        <span className="block mt-1 text-xs text-white/50">
          No chain has a vault address in env — CI builds the contract; deployment is the next step.
        </span>
      )}
      <Link href="/casino/docs#crypto" className="block mt-2 text-xs text-amber-300 hover:underline">
        Deployment guide →
      </Link>
    </div>
  );
}

function CloudSyncBanner({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/25 flex items-start gap-3">
        <span className="mt-0.5 text-emerald-300">☁</span>
        <div className="text-[12px] text-emerald-100/90 leading-relaxed">
          <strong className="text-emerald-200">Cloud-synced.</strong>{" "}
          Deposits and withdrawals reconcile against your Supabase casino
          balance. Game seeds, sessions, and bankroll roam with your
          account across devices.
        </div>
      </div>
    );
  }
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/25 flex items-start gap-3">
      <span className="mt-0.5 text-amber-300">⚡</span>
      <div className="text-[12px] text-amber-100/90 leading-relaxed">
        <strong className="text-amber-200">Local-only mode.</strong>{" "}
        You're not signed in. On-chain deposits will reach the vault but
        we can't credit a casino balance to you until you{" "}
        <Link href="/auth" className="underline-offset-2 hover:underline text-amber-200">
          sign in
        </Link>
        . Use the Dev (play money) chain to try the UX risk-free.
      </div>
    </div>
  );
}

function NotConfiguredBanner({ chainId }: { chainId: ChainId }) {
  const envName = `NEXT_PUBLIC_CASINO_VAULT_${chainId.toUpperCase().replaceAll("-", "_")}`;
  return (
    <div className="mt-4 p-4 rounded-lg bg-amber-500/10 border border-amber-400/30">
      <div className="text-amber-200 text-sm font-semibold mb-1">
        Vault address not configured for this chain
      </div>
      <div className="text-[12px] text-white/70 leading-relaxed">
        To enable real deposits and withdrawals on {chainId}, deploy{" "}
        <code className="text-amber-200">CasinoVault.sol</code> (see{" "}
        <code className="text-amber-200">infra/contracts/ethereum/</code>) and
        set the address in your <code className="text-amber-200">.env.local</code>:
        <pre className="mt-2 text-[11px] bg-black/40 border border-white/[0.06] rounded p-2 overflow-x-auto">
          {envName}=0x…
        </pre>
        Until then, use the <strong>Dev (play money)</strong> chain — it
        works end-to-end against an in-memory ledger so you can verify the
        UX without touching real funds.
      </div>
    </div>
  );
}

/* ===========================================================================
 *  Deposit panel
 * ========================================================================= */

function DepositPanel({
  wallet,
  chainId,
  chainKind,
  adapter,
  adapterReady,
  token,
  userAddress,
  onRecord,
  onUpdate,
}: {
  wallet: ReturnType<typeof useWallet>;
  chainId: ChainId;
  chainKind: "dev" | "evm";
  adapter: ReturnType<typeof makeRealEthereumAdapter> | null;
  adapterReady: boolean;
  token: TokenSpec;
  userAddress: string | null;
  onRecord: (e: WalletHistoryEntry) => void;
  onUpdate: (txHash: string, patch: Partial<WalletHistoryEntry>) => void;
}) {
  const [amount, setAmount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [onChainBalance, setOnChainBalance] = useState<bigint | null>(null);

  // Pull on-chain balance for the user when adapter ready.
  useEffect(() => {
    setOnChainBalance(null);
    if (!adapter || !userAddress || !adapterReady) return;
    let cancelled = false;
    (async () => {
      try {
        const b = await adapter.fetchTokenBalance(token, userAddress);
        if (!cancelled) setOnChainBalance(b);
      } catch (e) {
        if (!cancelled) {
          console.warn("balance fetch failed", e);
          setOnChainBalance(0n);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, adapterReady, token, userAddress]);

  const doDeposit = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!userAddress) {
      setError("Connect a wallet first.");
      return;
    }
    const amountUnits = humanToUnits(amount, token);
    if (amountUnits <= 0n) {
      setError("Amount must be > 0");
      return;
    }
    setBusy(true);
    try {
      if (chainKind === "dev") {
        // Dev mock: this is a UX-only flow. Just record an entry so the
        // history table populates and the user can see how it'd look.
        const fakeHash = `0xdev${Math.floor(Math.random() * 1e16).toString(16).padStart(16, "0")}`;
        onRecord({
          at: new Date().toISOString(),
          kind: "deposit",
          chainId,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          amountUnits: amountUnits.toString(),
          txHash: fakeHash,
          status: "finalized",
          txUrl: `#dev-mock/tx/${fakeHash}`,
        });
        setStatus(`Dev deposit recorded: ${fmtMoney(amountUnits, token)}`);
        return;
      }

      if (!adapter || !adapterReady) {
        setError("Vault not configured for this chain.");
        return;
      }
      if (token.isNative) {
        setError("Native ETH deposit requires WETH wrapping (TBD vault v1.1).");
        return;
      }

      // Real EVM deposit flow.
      const signer = wallet.getSigner(adapter.provider.connection.url);
      if (!signer) {
        setError("Unable to get a signer. Unlock vault or connect MetaMask.");
        return;
      }

      setStatus("Requesting approve…");
      const { approveTxHash, depositTxHash } = await adapter.submitDeposit({
        signer,
        user: userAddress,
        token,
        amount: amountUnits,
      });

      const entry: WalletHistoryEntry = {
        at: new Date().toISOString(),
        kind: "deposit",
        chainId,
        tokenSymbol: token.symbol,
        tokenDecimals: token.decimals,
        amountUnits: amountUnits.toString(),
        txHash: depositTxHash,
        approveTxHash,
        status: "submitted",
        txUrl: adapter.txUrl(depositTxHash),
      };
      onRecord(entry);
      setStatus(`Deposit submitted — ${shortAddr(depositTxHash)}, waiting for confirmations`);

      // Poll for finalization.
      await pollUntilFinal(adapter.pollDeposit.bind(adapter), depositTxHash, {
        onProgress: (r) => {
          setStatus(
            `Confirmation ${r.confirmations}/${r.required}${r.finalized ? " — finalized" : ""}`,
          );
          onUpdate(depositTxHash, {
            status: r.finalized ? "finalized" : "confirming",
          });
        },
      });

      try {
        const supabaseUser = wallet.user;
        if (supabaseUser?.id) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const jwt = session?.access_token;
          if (!jwt) {
            setStatus("Deposit finalized on-chain. Sign in again to credit balance.");
          } else {
            const res = await fetch("/api/casino/deposit-credit", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${jwt}`,
              },
              body: JSON.stringify({
                chainId,
                token,
                txHash: depositTxHash,
                walletAddress: userAddress,
                amountUnits: amountUnits.toString(),
              }),
            });
            const data = (await res.json()) as {
              amount?: string;
              alreadyCredited?: boolean;
              error?: string;
            };
            if (!res.ok) {
              setStatus(
                `On-chain finalized, but casino credit failed: ${data.error ?? res.statusText}. Tx ${shortAddr(depositTxHash)}.`,
              );
            } else {
              const credited = BigInt(data.amount ?? amountUnits.toString());
              setStatus(
                data.alreadyCredited
                  ? `Deposit already credited — ${fmtMoney(credited, token)}`
                  : `Deposit credited — ${fmtMoney(credited, token)}`,
              );
            }
          }
        } else {
          setStatus(
            "Deposit finalized on-chain. Sign in to credit your casino balance.",
          );
        }
      } catch (e) {
        setStatus(
          `On-chain finalized, but casino ledger credit failed: ${(e as Error).message}. Contact support with tx ${shortAddr(depositTxHash)}.`,
        );
      }

      // Refresh on-chain balance.
      try {
        const b = await adapter.fetchTokenBalance(token, userAddress);
        setOnChainBalance(b);
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [adapter, adapterReady, amount, chainId, chainKind, onRecord, onUpdate, token, userAddress, wallet]);

  return (
    <section className={card + " p-6 space-y-4"}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Amount ({token.symbol})</label>
          <input
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            disabled={busy}
          />
        </div>
        <div>
          <label className={labelCls}>On-chain balance</label>
          <div className="h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center text-sm font-mono text-white/80">
            {chainKind === "dev"
              ? "—"
              : onChainBalance === null
                ? "loading…"
                : fmtMoney(onChainBalance, token)}
          </div>
        </div>
      </div>

      <button
        className={btnPrimary}
        onClick={doDeposit}
        disabled={busy || (!adapterReady && chainKind !== "dev")}
      >
        {busy ? "Submitting…" : `Deposit ${amount} ${token.symbol}`}
      </button>

      {status && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-sm text-emerald-200">
          {status}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="text-[11px] text-white/40 leading-relaxed border-t border-white/[0.06] pt-3">
        Two transactions: first your wallet signs an ERC-20{" "}
        <code className="text-emerald-300">approve(vault, amount)</code>{" "}
        (skipped if allowance is already sufficient), then{" "}
        <code className="text-emerald-300">vault.deposit(token, amount)</code>.{" "}
        Funds become spendable on the casino balance once{" "}
        {adapter?.requiredConfirmations ?? "several"} block confirmations land.
      </div>
    </section>
  );
}

/* ===========================================================================
 *  Withdraw panel
 * ========================================================================= */

function WithdrawPanel({
  wallet,
  chainId,
  chainKind,
  adapter,
  adapterReady,
  token,
  userAddress,
  onRecord,
  onUpdate,
}: {
  wallet: ReturnType<typeof useWallet>;
  chainId: ChainId;
  chainKind: "dev" | "evm";
  adapter: ReturnType<typeof makeRealEthereumAdapter> | null;
  adapterReady: boolean;
  token: TokenSpec;
  userAddress: string | null;
  onRecord: (e: WalletHistoryEntry) => void;
  onUpdate: (txHash: string, patch: Partial<WalletHistoryEntry>) => void;
}) {
  const [amount, setAmount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doWithdraw = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!userAddress) {
      setError("Connect a wallet first.");
      return;
    }
    const amountUnits = humanToUnits(amount, token);
    if (amountUnits <= 0n) {
      setError("Amount must be > 0");
      return;
    }
    setBusy(true);
    // Lifted out of the try so the catch block can release the casino
    // lock on any failure between lock and burn.
    let casinoLocked = false;
    try {
      if (chainKind === "dev") {
        const fakeHash = `0xdev${Math.floor(Math.random() * 1e16).toString(16).padStart(16, "0")}`;
        onRecord({
          at: new Date().toISOString(),
          kind: "withdraw",
          chainId,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          amountUnits: amountUnits.toString(),
          txHash: fakeHash,
          status: "finalized",
          txUrl: `#dev-mock/tx/${fakeHash}`,
        });
        setStatus(`Dev withdraw recorded: ${fmtMoney(amountUnits, token)}`);
        return;
      }

      if (!adapter || !adapterReady) {
        setError("Vault not configured for this chain.");
        return;
      }
      if (token.isNative) {
        setError("Native ETH withdraw requires WETH unwrapping (TBD).");
        return;
      }

      // Real EVM withdraw flow.
      const signer = wallet.getSigner(adapter.provider.connection.url);
      if (!signer) {
        setError("Unable to get a signer. Unlock vault or connect MetaMask.");
        return;
      }

      // Step 0 — if signed in, lock the funds in the casino ledger so the
      // user can't gamble them away while the on-chain withdraw is in
      // flight. On any subsequent failure we unlock; on finalization we
      // burn. (For anonymous users there's no off-chain balance to lock —
      // the on-chain vault is the only state.)
      if (wallet.user?.id) {
        const {
          data: { session: lockSession },
        } = await supabase.auth.getSession();
        const lockJwt = lockSession?.access_token;
        if (!lockJwt) {
          setError("Sign in required to withdraw casino balance.");
          return;
        }
        const lockRes = await fetch("/api/casino/withdraw-lock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${lockJwt}`,
          },
          body: JSON.stringify({
            chainId,
            token,
            amountUnits: amountUnits.toString(),
          }),
        });
        const lockBody = (await lockRes.json()) as { error?: string };
        if (!lockRes.ok) {
          setError(`Insufficient casino balance: ${lockBody.error ?? lockRes.statusText}`);
          return;
        }
        casinoLocked = true;
      }

      // Step 1 — fetch current user nonce from the contract.
      setStatus("Reading vault nonce…");
      const nonce = await adapter.fetchUserNonce(userAddress);

      // Step 2 — request EIP-712 voucher from the server.
      setStatus("Requesting operator authorization…");
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      const res = await fetch("/api/casino/withdraw-authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          user: userAddress,
          token: token.address,
          amount: amountUnits.toString(),
          nonce: nonce.toString(),
          expiresAt,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          `Authorization failed (${res.status}): ${body.error ?? "unknown"}`,
        );
      }
      const voucher: {
        signature: string;
        operator: string;
        isDevFallback: boolean;
      } = await res.json();

      if (voucher.isDevFallback) {
        setStatus(
          "Operator key in dev-fallback mode — withdraw will only succeed if the deployed contract's operator matches the dev key. Set CASINO_OPERATOR_KEY in production.",
        );
        // We still submit so the dev can observe the failure / success.
      }

      // Step 3 — submit withdraw with the voucher.
      setStatus("Submitting withdraw transaction…");
      const { txHash } = await adapter.submitWithdraw({
        signer,
        user: userAddress,
        token,
        amount: amountUnits,
        serverSignature: voucher.signature,
        nonce,
        expiresAt,
      });

      const entry: WalletHistoryEntry = {
        at: new Date().toISOString(),
        kind: "withdraw",
        chainId,
        tokenSymbol: token.symbol,
        tokenDecimals: token.decimals,
        amountUnits: amountUnits.toString(),
        txHash,
        status: "submitted",
        txUrl: adapter.txUrl(txHash),
      };
      onRecord(entry);
      setStatus(`Withdraw submitted — ${shortAddr(txHash)}, waiting for confirmations`);

      await pollUntilFinal(adapter.pollWithdraw.bind(adapter), txHash, {
        onProgress: (r) => {
          setStatus(
            `Confirmation ${r.confirmations}/${r.required}${r.finalized ? " — finalized" : ""}`,
          );
          onUpdate(txHash, {
            status: r.finalized ? "finalized" : "confirming",
          });
        },
      });

      if (casinoLocked && wallet.user?.id) {
        try {
          const {
            data: { session: authSession },
          } = await supabase.auth.getSession();
          const jwt = authSession?.access_token;
          if (!jwt) {
            setStatus(
              `Withdraw finalized on-chain. Sign in again to debit locked balance. Tx ${shortAddr(txHash)}.`,
            );
            return;
          }
          const res = await fetch("/api/casino/withdraw-debit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
              chainId,
              token,
              txHash,
              walletAddress: userAddress,
              amountUnits: amountUnits.toString(),
            }),
          });
          const data = (await res.json()) as {
            amount?: string;
            alreadyDebited?: boolean;
            error?: string;
          };
          if (!res.ok) {
            setStatus(
              `On-chain withdraw finalized, but casino debit failed: ${data.error ?? res.statusText}. Contact support with tx ${shortAddr(txHash)}.`,
            );
            return;
          }
          casinoLocked = false;
          const debited = BigInt(data.amount ?? amountUnits.toString());
          setStatus(
            data.alreadyDebited
              ? `Withdraw already debited — ${fmtMoney(debited, token)}`
              : `Withdraw debited — ${fmtMoney(debited, token)}`,
          );
        } catch (e) {
          setStatus(
            `On-chain withdraw finalized, but casino debit failed: ${(e as Error).message}. Contact support with tx ${shortAddr(txHash)}.`,
          );
          return;
        }
      }
    } catch (e) {
      // Anything between "we locked" and "we burned" — release the lock
      // so the user's casino balance is recoverable.
      if (casinoLocked && wallet.user?.id) {
        try {
          const {
            data: { session: unlockSession },
          } = await supabase.auth.getSession();
          const unlockJwt = unlockSession?.access_token;
          if (unlockJwt) {
            await fetch("/api/casino/withdraw-unlock", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${unlockJwt}`,
              },
              body: JSON.stringify({
                chainId,
                token,
                amountUnits: amountUnits.toString(),
              }),
            });
          }
        } catch {
          // best-effort
        }
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [adapter, adapterReady, amount, chainId, chainKind, onRecord, onUpdate, token, userAddress, wallet]);

  return (
    <section className={card + " p-6 space-y-4"}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Amount ({token.symbol})</label>
          <input
            type="number"
            min="0"
            step="any"
            className={inputCls}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            disabled={busy}
          />
        </div>
        <div>
          <label className={labelCls}>To address</label>
          <div className="h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center text-sm font-mono text-white/80">
            {shortAddr(userAddress)}
          </div>
        </div>
      </div>

      <button
        className={btnPrimary}
        onClick={doWithdraw}
        disabled={busy || (!adapterReady && chainKind !== "dev")}
      >
        {busy ? "Submitting…" : `Withdraw ${amount} ${token.symbol}`}
      </button>

      {status && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-sm text-emerald-200">
          {status}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="text-[11px] text-white/40 leading-relaxed border-t border-white/[0.06] pt-3">
        Withdrawals are EIP-712 authorized. The server signs a{" "}
        <code className="text-emerald-300">Withdrawal</code> voucher with
        the operator key (per{" "}
        <code className="text-emerald-300">CasinoVault.sol</code>); your
        wallet then submits the signed voucher to{" "}
        <code className="text-emerald-300">vault.withdraw(...)</code>.
        Funds go directly to your address — anyone can relay the tx but
        only you can receive.
      </div>
    </section>
  );
}

/* ===========================================================================
 *  History panel
 * ========================================================================= */

function HistoryPanel({
  history,
  adapter,
}: {
  history: WalletHistoryEntry[];
  adapter: ReturnType<typeof makeRealEthereumAdapter> | null;
}) {
  if (history.length === 0) {
    return (
      <section className={card + " p-6 text-center text-white/50 text-sm"}>
        No deposit or withdrawal history yet. Try the Dev (play money) chain to see how it looks.
      </section>
    );
  }

  return (
    <section className={card + " p-0 overflow-hidden"}>
      <table className="w-full text-[12px]">
        <thead className="text-white/40">
          <tr className="border-b border-white/[0.06]">
            <Th>Time</Th>
            <Th>Kind</Th>
            <Th>Chain</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
            <Th>Tx</Th>
          </tr>
        </thead>
        <tbody>
          {history.map((e) => (
            <tr key={e.txHash} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
              <Td className="text-white/60 whitespace-nowrap">{formatTime(e.at)}</Td>
              <Td>
                <span
                  className={
                    e.kind === "deposit"
                      ? "text-emerald-300"
                      : "text-amber-300"
                  }
                >
                  {e.kind}
                </span>
              </Td>
              <Td className="text-white/60">{e.chainId}</Td>
              <Td className="text-right font-mono text-white/80">
                {fmtMoney(BigInt(e.amountUnits), {
                  symbol: e.tokenSymbol,
                  display: e.tokenSymbol,
                  decimals: e.tokenDecimals,
                  address: "0x0",
                  isNative: false,
                })}
              </Td>
              <Td>
                <StatusPill status={e.status} />
              </Td>
              <Td>
                {e.txUrl.startsWith("http") ? (
                  <a
                    href={e.txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-300 hover:underline font-mono"
                  >
                    {shortAddr(e.txHash)} ↗
                  </a>
                ) : (
                  <span className="text-white/30 font-mono">{shortAddr(e.txHash)}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {adapter && (
        <div className="px-4 py-2 border-t border-white/[0.06] text-[10px] text-white/40">
          Tx explorer:{" "}
          <a
            href={adapter.explorerBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-300/80 hover:underline"
          >
            {adapter.explorerBaseUrl}
          </a>
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: WalletHistoryEntry["status"] }) {
  const cls: Record<WalletHistoryEntry["status"], string> = {
    submitted: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    confirming: "bg-amber-500/15 text-amber-200 border-amber-400/30",
    finalized: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
    failed: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  };
  return (
    <span className={"px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide " + cls[status]}>
      {status}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={
        "text-left px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.15em] " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-4 py-2.5 " + (className ?? "")}>{children}</td>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ===========================================================================
 *  Polling helper
 *
 *  Repeatedly calls `pollFn(txHash)` until the returned receipt is
 *  finalized or we hit max attempts. Cleans up cleanly when the page
 *  navigates away — the caller can drop the promise.
 * ========================================================================= */

interface PollableReceipt {
  confirmations: number;
  required: number;
  finalized: boolean;
}

async function pollUntilFinal(
  pollFn: (txHash: string) => Promise<PollableReceipt | null>,
  txHash: string,
  opts: {
    intervalMs?: number;
    maxAttempts?: number;
    onProgress?: (r: PollableReceipt) => void;
  } = {},
): Promise<PollableReceipt | null> {
  const interval = opts.intervalMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 60; // 4 min @ 4s

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await pollFn(txHash);
      if (r) {
        opts.onProgress?.(r);
        if (r.finalized) return r;
      }
    } catch (e) {
      console.warn("poll attempt failed", e);
    }
    await new Promise((res) => setTimeout(res, interval));
  }
  return null;
}

/* ---------------------------------------------------------------------------
 *  Note on Ethereum signing fallback
 *
 *  `wallet.getSigner(rpcUrl)` reuses the WalletProvider's logic: if the
 *  user has selected a MoneyFund vault wallet (custodial, decrypted key
 *  in-memory), it returns `new ethers.Wallet(privateKey, provider)`. If
 *  MetaMask is selected, it returns `provider.getSigner()` from an
 *  injected Web3 provider. Either way the page never sees the private
 *  key directly.
 *
 *  We pass the RPC URL of the chain we're transacting on so the wallet
 *  provider talks to the right network — otherwise it defaults to
 *  Ethereum mainnet (which would be wrong on Base / Sepolia / Arbitrum).
 * ------------------------------------------------------------------------- */
