// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// GMX-like GLP vault shape. GLP vault is Arbitrum-first
/// (`0x489ee077994B6658eAfA855C308275EAd8097C4A` is not an ETH contract).
/// Do not treat the ETH GMX token as this. Fixture only — not a finding.
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
