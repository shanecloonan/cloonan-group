export const MANAGER_ADDRESS = "0x6B440ADBA6085b68e2677Ce77dC65bbAc39005d8";

export { RPC_ENDPOINTS } from "@/lib/config";

export const TOKEN_COLORS = [
  "#14B8A6", "#34D399", "#FBBF24", "#F87171", "#A78BFA", "#FCD34D", "#4ADE80", "#F472B6",
  "#60A5FA", "#22D3EE", "#F59E0B", "#EF4444", "#8B5CF6", "#FDE68A", "#6EE7B7", "#FB923C",
  "#93C5FD", "#FCA5A5", "#10B981", "#D4D4D8", "#2DD4BF", "#FDA4AF", "#67E8F9", "#FACC15",
  "#F871A1", "#C4B5FD", "#BEF264", "#6B7280", "#EC4899", "#3B82F6", "#F43F5E", "#10B981",
];

export const managerAbi = [
  {
    inputs: [],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "address", name: "etfToken", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "ethReceived", type: "uint256" },
    ],
    name: "Burned",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "creator", type: "address" },
      { indexed: true, internalType: "address", name: "etfToken", type: "address" },
    ],
    name: "ETFCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "address", name: "etfToken", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "ethUsed", type: "uint256" },
    ],
    name: "Minted",
    type: "event",
  },
  {
    inputs: [
      { internalType: "address", name: "etfToken", type: "address" },
      { internalType: "uint256", name: "etfAmount", type: "uint256" },
    ],
    name: "burn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "name", type: "string" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "address[]", name: "tokens", type: "address[]" },
      { internalType: "uint256[]", name: "weights", type: "uint256[]" },
      { internalType: "address", name: "thirdFeeReceiver", type: "address" },
      { internalType: "uint256", name: "thirdFeeBps", type: "uint256" },
    ],
    name: "createETF",
    outputs: [{ internalType: "address", name: "etfToken", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllETFs",
    outputs: [
      {
        components: [
          { internalType: "address", name: "etfToken", type: "address" },
          { internalType: "address[]", name: "tokens", type: "address[]" },
          { internalType: "uint256[]", name: "weights", type: "uint256[]" },
          { internalType: "uint256", name: "currentPrice", type: "uint256" },
          { internalType: "int256", name: "percentAppreciation", type: "int256" },
          { internalType: "address", name: "thirdFeeReceiver", type: "address" },
          { internalType: "uint256", name: "thirdFeeBps", type: "uint256" },
        ],
        internalType: "struct ETFManager.ETFInfo[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "etfToken", type: "address" },
      { internalType: "bool", name: "returnPrice", type: "bool" },
    ],
    name: "getPriceOrGain",
    outputs: [{ internalType: "int256", name: "", type: "int256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "etfToken", type: "address" }],
    name: "getPricePerEtf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "etfToken", type: "address" }],
    name: "getWeiPerEtf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "etfToken", type: "address" },
      { internalType: "uint256", name: "etfAmount", type: "uint256" },
    ],
    name: "mintWithEth",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "priceFeed",
    outputs: [{ internalType: "contract AggregatorV3Interface", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uniswapRouter",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "weth",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "etfToken", type: "address" },
      { internalType: "uint256", name: "etfAmount", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    stateMutability: "payable",
    type: "receive",
  },
] as const;

export const tokenAbi = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
