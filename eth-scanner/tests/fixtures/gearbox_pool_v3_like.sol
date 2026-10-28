// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Gearbox PoolV3 (`0xda00…f8E` USDC). ERC-4626 lender pool. Must be
/// vault, not generic custody. Fixture only — not a finding.
contract PoolV3 {
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

    function previewDeposit(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        receiver;
        return assets;
    }

    function depositWithReferral(uint256 assets, address receiver, uint256 referral) external returns (uint256) {
        receiver;
        referral;
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

    function lendCreditAccount(uint256 borrowed, address creditAccount) external {
        borrowed;
        creditAccount;
    }

    function repayCreditAccount(uint256 borrowed, uint256 profit, uint256 loss) external {
        borrowed;
        profit;
        loss;
    }
}
