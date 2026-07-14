"use client";

import { useCallback, useState } from "react";
import {
  generateTestnetWallet,
  type GeneratedWallet,
} from "@/lib/testnet/wallet-keys";
import { CopyButton, useCopyFeedback } from "./ui";

export default function WalletGenerator() {
  const [wallet, setWallet] = useState<GeneratedWallet | null>(null);
  const [revealed, setRevealed] = useState(false);
  const { copiedKey, copy } = useCopyFeedback();

  const onGenerate = useCallback(() => {
    setWallet(generateTestnetWallet());
    setRevealed(false);
  }, []);

  const downloadJson = useCallback(() => {
    if (!wallet) return;
    const blob = new Blob([wallet.walletJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "testnet-wallet.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [wallet]);

  return (
    <div className="space-y-3 rounded-xl border border-[var(--pw-line)] bg-[var(--pw-surface)]/40 px-4 py-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[var(--pw-ink)]">
          Generate a testnet wallet
        </p>
        <p className="text-xs leading-relaxed text-[var(--pw-muted)]">
          Runs entirely in your browser (mfn_wallet_v1). Download the JSON or
          restore with{" "}
          <code className="text-[11px] text-[var(--pw-accent)]">
            mfn-cli wallet restore SEED_HEX
          </code>
          . Never share the seed — this page does not send it anywhere.
        </p>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        className="inline-flex h-10 items-center rounded-md bg-[var(--pw-accent)] px-4 text-sm font-semibold text-[#0a1210] transition-opacity hover:opacity-90"
      >
        {wallet ? "Generate another" : "Generate wallet"}
      </button>

      {wallet && (
        <div className="space-y-3 border-t border-[var(--pw-line)] pt-3">
          <Field
            label="Address"
            value={wallet.address}
            copyKey="gen-addr"
            copiedKey={copiedKey}
            onCopy={copy}
            mono
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
                {wallet.seedHex}
              </code>
              <CopyButton
                text={wallet.seedHex}
                copyKey="gen-seed"
                copiedKey={copiedKey}
                onCopy={copy}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadJson}
              className="inline-flex h-9 items-center rounded-md border border-[var(--pw-line)] bg-[var(--pw-surface)] px-3 text-xs font-semibold text-[var(--pw-ink)] transition-colors hover:border-[var(--pw-accent)]/40"
            >
              Download wallet.json
            </button>
            <CopyButton
              label="Copy JSON"
              text={wallet.walletJson}
              copyKey="gen-json"
              copiedKey={copiedKey}
              onCopy={copy}
            />
          </div>
          <p className="text-[11px] text-[var(--pw-faint)]">
            After download:{" "}
            <code className="text-[10px]">
              mfn-cli --rpc 127.0.0.1:18734 --wallet ./testnet-wallet.json wallet
              address
            </code>
          </p>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  copyKey,
  copiedKey,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--pw-faint)]">
        {label}
      </p>
      <div className="flex items-start justify-between gap-2 rounded-lg border border-[var(--pw-line)] bg-[var(--pw-code)] px-3 py-2.5">
        <code
          className={`min-w-0 flex-1 break-all text-[11px] leading-relaxed text-[var(--pw-code-ink)] ${
            mono ? "font-mono" : ""
          }`}
        >
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
