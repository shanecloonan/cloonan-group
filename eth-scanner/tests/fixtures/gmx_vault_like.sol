// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// GMX-like GLP vault (no mainnet vault; pattern for similar ETH venues).
/// Holds poolAmounts / guaranteedUsd. Fixture only — not a finding.
contract GmxVault {
    mapping(address => uint256) public poolAmounts;
    mapping(address => uint256) public reservedAmounts;
    mapping(address => uint256) public guaranteedUsd;

    function buyUSDG(address token, address receiver) external returns (uint256) {
        poolAmounts[token] += 1;
        receiver;
        return 1;
    }

    function sellUSDG(address token, address receiver) external returns (uint256) {
        poolAmounts[token] -= 1;
        receiver;
        return 1;
    }

    function increasePosition(address account, address collateralToken, uint256 amount) external {
        reservedAmounts[collateralToken] += amount;
        account;
    }

    function decreasePosition(address account, address collateralToken, uint256 amount) external {
        reservedAmounts[collateralToken] -= amount;
        account;
    }
}
