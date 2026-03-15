"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "@/lib/wallet-context";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HOST = "arweave.net";
const PROTOCOL = "https";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StatusMsg {
  text: string;
  type: "loading" | "success" | "error";
}

interface ArweaveTx {
  format: number;
  owner: string | undefined;
  target: string;
  quantity: string;
  reward: string;
  last_tx: string;
  tags: never[];
  data_size: string;
  data_root: string;
  data?: string;
  signature?: string;
  id?: string;
}

/* ------------------------------------------------------------------ */
/*  Crypto helpers (pure Web Crypto API — no external deps)            */
/* ------------------------------------------------------------------ */

function b64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(str: string): ArrayBuffer {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function sha256(message: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  const buf = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const ab = buf instanceof ArrayBuffer ? buf : (buf as Uint8Array).buffer as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", ab));
}

async function generateKey(): Promise<JsonWebKey> {
  const key = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return crypto.subtle.exportKey("jwk", key.privateKey);
}

async function jwkToAddress(jwk: JsonWebKey): Promise<string> {
  const n = b64urlDecode(jwk.n!);
  const hash = await sha256(n);
  return b64urlEncode(hash);
}

async function getBalance(addr: string): Promise<string> {
  const res = await fetch(`${PROTOCOL}://${HOST}/wallet/${addr}/balance`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.text();
}

async function getPrice(dataSize: number | string, target?: string): Promise<string> {
  let url = `${PROTOCOL}://${HOST}/price/${dataSize}`;
  if (target) url += `/${target}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
  return res.text();
}

async function getAnchor(): Promise<string> {
  const res = await fetch(`${PROTOCOL}://${HOST}/tx_anchor`);
  if (!res.ok) throw new Error(`Anchor fetch failed: ${res.status}`);
  return res.text();
}

async function signTx(tx: ArweaveTx, jwk: JsonWebKey) {
  const msg = JSON.stringify({
    owner: tx.owner, target: tx.target, data: tx.data, quantity: tx.quantity,
    reward: tx.reward, last_tx: tx.last_tx, tags: tx.tags || [],
    data_root: tx.data_root, data_size: tx.data_size,
  });
  const msgBuffer = new TextEncoder().encode(msg);
  const privKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-PSS", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, privKey, msgBuffer);
  tx.signature = b64urlEncode(signature);
  const sigHash = await sha256(signature);
  tx.id = b64urlEncode(sigHash);
}

async function postTx(tx: ArweaveTx): Promise<Response> {
  return fetch(`${PROTOCOL}://${HOST}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tx),
  });
}

/* ================================================================== */
/*  Shared design tokens (must match wallets-app.tsx)                   */
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

  /* ---- helpers ---- */
  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const winston = await getBalance(addr);
      const ar = (Number(winston) / 1e12).toFixed(6);
      setBalance(ar);
    } catch {
      setBalance("Error");
    }
  }, []);

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

  /* ---- actions ---- */
  const handleGenerate = useCallback(async () => {
    setGenStatus({ text: "Generating keypair... (2-3 sec)", type: "loading" });
    try {
      const jwk = await generateKey();
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
      const anchor = await getAnchor();
      const quantity = BigInt(Math.round(parseFloat(amount) * 10 ** 12)).toString();
      const reward = await getPrice(0, target);
      const tx: ArweaveTx = {
        format: 2, owner: localJwk.n, target, quantity, reward,
        last_tx: anchor, tags: [], data_size: "0", data_root: "",
      };
      await signTx(tx, localJwk);
      const res = await postTx(tx);
      if (res.status === 200) {
        setSendStatus({ text: `Sent! TX ID: ${tx.id}`, type: "success" });
        setTimeout(() => refreshBalance(address), 2000);
      } else {
        throw new Error(`Status: ${res.status}`);
      }
    } catch (e: unknown) {
      setSendStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [localJwk, target, amount, address, refreshBalance]);

  const handleUpload = useCallback(async () => {
    if (!localJwk) { setUploadStatus({ text: "No wallet loaded", type: "error" }); return; }
    const file = fileRef.current?.files?.[0];
    if (!dataText && !file) { setUploadStatus({ text: "Add text or file", type: "error" }); return; }
    setUploadStatus({ text: "Preparing...", type: "loading" });
    try {
      let data: Uint8Array;
      if (dataText) {
        data = new TextEncoder().encode(dataText);
      } else {
        data = new Uint8Array(await file!.arrayBuffer());
      }
      const dataRoot = await sha256(data);
      const anchor = await getAnchor();
      const dataSize = data.byteLength.toString();
      const reward = await getPrice(dataSize);
      const tx: ArweaveTx = {
        format: 2, owner: localJwk.n, target: "", quantity: "0", reward,
        last_tx: anchor, tags: [], data_size: dataSize, data_root: b64urlEncode(dataRoot),
      };
      await signTx(tx, localJwk);
      await postTx(tx);
      const chunkSize = 256 * 1024;
      let offset = 0;
      while (offset < data.byteLength) {
        const chunk = data.slice(offset, offset + chunkSize);
        offset += chunk.byteLength;
        const pct = ((offset / data.byteLength) * 100).toFixed(1);
        const chunkB64 = b64urlEncode(chunk);
        const chunkRes = await fetch(`${PROTOCOL}://${HOST}/chunk/${tx.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_root: tx.data_root, data_size: tx.data_size,
            data_path: "", offset: offset - chunk.byteLength, chunk: chunkB64,
          }),
        });
        if (!chunkRes.ok) throw new Error(`Chunk upload failed at ${pct}%: HTTP ${chunkRes.status}`);
        setUploadStatus({ text: `Uploading: ${pct}%`, type: "loading" });
      }
      setUploadStatus({ text: `Uploaded! TX ID: ${tx.id}`, type: "success" });
    } catch (e: unknown) {
      setUploadStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [localJwk, dataText]);

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
          <button type="button" onClick={handleSend} className={btnPrimary}>Send Transaction</button>
          {renderStatus(sendStatus)}
        </div>
      )}

      {/* ── Upload Tab ── */}
      {arTab === "upload" && (
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
          <button type="button" onClick={handleUpload} className={btnPrimary}>Upload</button>
          {renderStatus(uploadStatus)}
        </div>
      )}
    </div>
  );
}
