// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal ERC-4626-like vault for defensive conservation fuzz.
/// Share ↔ asset conversion uses the classic totalAssets / totalSupply ratio.
/// Not a production vault. No admin hooks. No attacker helpers.
contract MockVault {
    uint256 public totalAssets;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalSupply == 0 || totalAssets == 0) return assets;
        return (assets * totalSupply) / totalAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalSupply == 0) return shares;
        return (shares * totalAssets) / totalSupply;
    }

    function deposit(uint256 assets) public {
        require(assets > 0, "assets");
        uint256 shares = convertToShares(assets);
        require(shares > 0, "shares");
        totalAssets += assets;
        totalSupply += shares;
        balanceOf[msg.sender] += shares;
    }

    function redeem(uint256 shares) public {
        require(shares > 0 && balanceOf[msg.sender] >= shares, "shares");
        uint256 assets = convertToAssets(shares);
        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        totalAssets -= assets;
    }
}
