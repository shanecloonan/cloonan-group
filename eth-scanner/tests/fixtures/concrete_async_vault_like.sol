// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Concrete async vault impl (`0x438d…093E`; proxy `0xd575…01b7`).
/// cachedTotalAssets + claimWithdrawal. Fixture only — not a finding.
contract ConcreteAsyncVaultImpl {
    function deposit(uint256 assets, address receiver) external returns (uint256) {
        receiver;
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        receiver;
        owner;
        return assets;
    }

    function cachedTotalAssets() external view returns (uint256) {
        return 0;
    }

    function claimWithdrawal(uint256 epoch) external {
        epoch;
    }

    function claimPriorityWithdrawal(uint256 epoch) external {
        epoch;
    }

    function isQueueActive() external view returns (bool) {
        return true;
    }
}
