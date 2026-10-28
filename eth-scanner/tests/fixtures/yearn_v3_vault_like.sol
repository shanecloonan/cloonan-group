// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Yearn V3 vault original (`0xc1F484Dee9a586c122D658B8AFE3436c2F4290be`).
/// ERC-4626. TokenizedStrategy 3.1.0 (`0x310f…1e76`) is the same shape.
/// Fixture only — not a finding.
contract YearnV3Vault {
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
