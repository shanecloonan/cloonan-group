// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Sky {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

/// Sky sUSDS impl (`0x4e79…61e0`). ERC-4626 savings vault. Fixture only.
contract SUsds {
    string public name = "Savings USDS";
    string public symbol = "sUSDS";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    IERC20Sky public usds;

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
        usds.transferFrom(msg.sender, address(this), assets);
        balanceOf[receiver] += assets;
        return assets;
    }
    function mint(uint256 shares, address receiver) external returns (uint256) {
        usds.transferFrom(msg.sender, address(this), shares);
        balanceOf[receiver] += shares;
        return shares;
    }
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= assets;
        usds.transfer(receiver, assets);
        return assets;
    }
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        balanceOf[owner] -= shares;
        usds.transfer(receiver, shares);
        return shares;
    }
}
