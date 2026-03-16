const INFURA_KEY = process.env.NEXT_PUBLIC_INFURA_KEY || "cf2916fb6dbc47ae824d6f36db817b73";
const ETHERSCAN_KEY = process.env.NEXT_PUBLIC_ETHERSCAN_KEY || "MB89VXUF27QJHA7QYJMPE9W55UGYZNV39C";

export const RPC_URL = `https://mainnet.infura.io/v3/${INFURA_KEY}`;
export const RPC_ENDPOINTS = [
  RPC_URL,
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
];
export const ETHERSCAN_API_KEY = ETHERSCAN_KEY;
export const ETHERSCAN_BASE_URL = "https://api.etherscan.io/api";
export const EXPECTED_CHAIN_ID = 1;

/* ------------------------------------------------------------------ */
/*  Arweave Gateway                                                    */
/* ------------------------------------------------------------------ */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://xvjqxjakckkbfsdrntwk.supabase.co";

export const ARWEAVE_GATEWAY_URL = `${SUPABASE_URL}/functions/v1/arweave-gateway`;

export const ARWEAVE_DIRECT_GATEWAYS = [
  "https://arweave.net",
  "https://ar-io.net",
  "https://arweave.dev",
];

/* ------------------------------------------------------------------ */
/*  Turbo (bundled uploads via ar.io)                                  */
/* ------------------------------------------------------------------ */

export const TURBO_UPLOAD_URL = "https://upload.ardrive.io";
export const TURBO_PAYMENT_URL = "https://payment.ardrive.io";
