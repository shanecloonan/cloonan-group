"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  deriveVaultKey,
  exportVaultKey,
  importVaultKey,
  encrypt,
  decrypt,
  createKeyCheck,
  verifyKeyCheck,
} from "./crypto";
import type { EthWallet, ArweaveWalletData, WalletRow } from "./wallet-types";

const VAULT_KEY_SESSION = "mf_vault_key";

interface WalletContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;

  signUp: (email: string, password: string) => Promise<string | null>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;

  vaultUnlocked: boolean;
  unlockVault: (password: string) => Promise<boolean>;

  ethWallets: EthWallet[];
  selectedEthAddress: string | null;
  selectedEthWallet: EthWallet | null;
  selectEthWallet: (address: string | null) => void;
  addEthWallet: (w: { address: string; privateKey?: string; type: "moneyfund" | "metamask" }) => Promise<void>;
  removeEthWallet: (address: string) => Promise<void>;
  connectMetaMask: () => Promise<string>;

  arweaveWallet: ArweaveWalletData | null;
  setArweaveWallet: (jwk: JsonWebKey | null) => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const vaultKeyRef = useRef<CryptoKey | null>(null);

  const [ethWallets, setEthWallets] = useState<EthWallet[]>([]);
  const [selectedEthAddress, setSelectedEthAddress] = useState<string | null>(null);
  const [arweaveWallet, setArweaveWalletState] = useState<ArweaveWalletData | null>(null);

  const selectedEthWallet = useMemo(
    () => ethWallets.find((w) => w.address === selectedEthAddress) ?? null,
    [ethWallets, selectedEthAddress],
  );

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  const loadWalletsFromDb = useCallback(
    async (uid: string, key: CryptoKey) => {
      const { data: rows } = await supabase
        .from("user_wallets")
        .select("*")
        .eq("user_id", uid);

      if (!rows) return;

      const eth: EthWallet[] = [];
      let ar: ArweaveWalletData | null = null;

      for (const r of rows as WalletRow[]) {
        if (r.chain === "ethereum") {
          let pk: string | undefined;
          if (r.encrypted_key && r.iv) {
            try {
              pk = await decrypt(r.encrypted_key, r.iv, key);
            } catch {
              /* key mismatch – skip decryption */
            }
          }
          eth.push({
            address: r.address,
            privateKey: pk,
            type: r.wallet_type as "moneyfund" | "metamask",
          });
        } else if (r.chain === "arweave" && r.encrypted_key && r.iv) {
          try {
            const raw = await decrypt(r.encrypted_key, r.iv, key);
            const jwk = JSON.parse(raw) as JsonWebKey;
            ar = { jwk, address: r.address };
          } catch {
            /* key mismatch */
          }
        }
      }
      setEthWallets(eth);
      setArweaveWalletState(ar);

      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("selected_eth_address, selected_ar_address")
        .eq("user_id", uid)
        .maybeSingle();

      if (prefs?.selected_eth_address && eth.some((w) => w.address === prefs.selected_eth_address)) {
        setSelectedEthAddress(prefs.selected_eth_address);
      } else if (eth.length > 0) {
        setSelectedEthAddress(eth[0].address);
      }
    },
    [],
  );

  const storeVaultKey = useCallback(async (key: CryptoKey) => {
    vaultKeyRef.current = key;
    setVaultUnlocked(true);
    try {
      const exported = await exportVaultKey(key);
      sessionStorage.setItem(VAULT_KEY_SESSION, exported);
    } catch { /* sessionStorage unavailable */ }
  }, []);

  const clearVaultKey = useCallback(() => {
    vaultKeyRef.current = null;
    setVaultUnlocked(false);
    setEthWallets([]);
    setArweaveWalletState(null);
    setSelectedEthAddress(null);
    try { sessionStorage.removeItem(VAULT_KEY_SESSION); } catch {}
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Auth bootstrap                                                     */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (s?.user) {
        setUser(s.user);
        setSession(s);

        try {
          const cached = sessionStorage.getItem(VAULT_KEY_SESSION);
          if (cached) {
            const key = await importVaultKey(cached);
            vaultKeyRef.current = key;
            setVaultUnlocked(true);
            await loadWalletsFromDb(s.user.id, key);
          }
        } catch { /* session key invalid or missing */ }
      }
      setIsLoading(false);
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) clearVaultKey();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadWalletsFromDb, clearVaultKey]);

  /* ------------------------------------------------------------------ */
  /*  Auth actions                                                       */
  /* ------------------------------------------------------------------ */

  const signUp = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return error.message;
      if (!data.user) return "Signup failed";

      const key = await deriveVaultKey(password, data.user.id);
      await storeVaultKey(key);

      const keyCheck = await createKeyCheck(key);
      await supabase.from("user_preferences").upsert({
        user_id: data.user.id,
        key_check: keyCheck,
        updated_at: new Date().toISOString(),
      });

      return null;
    },
    [storeVaultKey],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      if (!data.user) return "Login failed";

      const key = await deriveVaultKey(password, data.user.id);
      await storeVaultKey(key);
      await loadWalletsFromDb(data.user.id, key);
      return null;
    },
    [storeVaultKey, loadWalletsFromDb],
  );

  const signOut = useCallback(async () => {
    clearVaultKey();
    await supabase.auth.signOut();
  }, [clearVaultKey]);

  const unlockVault = useCallback(
    async (password: string): Promise<boolean> => {
      if (!user) return false;
      const key = await deriveVaultKey(password, user.id);

      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("key_check")
        .eq("user_id", user.id)
        .maybeSingle();

      if (prefs?.key_check) {
        const ok = await verifyKeyCheck(prefs.key_check, key);
        if (!ok) return false;
      }

      await storeVaultKey(key);
      await loadWalletsFromDb(user.id, key);
      return true;
    },
    [user, storeVaultKey, loadWalletsFromDb],
  );

  /* ------------------------------------------------------------------ */
  /*  Wallet CRUD                                                        */
  /* ------------------------------------------------------------------ */

  const selectEthWallet = useCallback(
    (address: string | null) => {
      setSelectedEthAddress(address);
      if (user) {
        supabase
          .from("user_preferences")
          .upsert({
            user_id: user.id,
            selected_eth_address: address,
            updated_at: new Date().toISOString(),
          })
          .then();
      }
    },
    [user],
  );

  const addEthWallet = useCallback(
    async (w: { address: string; privateKey?: string; type: "moneyfund" | "metamask" }) => {
      if (!user || !vaultKeyRef.current) return;

      let enc: string | null = null;
      let iv: string | null = null;
      if (w.privateKey) {
        const result = await encrypt(w.privateKey, vaultKeyRef.current);
        enc = result.ciphertext;
        iv = result.iv;
      }

      await supabase.from("user_wallets").upsert(
        {
          user_id: user.id,
          chain: "ethereum",
          address: w.address,
          encrypted_key: enc,
          iv,
          wallet_type: w.type,
        },
        { onConflict: "user_id,address,chain" },
      );

      const updated = [...ethWallets.filter((e) => e.address !== w.address), {
        address: w.address,
        privateKey: w.privateKey,
        type: w.type,
      }];
      setEthWallets(updated);

      if (!selectedEthAddress) setSelectedEthAddress(w.address);
    },
    [user, ethWallets, selectedEthAddress],
  );

  const removeEthWallet = useCallback(
    async (address: string) => {
      if (!user) return;
      await supabase
        .from("user_wallets")
        .delete()
        .eq("user_id", user.id)
        .eq("address", address)
        .eq("chain", "ethereum");

      const updated = ethWallets.filter((w) => w.address !== address);
      setEthWallets(updated);
      if (selectedEthAddress === address) {
        setSelectedEthAddress(updated[0]?.address ?? null);
      }
    },
    [user, ethWallets, selectedEthAddress],
  );

  const connectMetaMask = useCallback(async (): Promise<string> => {
    if (typeof window === "undefined" || !window.ethereum) throw new Error("Install MetaMask");
    const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
    const addr = accounts[0];
    await addEthWallet({ address: addr, type: "metamask" });
    selectEthWallet(addr);
    return addr;
  }, [addEthWallet, selectEthWallet]);

  const setArweaveWallet = useCallback(
    async (jwk: JsonWebKey | null) => {
      if (!user || !vaultKeyRef.current) return;

      if (!jwk) {
        await supabase
          .from("user_wallets")
          .delete()
          .eq("user_id", user.id)
          .eq("chain", "arweave");
        setArweaveWalletState(null);
        return;
      }

      const raw = JSON.stringify(jwk);
      const { ciphertext, iv } = await encrypt(raw, vaultKeyRef.current);

      const n = jwk.n!;
      const nBytes = Uint8Array.from(atob(n.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const hashBuf = await crypto.subtle.digest("SHA-256", nBytes);
      const hashArr = new Uint8Array(hashBuf);
      const address = btoa(String.fromCharCode(...hashArr))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await supabase.from("user_wallets").upsert(
        {
          user_id: user.id,
          chain: "arweave",
          address,
          encrypted_key: ciphertext,
          iv,
          wallet_type: "arweave",
        },
        { onConflict: "user_id,address,chain" },
      );

      setArweaveWalletState({ jwk, address });
    },
    [user],
  );

  /* ------------------------------------------------------------------ */
  /*  Context value                                                      */
  /* ------------------------------------------------------------------ */

  const value = useMemo<WalletContextValue>(
    () => ({
      user,
      session,
      isLoading,
      signUp,
      signIn,
      signOut,
      vaultUnlocked,
      unlockVault,
      ethWallets,
      selectedEthAddress,
      selectedEthWallet,
      selectEthWallet,
      addEthWallet,
      removeEthWallet,
      connectMetaMask,
      arweaveWallet,
      setArweaveWallet,
    }),
    [
      user, session, isLoading, signUp, signIn, signOut,
      vaultUnlocked, unlockVault,
      ethWallets, selectedEthAddress, selectedEthWallet,
      selectEthWallet, addEthWallet, removeEthWallet, connectMetaMask,
      arweaveWallet, setArweaveWallet,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
