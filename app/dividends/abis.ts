export const FACTORY_ADDRESS = "0x5ef0404f344e9c0ff2ab83b44d8827a78db7128a";
export const INFURA_RPC = "https://mainnet.infura.io/v3/cf2916fb6dbc47ae824d6f36db817b73";

export const FACTORY_ABI = [
  "function createPool(address token, uint256 hardLockDuration, uint256 initialPenaltyPercent, uint256 penaltyDecayPercentPerDay) returns (address poolAddr)",
  "function getAllPools() view returns (address[])",
  "function getPool(address token) view returns (address)",
  "function pools(address) view returns (address)",
  "event StakingPoolCreated(address indexed poolAddress, address indexed token, uint256 hardLockDuration, uint256 initialPenaltyPercent, uint256 penaltyDecayPercentPerDay)",
];

export const POOL_ABI = [
  "function token() view returns (address)",
  "function LOCK_DUR() view returns (uint256)",
  "function INIT_PCT() view returns (uint256)",
  "function DECAY_PCT_DAY() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function stakesByTokenId(uint256) view returns (uint256 amount, uint256 stakeTimestamp)",
  "function tokenBalance(address) view returns (uint256)",
  "function isRegisteredRewardToken(address) view returns (bool)",
  "function stake(uint256 amount)",
  "function unstake(uint256 tokenId)",
  "function claimAllRewards(uint256 tokenId)",
  "function registerRewardToken(address rewardToken)",
  "function unregisterRewardToken(address rewardToken)",
];

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
