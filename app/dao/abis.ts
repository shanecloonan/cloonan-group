export const FACTORY_ADDRESS = "0xc346ecabc9d5c6fb943231c4b9d73ca91178545a";

export const FACTORY_ABI = [
  "function createDAO(address _token, uint256 _votingPeriod, bool _countNonRespondersAsYes, uint256 _voteLockPercentage, uint256 _majorityThreshold, uint256 _maxProposalsPerDay, uint256 _slippage) returns (address)",
  "function daos(address) view returns (address)",
  "function getAllDAOs() view returns (address[])",
  "function getDAO(address _token) view returns (address)",
  "event DAOCreated(address indexed daoAddress, address indexed token, uint256 votingPeriod, bool countNonRespondersAsYes, uint256 voteLockPercentage, uint256 majorityThreshold, uint256 maxProposalsPerDay, uint256 slippage)",
];

export const DAO_ABI = [
  "function token() view returns (address)",
  "function votingPeriod() view returns (uint256)",
  "function countNonRespondersAsYes() view returns (bool)",
  "function voteLockPercentage() view returns (uint256)",
  "function majorityThreshold() view returns (uint256)",
  "function maxProposalsPerDay() view returns (uint256)",
  "function slippage() view returns (uint256)",
  "function proposalCount() view returns (uint256)",
  "function getDAOInfoBasic() view returns (address tokenAddress, uint256 totalSupply, uint256 ethBalance, uint256 tokenBalance, uint256 voteLockPercentage, address uniswapRouter, address factory, uint256 votingPeriod, bool countNonRespondersAsYes, uint256 majorityThreshold, uint256 maxProposalsPerDay, uint256 slippage)",
  "function getProposal(uint256 proposalId) view returns (tuple(uint256 id, address proposer, uint8 proposalType, address destination, uint256 amount, address tokenAddress, uint256 yesWeight, uint256 noWeight, uint256 startTime, uint256 endTime, uint256 totalVotedTokens, bool executed))",
  "function getVotingWeight(address voter) view returns (uint256)",
  "function hasReclaimed(uint256, address) view returns (bool)",
  "function lockedTokens(uint256, address) view returns (uint256)",
  "function createProposal(uint8 proposalType, address destination, uint256 amount, address tokenAddress)",
  "function vote(uint256 proposalId, bool support)",
  "function executeProposal(uint256 proposalId)",
  "function reclaimTokens(uint256 proposalId)",
];

export const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export { RPC_URL as INFURA_RPC } from "@/lib/config";
