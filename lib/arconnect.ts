/**
 * ArConnect (Wander) browser wallet integration.
 *
 * ArConnect injects `window.arweaveWallet` — we detect it, request
 * permissions, and provide a unified interface that matches the existing
 * JWK wallet flow.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ArConnectPermission =
  | "ACCESS_ADDRESS"
  | "ACCESS_PUBLIC_KEY"
  | "ACCESS_ALL_ADDRESSES"
  | "SIGN_TRANSACTION"
  | "ENCRYPT"
  | "DECRYPT"
  | "SIGNATURE"
  | "ACCESS_ARWEAVE_CONFIG"
  | "DISPATCH"
  | "ACCESS_TOKENS";

interface ArConnectAppInfo {
  name?: string;
  logo?: string;
}

export interface ArConnectWalletInfo {
  address: string;
  publicKey: string;
  walletName: string;
}

export interface DispatchResult {
  id: string;
  type?: "BASE" | "BUNDLED";
}

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

export function isArConnectAvailable(): boolean {
  return typeof window !== "undefined" && !!window.arweaveWallet;
}

/**
 * Waits for ArConnect to inject `window.arweaveWallet`.
 * Returns true if detected within the timeout.
 */
export function waitForArConnect(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (isArConnectAvailable()) {
      resolve(true);
      return;
    }

    const handler = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      window.removeEventListener("arweaveWalletLoaded", handler);
      resolve(false);
    }, timeoutMs);

    window.addEventListener("arweaveWalletLoaded", handler, { once: true });
  });
}

/* ------------------------------------------------------------------ */
/*  Connection                                                         */
/* ------------------------------------------------------------------ */

const REQUIRED_PERMISSIONS: ArConnectPermission[] = [
  "ACCESS_ADDRESS",
  "ACCESS_PUBLIC_KEY",
  "SIGN_TRANSACTION",
  "DISPATCH",
];

const APP_INFO: ArConnectAppInfo = {
  name: "MoneyFund",
};

export async function connectArConnect(): Promise<ArConnectWalletInfo> {
  if (!isArConnectAvailable()) {
    throw new Error("ArConnect / Wander extension not detected. Install it at arconnect.io");
  }

  await window.arweaveWallet.connect(REQUIRED_PERMISSIONS, APP_INFO);

  const address = await window.arweaveWallet.getActiveAddress();
  const publicKey = await window.arweaveWallet.getActivePublicKey();
  const walletName = window.arweaveWallet.walletName ?? "ArConnect";

  return { address, publicKey, walletName };
}

export async function disconnectArConnect(): Promise<void> {
  if (!isArConnectAvailable()) return;
  try {
    await window.arweaveWallet.disconnect();
  } catch {
    // may throw if not connected
  }
}

export async function getArConnectAddress(): Promise<string | null> {
  if (!isArConnectAvailable()) return null;
  try {
    return await window.arweaveWallet.getActiveAddress();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Transaction dispatch (bundled upload via ArConnect)                 */
/* ------------------------------------------------------------------ */

/**
 * Dispatches a transaction through ArConnect. This automatically bundles
 * the transaction for instant finality using the user's preferred bundler.
 * Falls back to base layer if bundling fails.
 *
 * Requires an arweave-js Transaction object. Since we don't use arweave-js,
 * we build a minimal transaction-like object.
 */
export async function dispatchTransaction(
  data: Uint8Array,
  tags: { name: string; value: string }[],
): Promise<DispatchResult> {
  if (!isArConnectAvailable()) {
    throw new Error("ArConnect not available");
  }

  // ArConnect dispatch expects an arweave-js Transaction object.
  // We create a minimal compatible object.
  const tx = {
    format: 2,
    id: "",
    last_tx: "",
    owner: "",
    tags: tags.map((t) => ({
      name: btoa(t.name),
      value: btoa(t.value),
    })),
    target: "",
    quantity: "0",
    data: bufferToB64Url(data),
    data_size: data.byteLength.toString(),
    data_root: "",
    reward: "0",
    signature: "",
  };

  return window.arweaveWallet.dispatch(tx) as Promise<DispatchResult>;
}

function bufferToB64Url(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/* ------------------------------------------------------------------ */
/*  Window type augmentation                                           */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    arweaveWallet: {
      connect: (permissions: ArConnectPermission[], appInfo?: ArConnectAppInfo, gateway?: { host: string; port: number; protocol: string }) => Promise<void>;
      disconnect: () => Promise<void>;
      getActiveAddress: () => Promise<string>;
      getActivePublicKey: () => Promise<string>;
      getAllAddresses: () => Promise<string[]>;
      sign: (transaction: unknown, options?: unknown) => Promise<unknown>;
      dispatch: (transaction: unknown) => Promise<unknown>;
      walletName?: string;
      walletVersion?: string;
    };
  }
}
