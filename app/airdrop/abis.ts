export const CONTRACT_ADDRESS = "0x6785cd86a65f3d8336fdc3b0e54c78215501dca2";
export const RPC_URL = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";

export const airdropAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  { inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "OwnableInvalidOwner", type: "error" },
  { inputs: [{ internalType: "address", name: "account", type: "address" }], name: "OwnableUnauthorizedAccount", type: "error" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "previousOwner", type: "address" }, { indexed: true, internalType: "address", name: "newOwner", type: "address" }], name: "OwnershipTransferred", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "sender", type: "address" }, { indexed: true, internalType: "address", name: "recipient", type: "address" }, { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }], name: "TokensAirdropped", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "token", type: "address" }, { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }], name: "TokensRecovered", type: "event" },
  { inputs: [{ internalType: "contract IERC20", name: "token", type: "address" }, { internalType: "address[]", name: "recipients", type: "address[]" }, { internalType: "uint256[]", name: "amounts", type: "uint256[]" }], name: "airdropTokens", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "contract IERC20", name: "token", type: "address" }], name: "getContractBalance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "contract IERC20", name: "token", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }], name: "recoverTokens", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

export const erc20Abi = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "name", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
] as const;
