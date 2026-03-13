export interface EthWallet {
  address: string;
  privateKey?: string;
  type: "moneyfund" | "metamask";
}

export interface ArweaveWalletData {
  jwk: JsonWebKey;
  address: string;
}

export interface WalletRow {
  id: string;
  user_id: string;
  chain: "ethereum" | "arweave";
  address: string;
  encrypted_key: string | null;
  iv: string | null;
  wallet_type: string;
  label: string | null;
  created_at: string;
}
