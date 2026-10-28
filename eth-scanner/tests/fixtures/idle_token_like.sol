// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// IdleTokenGovernance impl (`0x577D…573A`; proxy idleWETH `0xC8E6…7f80`).
/// Yield aggregator holds the basket. mintIdleToken + redeemIdleToken.
/// Must not win as erc20-plus-custody via flashLoan. Fixture only — not a finding.
contract IdleTokenGovernance {
    address[] public protocolWrappers;

    function mintIdleToken(uint256 amount, bool skipRebalance, address referral) external returns (uint256) {
        amount;
        skipRebalance;
        referral;
        return 0;
    }

    function redeemIdleToken(uint256 amount) external returns (uint256) {
        amount;
        return 0;
    }

    function redeemInterestBearingTokens(uint256 amount) external {
        amount;
    }

    function flashLoan(address receiver, address token, uint256 amount, bytes calldata data) external {
        receiver;
        token;
        amount;
        data;
    }
}
