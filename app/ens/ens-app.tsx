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

  const [activeStep, setActiveStep] = useState<"check" | "commit" | "register">("check");

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

  const stepBtns: { id: "check" | "commit" | "register"; label: string; icon: string }[] = [
    { id: "check", label: "Check", icon: "🔍" },
    { id: "commit", label: "Commit", icon: "📝" },
    { id: "register", label: "Register", icon: "✓" },
  ];

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
              ENS Registrar
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
      <div className="w-full max-w-[720px] mx-auto space-y-5">

        {/* ── Page title + account ── */}
        <div className="text-center pt-4 pb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white/90">ENS Registrar</h1>
          <p className="text-xs text-white/30 mt-1">
            {user.email}
            <span className="mx-1.5 text-white/10">·</span>
            <Link href="/wallets" className="text-blue-400/60 hover:text-blue-400 transition-colors">
              Wallets
            </Link>
          </p>
        </div>

        {/* ── Wallet selector (matches wallets home) ── */}
        <div className={`${card} p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Active Wallet</span>
            <button
              type="button"
              onClick={handleConnectMetaMask}
              className={btnSmall}
            >
              {selected?.type === "metamask" ? "MetaMask ✓" : "MetaMask"}
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={selectedEthAddress ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) selectEthWallet(null);
                else selectEthWallet(v);
              }}
              className={`flex-1 ${selectCls}`}
            >
              <option value="">Select a wallet...</option>
              {ethWallets.map((w) => (
                <option key={w.address} value={w.address}>{shorten(w.address)} ({w.type})</option>
              ))}
            </select>
            <button type="button" onClick={createMoneyFundWallet} className={btnSmall}>Create</button>
          </div>
        </div>

        {/* ── Connected info ── */}
        {selected && (
          <div className={`${card} p-5`}>
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider">Connected</span>
            <p className="mt-2 text-lg font-bold text-white tracking-tight font-mono">{shorten(selected.address)}</p>
            <p className="text-xs text-white/25 mt-0.5">{selected.type} wallet</p>
          </div>
        )}

        {/* ── ENS Name input ── */}
        <div className={`${card} p-5 space-y-3`}>
          <h3 className="text-sm font-semibold text-white/80">Domain Name</h3>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={ensName}
              onChange={(e) => setEnsName(e.target.value)}
              placeholder="yourname"
              className={`flex-1 ${inputCls}`}
            />
            <span className="text-sm font-semibold text-white/30 shrink-0">.eth</span>
          </div>
        </div>

        {/* ── Step toggle bar (matches wallets action buttons) ── */}
        <div className={`${card} p-1.5 flex gap-1`}>
          {stepBtns.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveStep(s.id)}
              className={`flex-1 h-10 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeStep === s.id
                  ? "bg-blue-500/15 text-blue-400 shadow-[inset_0_1px_0_rgba(59,130,246,0.2)]"
                  : "text-white/40 hover:text-white/60 hover:bg-white/[0.03]"
              }`}
            >
              <span className="text-xs opacity-60">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Check panel ── */}
        {activeStep === "check" && (
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-white/80">Check Availability</h3>
            <p className="text-xs text-white/30">Look up whether the name is available and see the registration price for 1 year.</p>
            <button
              type="button"
              onClick={checkAvailability}
              disabled={!canCheck}
              className={btnPrimary}
            >
              Check Availability
            </button>
          </div>
        )}

        {/* ── Commit panel ── */}
        {activeStep === "commit" && (
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-white/80">Commit Name</h3>
            <p className="text-xs text-white/30">Submit a commitment hash on-chain. After 60 seconds you can complete registration.</p>
            <button
              type="button"
              onClick={commitName}
              disabled={!canCommit}
              className={btnPrimary}
            >
              Commit
            </button>
          </div>
        )}

        {/* ── Register panel ── */}
        {activeStep === "register" && (
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-white/80">Register Name</h3>
            <p className="text-xs text-white/30">Finalize the registration. This sends the payment and records the name to your address.</p>
            <button
              type="button"
              onClick={registerName}
              disabled={!canRegister}
              className={btnPrimary}
            >
              Register
            </button>
          </div>
        )}

        {/* ── Status log (matches wallets status log) ── */}
        {status && (
          <div className={`${card} p-4 max-h-[240px] overflow-y-auto space-y-1`} style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            <div
              className={`text-xs py-2 px-3 rounded-lg ${
                statusType === "success"
                  ? "text-emerald-400 bg-emerald-500/5"
                  : statusType === "error"
                    ? "text-red-400 bg-red-500/5"
                    : statusType === "info"
                      ? "text-blue-400 bg-blue-500/5"
                      : "text-white/50 bg-white/[0.02]"
              }`}
            >
              {status}
            </div>
          </div>
        )}

        {/* ── ENS History (matches wallets activity style) ── */}
        {ensLog.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-white/30 uppercase tracking-wider ml-1">History</span>
            {ensLog.map((entry, i) => (
              <div key={i} className={`${card} px-4 py-3 flex items-center gap-3`}>
                <span className="text-lg shrink-0 text-blue-400/60">🌐</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-white/80 truncate">{entry.action}: {entry.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-white/25 font-mono">{shorten(entry.sender)}</span>
                    {entry.txHash && (
                      <>
                        <span className="text-white/10">·</span>
                        <a
                          href={`https://etherscan.io/tx/${entry.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-indigo-400/60 hover:text-indigo-400 font-mono transition-colors"
                        >
                          {entry.txHash.slice(0, 10)}…
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-white/20 shrink-0">{new Date(entry.timestamp).toLocaleDateString()}</span>
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
