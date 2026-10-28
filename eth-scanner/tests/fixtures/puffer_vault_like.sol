// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// PufferVaultV5 impl (`0x3b2f…8AFA`; pufETH proxy `0xD9A4…6a72`).
/// ERC-4626 staked ETH vault. Proxy-only stays diamond-facets-missing.
/// Fixture only — not a finding.
contract PufferVaultV5 {
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
