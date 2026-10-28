// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Euler EVault (`0x8Ff1C814719096b61aBf00Bb46EAd0c9A529Dd7D` impl;
/// live USDC vault proxy `0x797D…8a9`). 4626 + borrow/repay. Must be
/// lending, not generic custody. Fixture only — not a finding.
contract EVault {
    function asset() external view returns (address) {
        return address(0);
    }

    function totalAssets() external view returns (uint256) {
        return 0;
    }

    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        receiver;
        return assets;
    }

    function mint(uint256 shares, address receiver) external returns (uint256) {
        receiver;
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return shares;
    }

    function borrow(uint256 amount, address receiver) external {
        amount;
        receiver;
    }

    function repay(uint256 amount, address receiver) external {
        amount;
        receiver;
    }

    function liquidate(address violator, address collateral, uint256 repayAssets, uint256 minYieldBalance) external {
        violator;
        collateral;
        repayAssets;
        minYieldBalance;
    }
}
