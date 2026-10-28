// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Bm {
    function approve(address, uint256) external returns (bool);
}

/// Reserve eUSD BackingManager impl (`0x62A5…85d6`; proxy `0xF014…80A4`).
/// Holds the basket. rebalance alone is too weak (Fluid VaultT1).
/// Fixture only — not a finding.
contract BackingManagerP1 {
    address public rToken;

    function rebalance(uint8 kind) external {
        kind;
    }

    function forwardRevenue(address[] calldata erc20s) external {
        erc20s;
    }

    function grantRTokenAllowance(address erc20) external {
        IERC20Bm(erc20).approve(rToken, 0);
    }

    function claimRewards() external {}
}
