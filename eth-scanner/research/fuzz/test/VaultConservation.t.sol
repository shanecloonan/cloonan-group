// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockVault} from "../src/MockVault.sol";

/// Defensive Foundry fuzz + invariant: share claim never exceeds assets.
/// No impersonation cheatcodes and no fund-moving helper.
contract VaultConservation {
    MockVault internal vault;

    constructor() {
        vault = new MockVault();
        vault.deposit(1_000);
    }

    function setUp() public {
        if (address(vault) == address(0)) {
            vault = new MockVault();
            vault.deposit(1_000);
        }
    }

    function testFuzz_depositKeepsShareSolvency(uint96 assets) public {
        if (assets == 0) return;
        vault.deposit(uint256(assets));
        assert(vault.convertToAssets(vault.totalSupply()) <= vault.totalAssets() + 1);
    }

    function testFuzz_shareAssetRoundTrip(uint96 assets) public {
        if (assets == 0) return;
        vault.deposit(uint256(assets));
        uint256 shares = vault.convertToShares(uint256(assets));
        assert(vault.convertToAssets(shares) <= uint256(assets) + 1);
    }

    function invariant_shareSolvency() public view {
        assert(vault.convertToAssets(vault.totalSupply()) <= vault.totalAssets() + 1);
    }

    /// Halmos hook (prefix check_). Read-only conservation.
    function check_shareSolvency() public view {
        assert(vault.convertToAssets(vault.totalSupply()) <= vault.totalAssets() + 1);
    }
}
