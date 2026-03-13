export const CONTRACT_ADDRESS = "0xab18bbaf4e7e04a120d031129a47e27be04b86bf";
export const MONEY_ADDRESS = "0x100DB67F41A2dF3c32cC7c0955694b98339B7311";
export const RPC_URL = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";

export const dividendsAbi = [
  { inputs: [{ internalType: "address", name: "_factory", type: "address" }, { internalType: "address", name: "_poolCreator", type: "address" }, { internalType: "address", name: "_token", type: "address" }, { internalType: "uint256", name: "_hardLockDuration", type: "uint256" }, { internalType: "uint256", name: "_initialPenaltyPercent", type: "uint256" }, { internalType: "uint256", name: "_penaltyDecayPercentPerDay", type: "uint256" }], stateMutability: "nonpayable", type: "constructor" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "user", type: "address" }, { indexed: false, internalType: "address", name: "rewardTok", type: "address" }, { indexed: false, internalType: "uint256", name: "amt", type: "uint256" }], name: "RewardsClaimed", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "token", type: "address" }], name: "RewardTokenRegistered", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "token", type: "address" }], name: "RewardTokenUnregistered", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "user", type: "address" }, { indexed: false, internalType: "uint256", name: "amt", type: "uint256" }], name: "Staked", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "user", type: "address" }, { indexed: false, internalType: "uint256", name: "amt", type: "uint256" }, { indexed: false, internalType: "uint256", name: "penalty", type: "uint256" }], name: "Unstaked", type: "event" },
  { anonymous: false, inputs: [{ indexed: true, internalType: "address", name: "previousOwner", type: "address" }, { indexed: true, internalType: "address", name: "newOwner", type: "address" }], name: "OwnershipTransferred", type: "event" },
  { inputs: [], name: "FEE_DENOMINATOR", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "FEE_PERCENT", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "FEE_RECIPIENT", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "HARD_LOCK_DURATION", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "INITIAL_PENALTY_PERCENT", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "MIN_STAKE", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "PENALTY_DECAY_PERCENT_PER_DAY", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "claimAllRewards", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address[]", name: "rewardTokens_", type: "address[]" }], name: "claimSpecificRewards", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "factoryAddress", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "getRegisteredTokensAndBalances", outputs: [{ internalType: "address[]", name: "tokens", type: "address[]" }, { internalType: "uint256[]", name: "balances", type: "uint256[]" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "isRegisteredRewardToken", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "owner", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "poolCreator", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "registeredRewardTokens", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "rewardPerTokenStored", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }, { internalType: "address", name: "", type: "address" }], name: "rewards", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "rewardToken", type: "address" }], name: "registerRewardToken", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }], name: "stake", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "stakes", outputs: [{ internalType: "uint256", name: "amount", type: "uint256" }, { internalType: "uint256", name: "stakeTimestamp", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }], name: "tokenBalance", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "token", outputs: [{ internalType: "contract IERC20", name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalStaked", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ internalType: "address", name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "unstake", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "rewardToken", type: "address" }], name: "unregisterRewardToken", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "", type: "address" }, { internalType: "address", name: "", type: "address" }], name: "userRewardPerTokenPaid", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { stateMutability: "payable", type: "receive" },
] as const;

export const erc20Abi = [
  { inputs: [{ internalType: "address", name: "spender", type: "address" }, { internalType: "uint256", name: "amount", type: "uint256" }], name: "approve", outputs: [{ internalType: "bool", name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ internalType: "address", name: "account", type: "address" }], name: "balanceOf", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;
