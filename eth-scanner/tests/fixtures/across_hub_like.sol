// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20H {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface AdapterInterface {
    function relayTokens(address l1Token, address l2Token, uint256 amount, address to) external;
}

/// Live Across HubPool (0xc186fA914353c44b2E33eBE05f21846F1048bEda).
/// Etherscan impl can be Ethereum_Adapter; after merge the hub verbs must
/// stay visible (not adapter-thin relayTokens only). Fixture only — not a finding.
/// This contract is the hub and talks to the adapter via relayTokens.
contract HubPool {
    mapping(address => uint256) public pooledTokens;
    AdapterInterface public adapter;

    function addLiquidity(address l1Token, uint256 amount) external payable {
        IERC20H(l1Token).transferFrom(msg.sender, address(this), amount);
        pooledTokens[l1Token] += amount;
    }

    function removeLiquidity(address l1Token, uint256 amount, bool sendEth) external {
        pooledTokens[l1Token] -= amount;
        IERC20H(l1Token).transfer(msg.sender, amount);
        sendEth;
    }

    function proposeRootBundle(
        uint256[] memory bundleEvaluationBlockNumbers,
        uint8 poolRebalanceLeafCount,
        bytes32 poolRebalanceRoot
    ) external {
        bundleEvaluationBlockNumbers;
        poolRebalanceLeafCount;
        poolRebalanceRoot;
    }

    function executeRootBundle(
        uint256 chainId,
        uint256 groupIndex,
        address[] memory l1Tokens
    ) external {
        chainId;
        groupIndex;
        l1Tokens;
    }

    function disputeRootBundle() external {}

    function relayTokensToAdapter(address l1Token, address l2Token, uint256 amount, address to) external {
        adapter.relayTokens(l1Token, l2Token, amount, to);
    }
}

contract Ethereum_Adapter is AdapterInterface {
    function relayTokens(address l1Token, address l2Token, uint256 amount, address to) external override {
        l1Token;
        l2Token;
        amount;
        to;
    }
}
