"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HOST = "arweave.net";
const PROTOCOL = "https";
const STORAGE_KEY = "arweave_wallet_jwk";

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
  return res.text();
}

async function getPrice(dataSize: number | string, target?: string): Promise<string> {
  let url = `${PROTOCOL}://${HOST}/price/${dataSize}`;
  if (target) url += `/${target}`;
  const res = await fetch(url);
  return res.text();
}

async function getAnchor(): Promise<string> {
  const res = await fetch(`${PROTOCOL}://${HOST}/tx_anchor`);
  return res.text();
}

async function signTx(tx: ArweaveTx, jwk: JsonWebKey) {
  const msg = JSON.stringify({
    owner: tx.owner,
    target: tx.target,
    data: tx.data,
    quantity: tx.quantity,
    reward: tx.reward,
    last_tx: tx.last_tx,
    tags: tx.tags || [],
    data_root: tx.data_root,
    data_size: tx.data_size,
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
/*  COMPONENT                                                          */
/* ================================================================== */

export default function ArweaveWallet() {
  const [wallet, setWallet] = useState<JsonWebKey | null>(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("—");
  const [arTab, setArTab] = useState<"setup" | "info" | "send" | "upload">("setup");

  /* form state */
  const [importKey, setImportKey] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [dataText, setDataText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  /* status per-section */
  const [genStatus, setGenStatus] = useState<StatusMsg | null>(null);
  const [impStatus, setImpStatus] = useState<StatusMsg | null>(null);
  const [expStatus, setExpStatus] = useState<StatusMsg | null>(null);
  const [sendStatus, setSendStatus] = useState<StatusMsg | null>(null);
  const [uploadStatus, setUploadStatus] = useState<StatusMsg | null>(null);

  /* ---- helpers ---- */
  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const winston = await getBalance(addr);
      const ar = (BigInt(winston) / BigInt(10 ** 12)).toString();
      setBalance(ar);
    } catch {
      setBalance("Error");
    }
  }, []);

  const loadWallet = useCallback(
    async (jwk: JsonWebKey) => {
      const addr = await jwkToAddress(jwk);
      setWallet(jwk);
      setAddress(addr);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jwk));
      setArTab("info");
      refreshBalance(addr);
    },
    [refreshBalance],
  );

  /* ---- load saved wallet on mount ---- */
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const jwk = JSON.parse(saved) as JsonWebKey;
        (async () => {
          const addr = await jwkToAddress(jwk);
          setWallet(jwk);
          setAddress(addr);
          refreshBalance(addr);
          setArTab("info");
        })();
      } catch {
        /* ignore */
      }
    }
  }, [refreshBalance]);

  /* ---- actions ---- */
  const handleGenerate = useCallback(async () => {
    setGenStatus({ text: "Generating keypair... (2-3 sec)", type: "loading" });
    try {
      const jwk = await generateKey();
      await loadWallet(jwk);
      setGenStatus({ text: "Generated! Saved to browser.", type: "success" });
    } catch (e: unknown) {
      setGenStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [loadWallet]);

  const handleImport = useCallback(async () => {
    if (!importKey.trim()) { setImpStatus({ text: "Paste JWK", type: "error" }); return; }
    try {
      const jwk = JSON.parse(importKey.trim()) as JsonWebKey;
      await loadWallet(jwk);
      setImpStatus({ text: "Imported & Saved!", type: "success" });
    } catch (e: unknown) {
      setImpStatus({ text: `Invalid JWK: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [importKey, loadWallet]);

  const handleExport = useCallback(() => {
    if (!wallet) { setExpStatus({ text: "No wallet loaded", type: "error" }); return; }
    const blob = new Blob([JSON.stringify(wallet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arweave-wallet-${address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExpStatus({ text: "Downloaded! Check your downloads folder.", type: "success" });
    setTimeout(() => setExpStatus(null), 3000);
  }, [wallet, address]);

  const handleClear = useCallback(() => {
    if (!confirm("Clear wallet from browser storage?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setAddress("");
    setBalance("—");
    setArTab("setup");
  }, []);

  const handleSend = useCallback(async () => {
    if (!wallet) { setSendStatus({ text: "No wallet loaded", type: "error" }); return; }
    if (!target || !amount) { setSendStatus({ text: "Fill fields", type: "error" }); return; }
    setSendStatus({ text: "Sending...", type: "loading" });
    try {
      const anchor = await getAnchor();
      const quantity = BigInt(Math.round(parseFloat(amount) * 10 ** 12)).toString();
      const reward = await getPrice(0, target);
      const tx: ArweaveTx = {
        format: 2,
        owner: wallet.n,
        target,
        quantity,
        reward,
        last_tx: anchor,
        tags: [],
        data_size: "0",
        data_root: "",
      };
      await signTx(tx, wallet);
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
  }, [wallet, target, amount, address, refreshBalance]);

  const handleUpload = useCallback(async () => {
    if (!wallet) { setUploadStatus({ text: "No wallet loaded", type: "error" }); return; }
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
        format: 2,
        owner: wallet.n,
        target: "",
        quantity: "0",
        reward,
        last_tx: anchor,
        tags: [],
        data_size: dataSize,
        data_root: b64urlEncode(dataRoot),
      };
      await signTx(tx, wallet);
      await postTx(tx);

      const chunkSize = 256 * 1024;
      let offset = 0;
      while (offset < data.byteLength) {
        const chunk = data.slice(offset, offset + chunkSize);
        offset += chunk.byteLength;
        const pct = ((offset / data.byteLength) * 100).toFixed(1);
        const chunkB64 = b64urlEncode(chunk);
        await fetch(`${PROTOCOL}://${HOST}/chunk/${tx.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_root: tx.data_root,
            data_size: tx.data_size,
            data_path: "",
            offset: offset - chunk.byteLength,
            chunk: chunkB64,
          }),
        });
        setUploadStatus({ text: `Uploading: ${pct}%`, type: "loading" });
      }
      setUploadStatus({ text: `Uploaded! TX ID: ${tx.id}`, type: "success" });
    } catch (e: unknown) {
      setUploadStatus({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "error" });
    }
  }, [wallet, dataText]);

  /* ---- style helpers ---- */
  const sectionCls = "mb-4 p-3 rounded-xl border border-[rgba(106,13,173,0.2)] bg-[rgba(255,255,255,0.05)]";
  const sectionH3 = "text-[0.95rem] font-medium mb-2.5 text-[#00ff88] flex items-center gap-1.5";
  const inputCls =
    "w-full py-2.5 px-3 rounded-lg bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.2)] text-white font-mono text-xs mb-2 outline-none focus:border-[#00ff88] focus:shadow-[0_0_0_2px_rgba(0,255,136,0.2)] placeholder:text-[#b0b3b8]";
  const btnCls =
    "w-full py-3 rounded-lg text-sm font-medium text-white bg-[#6a0dad] hover:bg-[#8b00ff] hover:-translate-y-px disabled:bg-[rgba(255,255,255,0.1)] disabled:cursor-not-allowed transition-all mb-2 cursor-pointer";
  const btnSecCls =
    "w-full py-3 rounded-lg text-sm font-medium text-[#00ff88] bg-[rgba(0,255,136,0.2)] hover:bg-[rgba(0,255,136,0.3)] transition-all mb-2 cursor-pointer";
  const copyBtnCls =
    "inline-block py-1 px-3 text-xs rounded-lg text-[#00ff88] bg-[rgba(0,255,136,0.2)] hover:bg-[rgba(0,255,136,0.3)] cursor-pointer ml-2 transition-all";

  const renderStatus = (s: StatusMsg | null) => {
    if (!s) return null;
    const colors =
      s.type === "success"
        ? "bg-[rgba(0,255,136,0.2)] text-[#00ff88] border-[rgba(0,255,136,0.3)]"
        : s.type === "error"
          ? "bg-[rgba(255,0,0,0.2)] text-[#ff6b6b] border-[rgba(255,0,0,0.3)]"
          : "bg-[rgba(106,13,173,0.3)] text-white border-[rgba(106,13,173,0.5)]";
    return <div className={`py-2 px-3 my-2 rounded-md text-xs font-medium border ${colors}`}>{s.text}</div>;
  };

  const tabs: { id: typeof arTab; label: string }[] = [
    { id: "setup", label: "Setup" },
    { id: "info", label: "Info" },
    { id: "send", label: "Send AR" },
    { id: "upload", label: "Upload" },
  ];

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div
      className="w-full max-w-[500px] mx-auto rounded-xl overflow-hidden"
      style={{
        background: "#16213e",
        boxShadow: "0 4px 20px rgba(106,13,173,0.3)",
      }}
    >
      {/* Header */}
      <div className="bg-[#6a0dad] py-5 px-5 text-center">
        <h2 className="text-xl font-semibold text-white">Arweave Wallet</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[rgba(255,255,255,0.1)] bg-[rgba(106,13,173,0.2)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setArTab(t.id)}
            className={`flex-1 py-3 text-sm font-medium border-none cursor-pointer transition-all ${
              arTab === t.id
                ? "text-[#00ff88] bg-[rgba(0,255,136,0.1)] border-b-2 border-b-[#00ff88]"
                : "text-[#b0b3b8] bg-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {/* ── Setup Tab ── */}
        {arTab === "setup" && (
          <>
            <div className={sectionCls}>
              <h3 className={sectionH3}>Generate New Wallet</h3>
              <button type="button" onClick={handleGenerate} className={btnCls}>
                Generate Keypair
              </button>
              {renderStatus(genStatus)}
            </div>
            <div className={sectionCls}>
              <h3 className={sectionH3}>Import JWK</h3>
              <textarea
                rows={3}
                value={importKey}
                onChange={(e) => setImportKey(e.target.value)}
                placeholder="Paste JWK JSON here"
                className={inputCls}
                style={{ resize: "vertical" }}
              />
              <button type="button" onClick={handleImport} className={btnCls}>
                Import Key
              </button>
              {renderStatus(impStatus)}
            </div>
          </>
        )}

        {/* ── Info Tab ── */}
        {arTab === "info" && (
          <>
            <div className={sectionCls}>
              <h3 className={sectionH3}>Wallet Details</h3>
              <p className="text-sm mb-1 break-all">
                <strong className="text-white">Address:</strong>{" "}
                <span className="text-[#b0b3b8]">{address || "—"}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (address) navigator.clipboard.writeText(address);
                  }}
                  className={copyBtnCls}
                >
                  Copy
                </button>
              </p>
              <p className="text-sm mb-2">
                <strong className="text-white">Balance:</strong>{" "}
                <span className="text-[#b0b3b8]">{balance} AR</span>
                <button
                  type="button"
                  onClick={() => { if (address) refreshBalance(address); }}
                  className={copyBtnCls}
                >
                  Refresh
                </button>
              </p>
              <pre className="bg-[rgba(0,0,0,0.3)] p-3 rounded-md overflow-auto text-[10px] max-h-[80px] text-[#b0b3b8] border border-[rgba(255,255,255,0.1)]">
                {wallet ? JSON.stringify(wallet, null, 2) : "No wallet loaded"}
              </pre>
              <p className="text-[11px] text-[#b0b3b8] mt-1">
                Warning: Backup your key securely. Never share it.
              </p>
            </div>
            <div className={sectionCls}>
              <h3 className={sectionH3}>Backup</h3>
              <button type="button" onClick={handleExport} className={btnCls}>
                Download Key (.json)
              </button>
              {renderStatus(expStatus)}
            </div>
            <div className={sectionCls}>
              <button type="button" onClick={handleClear} className={btnSecCls}>
                Clear Wallet (Local)
              </button>
            </div>
          </>
        )}

        {/* ── Send Tab ── */}
        {arTab === "send" && (
          <div className={sectionCls}>
            <h3 className={sectionH3}>Send AR</h3>
            <div className="flex gap-2 items-center mb-2">
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Recipient address"
                className={`${inputCls} flex-1 !mb-0`}
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.readText().then((t) => setTarget(t.trim()))}
                className={copyBtnCls}
              >
                Paste
              </button>
            </div>
            <input
              type="number"
              step="0.000000000001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (AR)"
              className={inputCls}
            />
            <button type="button" onClick={handleSend} className={btnCls}>
              Send Transaction
            </button>
            {renderStatus(sendStatus)}
          </div>
        )}

        {/* ── Upload Tab ── */}
        {arTab === "upload" && (
          <div className={sectionCls}>
            <h3 className={sectionH3}>Upload Data</h3>
            <textarea
              rows={2}
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              placeholder="Text data..."
              className={inputCls}
              style={{ resize: "vertical" }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="*/*"
              className="block w-full text-sm text-[#b0b3b8] my-2 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[rgba(106,13,173,0.4)] file:text-white hover:file:bg-[rgba(106,13,173,0.6)]"
            />
            <button type="button" onClick={handleUpload} className={btnCls}>
              Upload to Arweave
            </button>
            {renderStatus(uploadStatus)}
          </div>
        )}
      </div>
    </div>
  );
}
