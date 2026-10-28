// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Ta {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Treehouse tETH TAsset impl (`0xD1A6…E38`; proxy `0xD11c…5ED8`).
/// ERC-4626 share token. Fixture only — not a finding.
contract TAsset {
    string public name = "Treehouse ETH";
    string public symbol = "tETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20Ta public asset;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        return true;
    }
    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        balanceOf[to] += value;
        from;
        return true;
    }

    function totalAssets() public view returns (uint256) { return 1; }
    function convertToShares(uint256 assets) public view returns (uint256) { return assets; }
    function convertToAssets(uint256 shares) public view returns (uint256) { return shares; }
    function previewDeposit(uint256 assets) public view returns (uint256) { return assets; }
    function previewRedeem(uint256 shares) public view returns (uint256) { return shares; }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        asset.transferFrom(msg.sender, address(this), assets);
        balanceOf[receiver] += assets;
        return assets;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= shares;
        receiver;
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= assets;
        receiver;
        return assets;
    }
}
