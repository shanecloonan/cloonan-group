// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Enzyme VaultLib (`0x891dee0483eBAA922E274ddD2eBBaA2D33468A38`).
/// Tracked-asset vault. Fixture only — not a finding.
contract VaultLib {
    function withdrawAssetTo(address asset, address target, uint256 amount) external {
        asset;
        target;
        amount;
    }

    function buybackProtocolFeeShares(uint256 shares) external {
        shares;
    }

    function getDenominationAsset() external view returns (address) {
        return address(0);
    }

    function getTrackedAssets() external view returns (address[] memory) {
        return new address[](0);
    }

    function mintShares(address to, uint256 amount) external {
        to;
        amount;
    }

    function burnShares(address from, uint256 amount) external {
        from;
        amount;
    }
}
