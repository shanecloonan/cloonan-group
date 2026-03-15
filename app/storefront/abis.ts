export const FACTORY_ADDRESS = "0x15a3c66121b927f38bffef5d8017370aaf46ab68";
export { RPC_URL } from "@/lib/config";

export const factoryAbi = [
  {
    inputs: [
      { internalType: "address[]", name: "defaultPayees", type: "address[]" },
      { internalType: "uint256[]", name: "defaultShares", type: "uint256[]" },
    ],
    name: "createNFTLocker",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "FEE_BASIS_POINTS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "FEE_RECIPIENT_1",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "FEE_RECIPIENT_2",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserLockers",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "TOTAL_FEE_BASIS_POINTS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "lockerAddress", type: "address" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
      { indexed: false, internalType: "address[]", name: "defaultPayees", type: "address[]" },
      { indexed: false, internalType: "uint256[]", name: "defaultShares", type: "uint256[]" },
    ],
    name: "NFTLockerCreated",
    type: "event",
  },
] as const;

export const lockerAbi = [
  {
    inputs: [
      { internalType: "uint256", name: "listingId", type: "uint256" },
    ],
    name: "buyNFT",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "listingId", type: "uint256" },
    ],
    name: "cancelListingAndWithdrawNFT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "nftContract", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "depositNFT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getDefaultPayees",
    outputs: [
      { internalType: "address[]", name: "", type: "address[]" },
      { internalType: "uint256[]", name: "", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "listingId", type: "uint256" }],
    name: "getListing",
    outputs: [
      { internalType: "address", name: "nftContract", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "bool", name: "isActive", type: "bool" },
      { internalType: "uint256", name: "timelockEnd", type: "uint256" },
      { internalType: "address", name: "tokenContract", type: "address" },
      { internalType: "address[]", name: "payees", type: "address[]" },
      { internalType: "uint256[]", name: "shares", type: "uint256[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getSalesStats",
    outputs: [
      { internalType: "uint256", name: "_totalSales", type: "uint256" },
      { internalType: "uint256", name: "_totalEthProfit", type: "uint256" },
      { internalType: "uint256", name: "_averageEthSalePrice", type: "uint256" },
      { internalType: "uint256", name: "_highestEthSalePrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "nftContract", type: "address" },
      { internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "uint256", name: "price", type: "uint256" },
      { internalType: "uint256", name: "timelockDays", type: "uint256" },
      { internalType: "address", name: "tokenContract", type: "address" },
      { internalType: "address[]", name: "customPayees", type: "address[]" },
      { internalType: "uint256[]", name: "customShares", type: "uint256[]" },
    ],
    name: "listNFT",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "listingCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "tokenContract", type: "address" }],
    name: "getErc20Profit",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalEthProfit",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSales",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const erc721Abi = [
  {
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "_tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_to", type: "address" },
      { name: "_tokenId", type: "uint256" },
    ],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_tokenId", type: "uint256" }],
    name: "getApproved",
    outputs: [{ name: "operator", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_operator", type: "address" },
      { name: "_approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const erc20Abi = [
  {
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
