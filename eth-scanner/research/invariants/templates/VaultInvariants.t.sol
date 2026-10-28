// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Defensive invariant stubs — conservation / solvency. Not an attacker harness.
/// Do not add attacker or fund-moving tests here. Wire `vault` in setUp() against a
/// local fixture or a read-only fork.
interface IVaultLike {
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
}

contract VaultInvariants {
    IVaultLike internal vault;

    /// Share claim must not exceed assets (1 wei slack for rounding).
    function test_template_share_solvency() public view {
        uint256 supply = vault.totalSupply();
        uint256 assets = vault.totalAssets();
        assert(vault.convertToAssets(supply) <= assets + 1);
    }

    /// convertToShares(totalAssets) should not invent free shares (1 wei slack).
    function test_template_no_free_mint_shape() public view {
        uint256 assets = vault.totalAssets();
        uint256 supply = vault.totalSupply();
        assert(vault.convertToShares(assets) <= supply + 1);
    }

    /// totalAssets is a uint — this is a hook for L5 fork consistency.
    function test_template_assets_readable() public view {
        vault.totalAssets();
        vault.totalSupply();
    }
}
