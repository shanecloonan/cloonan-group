"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet-context";
import AuthPanel from "@/components/auth-panel";
import { RPC_URL } from "@/lib/config";
import Link from "next/link";

/* ------------------------------------------------------------------ */
/*  ENS Registrar Controller (Mainnet)                                 */
/* ------------------------------------------------------------------ */

const REGISTRAR_ADDRESS = "0x283Af0B28c62C092C9727F1Ee09c02CA627EB7F5";
const REGISTRAR_ABI = [
  "function available(string) view returns (bool)",
  "function makeCommitment(string, address, bytes32) pure returns (bytes32)",
  "function commit(bytes32)",
  "function register(string, address, uint256, bytes32) payable",
  "function rentPrice(string, uint256) view returns (uint256)",
];

/* ------------------------------------------------------------------ */
/*  Design tokens (match wallets page)                                 */
/* ------------------------------------------------------------------ */

const card =
  "rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm";
const inputCls =
  "w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 text-sm placeholder:text-white/30 outline-none focus:border-blue-400/60 focus:ring-1 focus:ring-blue-400/30 transition-all";
const selectCls = `${inputCls} appearance-none cursor-pointer`;
const btnPrimary =
  "w-full h-11 rounded-xl font-semibold text-sm bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center";
const btnSmall =
  "h-9 px-4 rounded-xl font-medium text-xs bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all cursor-pointer";
const labelCls =
  "block text-white/40 text-xs font-medium uppercase tracking-wider mb-1.5";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shorten(a: string) {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EnsLogEntry {
  sender: string;
  name: string;
  action: string;
  txHash: string;
  timestamp: string;
}

/* ================================================================== */
/*  ENS App Component                                                  */
/* ================================================================== */

export default function EnsApp() {
  const {
    user,
    vaultUnlocked,
    ethWallets,
    selectedEthWallet,
    selectedEthAddress,
    selectEthWallet,
    addEthWallet,
    connectMetaMask: ctxConnectMetaMask,
    isLoading,
  } = useWallet();

  const provider = useMemo(
    () => new ethers.providers.JsonRpcProvider(RPC_URL),
    [],
  );

  const selected = selectedEthWallet;

  const [ensName, setEnsName] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<
    "idle" | "info" | "success" | "error"
  >("idle");
  const [ensLog, setEnsLog] = useState<EnsLogEntry[]>([]);

  const [canCheck, setCanCheck] = useState(false);
  const [canCommit, setCanCommit] = useState(false);
  const [canRegister, setCanRegister] = useState(false);

  const commitmentSecretRef = useRef<string | null>(null);
  const commitmentTimestampRef = useRef<number | null>(null);

  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState("Processing...");
  const [popupAddress, setPopupAddress] = useState<string | null>(null);
  const [popupDone, setPopupDone] = useState(false);

  useEffect(() => {
    try {
      setEnsLog(JSON.parse(localStorage.getItem("ensLog") || "[]"));
    } catch {
      /* empty */
    }
  }, []);

  useEffect(() => {
    setCanCheck(!!selected);
    setCanCommit(false);
    setCanRegister(false);
  }, [selected]);

  /* ---------------------------------------------------------------- */
  /*  Popup helpers                                                    */
  /* ---------------------------------------------------------------- */

  const openPopup = useCallback((msg: string) => {
    setPopupMessage(msg);
    setPopupAddress(null);
    setPopupDone(false);
    setShowPopup(true);
  }, []);

  const finishPopup = useCallback((msg: string, addr?: string) => {
    setPopupMessage(msg);
    if (addr) setPopupAddress(addr);
    setPopupDone(true);
  }, []);

  const closePopup = useCallback(() => setShowPopup(false), []);

  /* ---------------------------------------------------------------- */
  /*  Build signer for selected wallet                                 */
  /* ---------------------------------------------------------------- */

  const getSigner = useCallback(() => {
    if (!selected) return null;
    if (selected.type === "metamask" && typeof window !== "undefined" && window.ethereum) {
      const web3 = new ethers.providers.Web3Provider(
        window.ethereum as ethers.providers.ExternalProvider,
      );
      return web3.getSigner();
    }
    if (selected.privateKey) {
      return new ethers.Wallet(selected.privateKey, provider);
    }
    return null;
  }, [selected, provider]);

  /* ---------------------------------------------------------------- */
  /*  Connect MetaMask                                                 */
  /* ---------------------------------------------------------------- */

  const handleConnectMetaMask = useCallback(async () => {
    openPopup("Connecting MetaMask...");
    try {
      const addr = await ctxConnectMetaMask();
      finishPopup("MetaMask connected successfully", addr);
    } catch (e: unknown) {
      finishPopup(
        `Failed to connect: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [ctxConnectMetaMask, openPopup, finishPopup]);

  /* ---------------------------------------------------------------- */
  /*  Create MoneyFund wallet                                          */
  /* ---------------------------------------------------------------- */

  const createMoneyFundWallet = useCallback(async () => {
    openPopup("Creating MoneyFund Wallet...");
    try {
      const wallet = ethers.Wallet.createRandom();
      await addEthWallet({
        address: wallet.address,
        privateKey: wallet.privateKey,
        type: "moneyfund",
      });
      selectEthWallet(wallet.address);
      finishPopup("MoneyFund Wallet created successfully", wallet.address);
    } catch (e: unknown) {
      finishPopup(
        `Failed to create wallet: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [addEthWallet, selectEthWallet, openPopup, finishPopup]);

  /* ---------------------------------------------------------------- */
  /*  ENS actions                                                      */
  /* ---------------------------------------------------------------- */

  const checkAvailability = useCallback(async () => {
    if (!selected) {
      setStatus("Please select a wallet first.");
      setStatusType("error");
      return;
    }
    const name = ensName.trim();
    if (!name) {
      setStatus("Enter a name.");
      setStatusType("error");
      return;
    }

    setStatus("Checking availability...");
    setStatusType("info");

    try {
      const signer = getSigner();
      if (!signer) throw new Error("No signer available for selected wallet");
      const registrar = new ethers.Contract(
        REGISTRAR_ADDRESS,
        REGISTRAR_ABI,
        signer,
      );

      const isAvailable = await registrar.available(name);
      const duration = 31536000; // 1 year
      const price = await registrar.rentPrice(name, duration);

      if (isAvailable) {
        setStatus(
          `Available! Price: ${ethers.utils.formatEther(price)} ETH for 1 year`,
        );
        setStatusType("success");
        setCanCommit(true);
        setCanRegister(false);
      } else {
        setStatus("Name is taken!");
        setStatusType("error");
        setCanCommit(false);
        setCanRegister(false);
      }
    } catch (e: unknown) {
      setStatus(
        `Error checking availability: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatusType("error");
    }
  }, [selected, ensName, getSigner]);

  const commitName = useCallback(async () => {
    if (!selected) {
      setStatus("Please select a wallet first.");
      setStatusType("error");
      return;
    }
    const name = ensName.trim();
    if (!name) {
      setStatus("Enter a name.");
      setStatusType("error");
      return;
    }

    setStatus("Preparing commitment...");
    setStatusType("info");

    try {
      const signer = getSigner();
      if (!signer) throw new Error("No signer available for selected wallet");
      const registrar = new ethers.Contract(
        REGISTRAR_ADDRESS,
        REGISTRAR_ABI,
        signer,
      );

      const secret = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      commitmentSecretRef.current = secret;

      const commitment = await registrar.makeCommitment(
        name,
        selected.address,
        secret,
      );

      setStatus("Sending commitment...");
      const tx = await registrar.commit(commitment);
      const receipt = await tx.wait();
      const txHash = receipt.transactionHash;

      commitmentTimestampRef.current = Date.now();

      setStatus(
        `Commitment sent! Tx: ${shorten(txHash)} — Wait 60 seconds before registering.`,
      );
      setStatusType("success");
      setCanCommit(false);

      setTimeout(() => {
        setCanRegister(true);
        setStatus((prev) => prev + " Ready to register!");
      }, 60000);

      logEnsAction(selected.address, name, "Committed", txHash);
    } catch (e: unknown) {
      setStatus(
        `Error committing name: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatusType("error");
    }
  }, [selected, ensName, getSigner]);

  const registerName = useCallback(async () => {
    if (!selected) {
      setStatus("Please select a wallet first.");
      setStatusType("error");
      return;
    }
    const name = ensName.trim();
    if (!name) {
      setStatus("Enter a name.");
      setStatusType("error");
      return;
    }
    if (
      !commitmentTimestampRef.current ||
      Date.now() - commitmentTimestampRef.current < 60000
    ) {
      setStatus("Please wait 60 seconds after committing!");
      setStatusType("error");
      return;
    }
    if (!commitmentSecretRef.current) {
      setStatus("No commitment found. Please commit again.");
      setStatusType("error");
      return;
    }

    setStatus("Registering...");
    setStatusType("info");

    try {
      const signer = getSigner();
      if (!signer) throw new Error("No signer available for selected wallet");
      const registrar = new ethers.Contract(
        REGISTRAR_ADDRESS,
        REGISTRAR_ABI,
        signer,
      );

      const duration = 31536000;
      const price = await registrar.rentPrice(name, duration);

      const tx = await registrar.register(
        name,
        selected.address,
        duration,
        commitmentSecretRef.current,
        { value: price },
      );
      const receipt = await tx.wait();
      const txHash = receipt.transactionHash;

      setStatus(`${name}.eth registered successfully! Tx: ${shorten(txHash)}`);
      setStatusType("success");
      setCanCommit(true);
      setCanRegister(false);
      commitmentTimestampRef.current = null;
      commitmentSecretRef.current = null;

      logEnsAction(selected.address, name, "Registered", txHash);
    } catch (e: unknown) {
      setStatus(
        `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      setStatusType("error");
    }
  }, [selected, ensName, getSigner]);

  /* ---------------------------------------------------------------- */
  /*  ENS Log                                                          */
  /* ---------------------------------------------------------------- */

  const logEnsAction = useCallback(
    (sender: string, name: string, action: string, txHash: string) => {
      const entry: EnsLogEntry = {
        sender,
        name: `${name}.eth`,
        action,
        txHash,
        timestamp: new Date().toISOString(),
      };
      setEnsLog((prev) => {
        const next = [...prev, entry];
        localStorage.setItem("ensLog", JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#08090e" }}
      >
        <p className="text-white/30 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!user || !vaultUnlocked) {
    return (
      <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
        <div className="w-full max-w-[720px] mx-auto space-y-5">
          <div className="text-center pt-4 pb-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
              ENS Domain Registration
            </h1>
            <p className="text-xs text-white/30 mt-1">
              Sign in to access ENS registration
            </p>
          </div>
          <AuthPanel inline />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ background: "#08090e" }}>
      <div className="w-full max-w-[600px] mx-auto space-y-5">
        {/* Header */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">
            ENS Domain Registration
          </h1>
          <p className="text-xs text-white/30 mt-1">
            Register .eth names on Ethereum Mainnet
          </p>
          <Link
            href="/wallets"
            className="inline-block mt-2 text-xs text-blue-400/60 hover:text-blue-400 transition-colors"
          >
            ← Back to Wallets
          </Link>
        </div>

        {/* Wallet selection */}
        <div className={`${card} p-5 space-y-4`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">
              Wallet
            </span>
            <button
              type="button"
              onClick={handleConnectMetaMask}
              className={`${btnSmall} text-[10px]`}
            >
              {selected?.type === "metamask"
                ? "MetaMask Connected"
                : "Connect MetaMask"}
            </button>
          </div>

          <select
            value={selectedEthAddress ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) selectEthWallet(null);
              else selectEthWallet(v);
            }}
            className={selectCls}
          >
            <option value="">-- Select Wallet --</option>
            {ethWallets.map((w) => (
              <option key={w.address} value={w.address}>
                {shorten(w.address)} ({w.type})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={createMoneyFundWallet}
            className={btnPrimary}
          >
            Create MoneyFund Wallet
          </button>
        </div>

        {/* ENS form */}
        <div className={`${card} p-5 space-y-4`}>
          <div>
            <label className={labelCls}>ENS Name (without .eth)</label>
            <input
              type="text"
              value={ensName}
              onChange={(e) => setEnsName(e.target.value)}
              placeholder="e.g., example"
              className={inputCls}
            />
          </div>

          <button
            type="button"
            onClick={checkAvailability}
            disabled={!canCheck}
            className={btnPrimary}
          >
            Check Availability
          </button>

          <button
            type="button"
            onClick={commitName}
            disabled={!canCommit}
            className={btnPrimary}
          >
            Commit Name
          </button>

          <button
            type="button"
            onClick={registerName}
            disabled={!canRegister}
            className={btnPrimary}
          >
            Register Name
          </button>
        </div>

        {/* Status */}
        {status && (
          <div
            className={`${card} p-4 text-sm break-words ${
              statusType === "success"
                ? "text-emerald-400"
                : statusType === "error"
                  ? "text-red-400"
                  : statusType === "info"
                    ? "text-blue-400"
                    : "text-white/60"
            }`}
          >
            {status}
          </div>
        )}

        {/* ENS Log */}
        {ensLog.length > 0 && (
          <div className={`${card} p-4 space-y-2 max-h-[260px] overflow-y-auto`} style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">
              History
            </span>
            {ensLog.map((entry, i) => (
              <div
                key={i}
                className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/70">
                    Action #{i + 1}
                  </span>
                  <span className="text-[10px] text-white/25">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-white/50">
                  <span className="text-white/30">Sender:</span>{" "}
                  <span className="font-mono">{shorten(entry.sender)}</span>
                </p>
                <p className="text-xs text-white/50">
                  <span className="text-white/30">Name:</span> {entry.name}
                </p>
                <p className="text-xs text-white/50">
                  <span className="text-white/30">Action:</span> {entry.action}
                </p>
                <p className="text-xs text-white/50">
                  <span className="text-white/30">Tx:</span>{" "}
                  <a
                    href={`https://etherscan.io/tx/${entry.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400/60 hover:text-indigo-400 font-mono transition-colors"
                  >
                    {shorten(entry.txHash)}
                  </a>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection popup */}
      {showPopup && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[999]"
            onClick={popupDone ? closePopup : undefined}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1001] w-[90%] max-w-[400px] rounded-2xl border border-white/[0.06] bg-[#111827]/95 p-6 text-center backdrop-blur-sm">
            {!popupDone ? (
              <div className="w-12 h-12 border-4 border-white/15 border-t-blue-500 rounded-full animate-spin mx-auto" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-500 text-white text-2xl leading-[48px] mx-auto">
                ✓
              </div>
            )}
            <h3 className="mt-4 text-lg font-semibold text-white">
              {popupMessage}
            </h3>
            {popupAddress && (
              <p className="mt-1 text-sm text-white/50">
                Address: {shorten(popupAddress)}
              </p>
            )}
            {popupDone && (
              <button
                type="button"
                onClick={closePopup}
                className={`mt-5 ${btnPrimary}`}
              >
                Close
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
