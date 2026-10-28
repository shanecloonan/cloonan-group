// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Veda LayerZeroTeller (`0x9AA7…4734`). Deposits into BoringVault; optional
/// share bridge. lzReceive must not steal as a lock-release bridge.
/// Fixture only — not a finding.
contract LayerZeroTellerWithRateLimiting {
    uint256 public shareLockPeriod;
    address public vault;

    function deposit(address asset, uint256 amount, uint256 minShares) external {
        asset;
        amount;
        minShares;
    }

    function bulkDeposit(address asset, uint256 amount, uint256 minShares, address to) external {
        asset;
        amount;
        minShares;
        to;
    }

    function depositAndBridge(address asset, uint256 amount, uint256 minShares, uint32 dest) external {
        asset;
        amount;
        minShares;
        dest;
    }

    function lzReceive(bytes calldata payload) external {
        payload;
    }

    function setShareLockPeriod(uint256 period) external {
        shareLockPeriod = period;
    }
}
