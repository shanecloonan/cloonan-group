// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20V {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// ERC-4626-shaped vault that is also an ERC-20 share token. Hybrid — stay in-scope.
/// Fixture only — not a finding.
contract Vault4626 {
    string public name = "Vault Share";
    string public symbol = "vUSDC";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20V public asset;

    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    function totalAssets() public view returns (uint256) {
        return 0;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        asset.transferFrom(msg.sender, address(this), assets);
        balanceOf[receiver] += assets;
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= assets;
        asset.transfer(receiver, assets);
        return assets;
    }
}
