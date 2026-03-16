"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useWallet } from "@/lib/wallet-context";
import ArweaveGateway from "@/lib/arweave";
import type { ArweaveTag, ArweaveCostEstimate } from "@/lib/wallet-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StatusMsg {
  text: string;
  type: "loading" | "success" | "error";
}

/* ================================================================== */
/*  Design tokens (must match wallets-app.tsx)                         */
/* ================================================================== */

const card = "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const input = "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-purple-400/60 focus:ring-1 focus:ring-purple-400/30 transition-all";
const textarea = `${input} h-auto py-3`;
const btnPrimary = "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-500 to-violet-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer";
const btnGhost = "w-full h-11 rounded-xl font-medium text-sm border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.06] active:scale-[0.98] transition-all cursor-pointer";
const label = "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";
const pillBtn = "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-medium border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all cursor-pointer";

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function ArweaveWallet() {
  const { arweaveWallet, setArweaveWallet: saveArweaveWallet } = useWallet();
  const gw = useMemo(() => new ArweaveGateway(), []);

  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("—");
  const [arTab, setArTab] = useState<"setup" | "info" | "send" | "upload">("setup");
  const [localJwk, setLocalJwk] = useState<JsonWebKey | null>(null);

  const [importKey, setImportKey] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [dataText, setDataText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [genStatus, setGenStatus] = useState<StatusMsg | null>(null);
  const [impStatus, setImpStatus] = useState<StatusMsg | null>(null);
  const [expStatus, setExpStatus] = useState<StatusMsg | null>(null);
  const [sendStatus, setSendStatus] = useState<StatusMsg | null>(null);
  const [uploadStatus, setUploadStatus] = useState<StatusMsg | null>(null);

  /* Upload tags */
  const [uploadTags, setUploadTags] = useState<ArweaveTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  /* Cost preview */
  const [sendCost, setSendCost] = useState<ArweaveCostEstimate | null>(null);
  const [uploadCost, setUploadCost] = useState<ArweaveCostEstimate | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  /* ---- helpers ---- */
  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const { ar } = await gw.getBalance(addr);
      setBalance(parseFloat(ar).toFixed(6));
    } catch {
      setBalance("Error");
    }
  }, [gw]);

  useEffect(() => {
    if (arweaveWallet) {
      setLocalJwk(arweaveWallet.jwk);
      setAddress(arweaveWallet.address);
      setArTab("info");
      refreshBalance(arweaveWallet.address);
    } else {
      setLocalJwk(null);
      setAddress("");
      setBalance("—");
    }
  }, [arweaveWallet, refreshBalance]);

  /* ---- cost previews ---- */
  useEffect(() => {
    if (arTab !== "send" || !target || !amount) { setSendCost(null); return; }
    const t = setTimeout(async () => {
      try { setSendCost(await gw.estimateCost(0)); } catch { setSendCost(null); }
    }, 500);
    return () => clearTimeout(t);
  }, [gw, arTab, target, amount]);

  useEffect(() => {
    if (arTab !== "upload") { setUploadCost(null); return; }
    const file = fileRef.current?.files?.[0];
    const size = file ? file.size : dataText ? new TextEncoder().encode(dataText).byteLength : 0;
    if (size === 0) { setUploadCost(null); return; }
    const t = setTimeout(async () => {
      try { setUploadCost(await gw.estimateCost(size)); } catch { setUploadCost(null); }
    }, 500);
    return () => clearTimeout(t);
  }, [gw, arTab, dataText]);

  /* ---- actions ---- */
  const handleGenerate = useCallback(async () => {
    setGenStatus({ text: "Generating keypair... (2-3 sec)", type: "loading" });
    try {
      const jwk = await ArweaveGateway.generateWallet();
      await saveArweaveWallet(jwk);
      setGenStatus({ text: "Generated & encrypted in vault.", type: "success" });
    } catch (e: unknown) {
      setGenStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [saveArweaveWallet]);

  const handleImport = useCallback(async () => {
    if (!importKey.trim()) { setImpStatus({ text: "Paste JWK", type: "error" }); return; }
    try {
      const jwk = JSON.parse(importKey.trim()) as JsonWebKey;
      await saveArweaveWallet(jwk);
      setImpStatus({ text: "Imported & encrypted in vault!", type: "success" });
    } catch (e: unknown) {
      setImpStatus({ text: `Invalid JWK: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [importKey, saveArweaveWallet]);

  const handleExport = useCallback(() => {
    if (!localJwk) { setExpStatus({ text: "No wallet loaded", type: "error" }); return; }
    const blob = new Blob([JSON.stringify(localJwk, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arweave-wallet-${address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExpStatus({ text: "Downloaded! Check your downloads folder.", type: "success" });
    setTimeout(() => setExpStatus(null), 3000);
  }, [localJwk, address]);

  const handleClear = useCallback(async () => {
    if (!confirm("Remove Arweave wallet from your vault?")) return;
    await saveArweaveWallet(null);
    setArTab("setup");
  }, [saveArweaveWallet]);

  const handleSend = useCallback(async () => {
    if (!localJwk) { setSendStatus({ text: "No wallet loaded", type: "error" }); return; }
    if (!target || !amount) { setSendStatus({ text: "Fill fields", type: "error" }); return; }
    setSendStatus({ text: "Sending...", type: "loading" });
    try {
      const anchor = await gw.getTxAnchor();
      const reward = await gw.getPrice(0, target);
      const tx = await ArweaveGateway.buildTransferTx(target, amount, localJwk, anchor, reward);
      const res = await gw.submitTx(tx);
      if (res.status === 200) {
        setSendStatus({ text: `Sent! TX ID: ${tx.id}`, type: "success" });
        setTimeout(() => refreshBalance(address), 2000);
      } else {
        throw new Error(`Status: ${res.status}`);
      }
    } catch (e: unknown) {
      setSendStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [gw, localJwk, target, amount, address, refreshBalance]);

  const handleUpload = useCallback(async () => {
    if (!localJwk) { setUploadStatus({ text: "No wallet loaded", type: "error" }); return; }
    const file = fileRef.current?.files?.[0];
    if (!dataText && !file) { setUploadStatus({ text: "Add text or file", type: "error" }); return; }
    setUploadStatus({ text: "Preparing...", type: "loading" });
    setUploadProgress(0);
    try {
      let result;
      if (file) {
        result = await gw.uploadFile(file, uploadTags, localJwk, undefined, (pct) => setUploadProgress(pct));
      } else {
        const data = new TextEncoder().encode(dataText);
        const tags: ArweaveTag[] = [{ name: "Content-Type", value: "text/plain" }, ...uploadTags];
        result = await gw.uploadData(data, tags, localJwk, undefined, (pct) => setUploadProgress(pct));
      }
      if (result.status === 200) {
        setUploadStatus({ text: `Uploaded! TX ID: ${result.txId}`, type: "success" });
      } else {
        throw new Error(`Status: ${result.status}`);
      }
    } catch (e: unknown) {
      setUploadStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    } finally {
      setUploadProgress(null);
    }
  }, [gw, localJwk, dataText, uploadTags]);

  /* ---- tag helpers ---- */
  const addTag = useCallback(() => {
    if (!newTagName.trim()) return;
    setUploadTags((prev) => [...prev, { name: newTagName.trim(), value: newTagValue.trim() }]);
    setNewTagName("");
    setNewTagValue("");
  }, [newTagName, newTagValue]);

  const removeTag = useCallback((i: number) => {
    setUploadTags((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  /* ---- status badge ---- */
  const renderStatus = (s: StatusMsg | null) => {
    if (!s) return null;
    const cls =
      s.type === "success"
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : s.type === "error"
          ? "bg-red-500/10 text-red-400 border-red-500/20"
          : "bg-purple-500/10 text-purple-300 border-purple-500/20";
    return (
      <div className={`mt-3 py-2.5 px-3.5 rounded-xl text-xs font-medium border ${cls} break-all`}>
        {s.text}
      </div>
    );
  };

  const renderCost = (cost: ArweaveCostEstimate | null) => {
    if (!cost) return null;
    return (
      <div className="mt-2 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] text-white/40 flex gap-4">
        <span>{parseFloat(cost.ar).toFixed(8)} AR</span>
        <span>${parseFloat(cost.usd).toFixed(6)}</span>
        <span className="text-white/20">{cost.winston} winston</span>
      </div>
    );
  };

  const tabs: { id: typeof arTab; label: string; icon: string }[] = [
    { id: "setup", label: "Setup", icon: "+" },
    { id: "info", label: "Info", icon: "i" },
    { id: "send", label: "Send", icon: "↑" },
    { id: "upload", label: "Upload", icon: "☁" },
  ];

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className={`${card} p-1.5 flex gap-1`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setArTab(t.id)}
            className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              arTab === t.id
                ? "bg-purple-500/20 text-purple-300 shadow-[inset_0_1px_0_rgba(168,85,247,0.2)]"
                : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
            }`}
          >
            <span className="text-xs opacity-60">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Setup Tab ── */}
      {arTab === "setup" && (
        <div className="space-y-4">
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-white/80">Generate New Wallet</h3>
            <p className="text-xs text-white/30 -mt-2">Create a fresh RSA-4096 keypair encrypted in your vault.</p>
            <button type="button" onClick={handleGenerate} className={btnPrimary}>Generate Keypair</button>
            {renderStatus(genStatus)}
          </div>
          <div className={`${card} p-5 space-y-3`}>
            <h3 className="text-sm font-semibold text-white/80">Import Existing Key</h3>
            <textarea
              rows={3}
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              placeholder="Paste JWK JSON here..."
              className={textarea}
              style={{ resize: "vertical", fontFamily: "monospace", fontSize: "11px" }}
            />
            <button type="button" onClick={handleImport} className={btnPrimary}>Import Key</button>
            {renderStatus(impStatus)}
          </div>
        </div>
      )}

      {/* ── Info Tab ── */}
      {arTab === "info" && (
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Balance</span>
              <button type="button" onClick={() => { if (address) refreshBalance(address); }} className={pillBtn}>
                Refresh
              </button>
            </div>
            <p className="text-3xl font-bold text-white tracking-tight">
              {balance} <span className="text-lg font-normal text-white/30">AR</span>
            </p>
          </div>

          <div className={`${card} p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Address</span>
              <button
                type="button"
                onClick={() => { if (address) navigator.clipboard.writeText(address); }}
                className={pillBtn}
              >
                Copy
              </button>
            </div>
            <p className="text-xs font-mono text-white/50 break-all leading-relaxed bg-white/[0.03] rounded-lg p-3">
              {address || "No wallet loaded"}
            </p>
          </div>

          <div className={`${card} p-5 space-y-3`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Public Key Preview</span>
            <pre className="bg-white/[0.03] rounded-lg p-3 overflow-auto text-[10px] max-h-[80px] text-white/30 font-mono leading-relaxed">
              {localJwk ? JSON.stringify({ kty: localJwk.kty, n: localJwk.n, e: localJwk.e }, null, 2) : "No wallet loaded"}
            </pre>
            <p className="text-[11px] text-amber-400/60 flex items-center gap-1">
              <span>⚠</span> Full private key hidden for security. Use Download to export.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={handleExport} className={btnPrimary}>Download Key</button>
            <button type="button" onClick={handleClear} className={btnGhost}>Clear Wallet</button>
          </div>
          {renderStatus(expStatus)}
        </div>
      )}

      {/* ── Send Tab ── */}
      {arTab === "send" && (
        <div className={`${card} p-5 space-y-4`}>
          <h3 className="text-sm font-semibold text-white/80">Send AR</h3>
          <div>
            <label className={label}>Recipient</label>
            <div className="flex gap-2">
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Arweave address"
                className={`${input} flex-1`}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.readText().then((t) => setTarget(t.trim()))}
                className={pillBtn}
                style={{ height: 44 }}
              >
                Paste
              </button>
            </div>
          </div>
          <div>
            <label className={label}>Amount</label>
            <input
              type="number"
              step="0.000000000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00 AR"
              className={input}
            />
          </div>
          {renderCost(sendCost)}
          <button type="button" onClick={handleSend} className={btnPrimary}>Send Transaction</button>
          {renderStatus(sendStatus)}
        </div>
      )}

      {/* ── Upload Tab ── */}
      {arTab === "upload" && (
        <div className="space-y-4">
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-white/80">Upload to Arweave</h3>
            <p className="text-xs text-white/30 -mt-2">Permanently store text or a file on the permaweb.</p>
            <div>
              <label className={label}>Text Data</label>
              <textarea
                rows={3}
                value={dataText}
                onChange={(e) => setDataText(e.target.value)}
                placeholder="Enter text to upload..."
                className={textarea}
                style={{ resize: "vertical" }}
              />
            </div>
            <div>
              <label className={label}>Or choose a file</label>
              <input
                ref={fileRef}
                type="file"
                accept="*/*"
                className="block w-full text-sm text-white/40 file:mr-3 file:h-9 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-white/[0.06] file:text-white/60 hover:file:bg-white/[0.1] file:cursor-pointer file:transition-all"
              />
            </div>
          </div>

          {/* Tag editor */}
          <div className={`${card} p-5 space-y-3`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Custom Tags</span>
            {uploadTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {uploadTags.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300/60">
                    {t.name}: {t.value}
                    <button type="button" onClick={() => removeTag(i)} className="text-red-400/60 hover:text-red-400 cursor-pointer">x</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name" className={`flex-1 ${input}`} />
              <input value={newTagValue} onChange={(e) => setNewTagValue(e.target.value)} placeholder="Tag value" className={`flex-1 ${input}`} />
              <button type="button" onClick={addTag} className="h-11 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer">Add</button>
            </div>
          </div>

          {/* Cost estimate */}
          {renderCost(uploadCost)}

          {/* Progress */}
          {uploadProgress !== null && (
            <div className={`${card} p-4`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-violet-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <span className="text-xs text-white/50 w-12 text-right">{uploadProgress}%</span>
              </div>
            </div>
          )}

          <button type="button" onClick={handleUpload} disabled={uploadProgress !== null} className={btnPrimary}>
            {uploadProgress !== null ? "Uploading..." : "Upload"}
          </button>
          {renderStatus(uploadStatus)}
        </div>
      )}
    </div>
  );
}
