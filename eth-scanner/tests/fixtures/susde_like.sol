// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Ethena sUSDe / StakedUSDeV2 (`0x9D39A5DE30e57443BfF2A8307A4256c8797A3497`).
/// ERC-4626 staked USDe. Fixture only — not a finding.
contract StakedUSDeV2 {
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
}
