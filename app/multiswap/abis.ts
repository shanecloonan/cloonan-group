export const FACTORY_ADDRESS = "0x40af76d95100372232a9fe2ddd92de7e103eb2db";
export const RPC_URL = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";

export const factoryAbi = [
  {
    inputs: [
      { internalType: "address[]", name: "swapFeeReceivers", type: "address[]" },
      { internalType: "uint256[]", name: "swapFeeBps", type: "uint256[]" },
      { internalType: "address[]", name: "distributeFeeReceivers", type: "address[]" },
      { internalType: "uint256[]", name: "distributeFeeBps", type: "uint256[]" },
    ],
    name: "deploySwapAirdropSendContract",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "contractAddress", type: "address" },
      { indexed: true, internalType: "address", name: "creator", type: "address" },
      { indexed: false, internalType: "address[]", name: "swapFeeReceivers", type: "address[]" },
      { indexed: false, internalType: "uint256[]", name: "swapFeeBps", type: "uint256[]" },
      { indexed: false, internalType: "address[]", name: "distributeFeeReceivers", type: "address[]" },
      { internalType: "uint256[]", name: "distributeFeeBps", type: "uint256[]" },
    ],
    name: "SwapAirdropSendContractDeployed",
    type: "event",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "deployedContracts",
    outputs: [{ internalType: "address", name: "contractAddress", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllDeployedContracts",
    outputs: [
      {
        components: [
          { internalType: "address", name: "contractAddress", type: "address" },
          { internalType: "address[]", name: "swapFeeReceivers", type: "address[]" },
          { internalType: "uint256[]", name: "swapFeeBps", type: "uint256[]" },
          { internalType: "address[]", name: "distributeFeeReceivers", type: "address[]" },
          { internalType: "uint256[]", name: "distributeFeeBps", type: "uint256[]" },
        ],
        internalType: "struct UniswapV2SwapAirdropSendFactory.SwapAirdropSendContractInfo[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MAX_TOTAL_ADDITIONAL_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PRIMARY_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PRIMARY_FEE_RECEIVER_1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PRIMARY_FEE_RECEIVER_2",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "UNISWAP_V2_ROUTER",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "WETH",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
