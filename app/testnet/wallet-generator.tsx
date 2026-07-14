"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getRpcProxyUrl, rpcCall } from "@/lib/testnet/rpc";
import {
  decodeWalletAddress,
  generateTestnetWallet,
  type GeneratedWallet,
} from "@/lib/testnet/wallet-keys";
import {
  clearSession,
  loadHistory,
  loadSession,
  loadSync,
  pushHistory,
  saveSession,
  saveSync,
  syncWalletLite,
  totalBalance,
  type HistoryEntry,
  type SessionWallet,
  type WalletSyncState,
  loadMfnWasm,
} from "@/lib/testnet/wasm-wallet";
import { CopyButton, truncateId, useCopyFeedback } from "./ui";

const FEE = 10_000;
const RING = 16;

type Props = {
  rpcProxyUrl?: string | null;
};

export default function WalletGenerator({ rpcProxyUrl }: Props) {
  const proxy = getRpcProxyUrl(rpcProxyUrl) || "/api/testnet/rpc";
  const { copiedKey, copy } = useCopyFeedback();
  const [session, setSession] = useState<SessionWallet | null>(null);
  const [sync, setSync] = useState<WalletSyncState>(() => loadSync(""));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("100000");
  const [scanProgress, setScanProgress] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    setSession(s);
    setSync(loadSync(s.seedHex));
    setHistory(loadHistory(s.seedHex));
  }, []);

  const balance = useMemo(() => totalBalance(sync), [sync]);

  const adopt = useCallback((w: GeneratedWallet) => {
    const sess: SessionWallet = {
      seedHex: w.seedHex,
      address: w.address,
      viewPubHex: w.viewPubHex,
      spendPubHex: w.spendPubHex,
    };
    saveSession(sess);
    setSession(sess);
    const st = loadSync(w.seedHex);
    setSync(st);
    setHistory(loadHistory(w.seedHex));
    setRevealed(false);
    setError(null);
    setStatus("Wallet ready — fund with the faucet, then refresh balance.");
  }, []);

  const onGenerate = useCallback(() => {
    adopt(generateTestnetWallet());
  }, [adopt]);

  const onForget = useCallback(() => {
    clearSession();
    setSession(null);
    setSync(loadSync(""));
    setHistory([]);
    setStatus(null);
    setError(null);
  }, []);

  const rpc = useCallback(
    async <T,>(method: string, params: Record<string, unknown> = {}) =>
      rpcCall<T>(proxy, method, params),
    [proxy],
  );

  const refreshBalance = useCallback(async () => {
    if (!session) return;
    setBusy("scan");
    setError(null);
    setStatus(null);
    try {
      await loadMfnWasm();
      const tip = await rpc<{ tip_height?: number }>("get_tip", {});
      const tipH = Number(tip.tip_height ?? 0);
      if (tipH < 1) {
        setStatus("Chain has no blocks yet.");
        return;
      }
      const state = loadSync(session.seedHex);
      const from = Math.max(1, state.lastScannedHeight + 1);
      if (from > tipH) {
        setSync(state);
        setStatus(`Up to date through tip #${tipH}.`);
        return;
      }
      const result = await syncWalletLite({
        seedHex: session.seedHex,
        fromHeight: from,
        toHeight: tipH,
        state,
        rpc,
        onProgress: (h, tipHeight) =>
          setScanProgress(`Scanning block ${h} / ${tipHeight}`),
      });
      setSync({ ...state });
      setHistory(loadHistory(session.seedHex));
      setStatus(
        `Synced to #${tipH} · balance ${result.balance.toLocaleString()} · +${result.recovered} output(s)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setScanProgress(null);
    }
  }, [session, rpc]);

  const claimFaucet = useCallback(async () => {
    if (!session) return;
    setBusy("faucet");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/testnet/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: session.address }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        total_amount?: number;
        tx_ids?: string[];
        retry_after_ms?: number;
      };
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `faucet HTTP ${res.status}`);
      }
      const total = data.total_amount ?? 0;
      for (const txId of data.tx_ids || []) {
        if (!txId) continue;
        pushHistory(session.seedHex, {
          id: `faucet:${txId}`,
          kind: "faucet",
          amount: Math.floor(total / Math.max(1, (data.tx_ids || []).length)),
          txId,
          at: Date.now(),
          note: "Faucet claim",
        });
      }
      setHistory(loadHistory(session.seedHex));
      setStatus(
        `Faucet sent ${total.toLocaleString()} atomic units across ${(data.tx_ids || []).length} tx(s). Wait for a block, then refresh balance.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [session]);

  const onSend = useCallback(async () => {
    if (!session) return;
    setBusy("send");
    setError(null);
    setStatus(null);
    try {
      const amount = Number(sendAmount);
      if (!Number.isFinite(amount) || amount < 1) {
        throw new Error("amount must be a positive number");
      }
      const dest = decodeWalletAddress(sendTo.trim());
      const state = loadSync(session.seedHex);
      if (state.inputs.length < 2) {
        throw new Error(
          "Need at least 2 UTXOs to send (F7 floor). Claim the faucet (2 sends), wait for blocks, then refresh.",
        );
      }
      const needed = amount + FEE;
      const sorted = [...state.inputs].sort((a, b) => b.value - a.value);
      let pick = sorted.slice(0, 2);
      let sum = pick.reduce((s, o) => s + o.value, 0);
      if (sum < needed) {
        pick = [];
        sum = 0;
        for (const o of sorted) {
          pick.push(o);
          sum += o.value;
          if (sum >= needed && pick.length >= 2) break;
        }
      }
      if (pick.length < 2 || sum < needed) {
        throw new Error(
          `Insufficient balance (have ${sum}, need ${needed} incl. fee ${FEE}).`,
        );
      }

      const tip = await rpc<{ tip_height?: number }>("get_tip", {});
      const tipH = Number(tip.tip_height ?? 0);
      const utxoPage = await rpc<{
        utxos?: Array<{
          height: number;
          one_time_addr_hex: string;
          commit_hex: string;
        }>;
      }>("list_utxos", { limit: 10000, offset: 0 });

      const change = sum - amount - FEE;
      const recipients = [
        {
          view_pub_hex: dest.viewPubHex,
          spend_pub_hex: dest.spendPubHex,
          value: amount,
        },
      ];
      if (change > 0) {
        recipients.push({
          view_pub_hex: session.viewPubHex,
          spend_pub_hex: session.spendPubHex,
          value: change,
        });
      }

      const plan = {
        inputs: pick,
        recipients,
        fee: FEE,
        ring_size: RING,
        current_height: tipH,
        decoy_utxos: (utxoPage.utxos || []).map((u) => ({
          height: u.height,
          one_time_addr_hex: u.one_time_addr_hex,
          commit_hex: u.commit_hex,
        })),
        exclude_one_time_addrs_hex: pick.map((i) => i.one_time_addr_hex),
      };

      const wasm = await loadMfnWasm();
      const built = JSON.parse(wasm.buildTransferJson(JSON.stringify(plan))) as {
        tx_hex: string;
        tx_id: string;
      };
      const submit = await rpc<{ outcome?: string; tx_id?: string }>("submit_tx", {
        tx_hex: built.tx_hex,
      });

      const spent = new Set(pick.map((p) => p.key_image_hex.toLowerCase()));
      state.inputs = state.inputs.filter(
        (o) => !spent.has(o.key_image_hex.toLowerCase()),
      );
      saveSync(session.seedHex, state);
      setSync({ ...state });

      pushHistory(session.seedHex, {
        id: `sent:${built.tx_id}`,
        kind: "sent",
        amount,
        txId: built.tx_id || submit.tx_id,
        counterparty: sendTo.trim(),
        at: Date.now(),
        note: submit.outcome || "submitted",
      });
      setHistory(loadHistory(session.seedHex));
      setStatus(
        `Sent ${amount.toLocaleString()} · tx ${truncateId(built.tx_id)} · refresh after the next block for change.`,
      );
      setSendAmount("100000");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [session, sendAmount, sendTo, rpc]);

  const downloadJson = useCallback(() => {
    if (!session) return;
    const json = JSON.stringify(
      {
        version: 2,
        seed_hex: session.seedHex,
        key_derivation: "mfn_wallet_v1",
      },
      null,
      2,
    );
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "testnet-wallet.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [session]);

  if (!session) {
    return (
      <div className="space-y-3 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-4 py-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[var(--pw-ink)]">
            Testnet wallet
          </p>
          <p className="text-xs leading-relaxed text-[var(--pw-muted)]">
            Generate a keypair in your browser, fund it from the public faucet,
            then scan and send. Seed never leaves this device.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex h-10 items-center rounded-md bg-[var(--pw-accent)] px-4 text-sm font-semibold text-[#0a1210] transition-opacity hover:opacity-90"
        >
          Generate wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--pw-ink)]">
            Testnet wallet
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--pw-faint)]">
            Session stored locally · mfn_wallet_v1
          </p>
        </div>
        <button
          type="button"
          onClick={onForget}
          className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pw-muted)] hover:text-[var(--pw-ink)]"
        >
          Forget wallet
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Balance"
          value={busy === "scan" ? "…" : balance.toLocaleString()}
          hint={`${sync.inputs.length} UTXO${sync.inputs.length === 1 ? "" : "s"} · scanned #${sync.lastScannedHeight}`}
        />
        <Stat
          label="Tip sync"
          value={scanProgress || (busy ? busy : "ready")}
          hint="Observer-trusted scan"
        />
        <Stat
          label="Fee"
          value={FEE.toLocaleString()}
          hint={`ring ${RING}`}
        />
      </div>

      <Field
        label="Address"
        value={session.address}
        copyKey="wal-addr"
        copiedKey={copiedKey}
        onCopy={copy}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
            Seed (secret)
          </p>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pw-accent)] hover:underline"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
        </div>
        <div className="flex items-start justify-between gap-2 rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)] px-3 py-2.5">
          <code
            className={`min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-[var(--pw-code-ink)] ${
              revealed ? "" : "select-none blur-[5px]"
            }`}
          >
            {session.seedHex}
          </code>
          <CopyButton
            text={session.seedHex}
            copyKey="wal-seed"
            copiedKey={copiedKey}
            onCopy={copy}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy != null}
          onClick={claimFaucet}
          className="inline-flex h-9 items-center rounded-md bg-[var(--pw-accent)] px-3 text-xs font-semibold text-[#0a1210] disabled:opacity-50"
        >
          {busy === "faucet" ? "Funding…" : "Fund with faucet"}
        </button>
        <button
          type="button"
          disabled={busy != null}
          onClick={refreshBalance}
          className="inline-flex h-9 items-center rounded-md border border-[var(--pw-line)] bg-[var(--pw-surface)] px-3 text-xs font-semibold text-[var(--pw-ink)] disabled:opacity-50"
        >
          {busy === "scan" ? "Scanning…" : "Refresh balance"}
        </button>
        <button
          type="button"
          onClick={downloadJson}
          className="inline-flex h-9 items-center rounded-md border border-[var(--pw-line)] bg-[var(--pw-surface)] px-3 text-xs font-semibold text-[var(--pw-ink)]"
        >
          Download JSON
        </button>
        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex h-9 items-center rounded-md border border-[var(--pw-line)] bg-[var(--pw-surface)] px-3 text-xs font-semibold text-[var(--pw-ink)]"
        >
          New wallet
        </button>
      </div>

      <div className="space-y-2 border-t border-[var(--pw-line)] pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
          Send
        </p>
        <input
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          placeholder="Recipient mf… address"
          className="w-full rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)] px-3 py-2 font-mono text-[11px] text-[var(--pw-code-ink)] outline-none focus:border-[var(--pw-accent)]/50"
        />
        <div className="flex flex-wrap gap-2">
          <input
            value={sendAmount}
            onChange={(e) => setSendAmount(e.target.value)}
            placeholder="Amount (atomic)"
            className="w-40 rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)] px-3 py-2 font-mono text-[11px] text-[var(--pw-code-ink)] outline-none focus:border-[var(--pw-accent)]/50"
          />
          <button
            type="button"
            disabled={busy != null}
            onClick={onSend}
            className="inline-flex h-9 items-center rounded-md border border-[var(--pw-accent)]/40 bg-[var(--pw-accent-soft)] px-3 text-xs font-semibold text-[var(--pw-accent)] disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {(status || error) && (
        <p
          className={`text-xs leading-relaxed ${
            error ? "text-red-300/90" : "text-[var(--pw-muted)]"
          }`}
        >
          {error || status}
        </p>
      )}

      {history.length > 0 && (
        <div className="space-y-2 border-t border-[var(--pw-line)] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
            Activity
          </p>
          <ul className="max-h-56 space-y-0 divide-y divide-[var(--pw-line)] overflow-y-auto rounded-lg border border-[var(--pw-line)]">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"
              >
                <div className="min-w-0">
                  <p className="font-medium capitalize text-[var(--pw-ink)]">
                    {h.kind}
                    {h.height != null ? ` · #${h.height}` : ""}
                  </p>
                  <p
                    className="truncate font-mono text-[var(--pw-faint)]"
                    title={h.txId}
                  >
                    {h.txId ? truncateId(h.txId) : h.note || "—"}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    h.kind === "sent"
                      ? "text-red-300/80"
                      : "text-[var(--pw-accent)]"
                  }`}
                >
                  {h.kind === "sent" ? "−" : "+"}
                  {h.amount.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)]/50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pw-faint)]">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm text-[var(--pw-ink)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] text-[var(--pw-faint)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        {label}
      </p>
      <div className="flex items-start justify-between gap-2 rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)] px-3 py-2.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-[var(--pw-code-ink)]">
          {value}
        </code>
        <CopyButton
          text={value}
          copyKey={copyKey}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      </div>
    </div>
  );
}
