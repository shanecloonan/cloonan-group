// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockVault} from "../src/MockVault.sol";

/// Echidna property stubs — conservation only. No attack corpus.
contract VaultProperties {
    MockVault internal vault;

    constructor() {
        vault = new MockVault();
        vault.deposit(1_000);
    }

    function deposit(uint96 assets) public {
        if (assets == 0) return;
        vault.deposit(uint256(assets));
    }

    function echidna_share_solvency() public view returns (bool) {
        return vault.convertToAssets(vault.totalSupply()) <= vault.totalAssets() + 1;
    }

    function echidna_no_free_shares() public view returns (bool) {
        return vault.convertToShares(vault.totalAssets()) <= vault.totalSupply() + 1;
    }
}
